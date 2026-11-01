import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { OperationPlayer } from "component";
import { useTree } from "../tree-context";
import { usePlayback } from "../playback-context";
import { shellLayout } from "../layout/AppShell";

type Props = {
  fitRequest: () => number;
  autoFit: () => boolean;
  follow: () => boolean;
  onUserInteract?: () => void;
};

const MIN_FIT_WIDTH = 600;
const MIN_FIT_HEIGHT = 400;

export function TreeCanvas(props: Props) {
  const { tree, error, tick, activeOperation } = useTree();
  const { index } = usePlayback();

  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  const [smooth, setSmooth] = createSignal(false);
  // Dimensions reported by OperationPlayer's onLayout. Drives pan/zoom/fit.
  const [dims, setDims] = createSignal({ width: 0, height: 0 });
  // Latest focal point reported by OperationPlayer. Drives follow mode.
  const [animCenter, setAnimCenter] = createSignal<
    { x: number; y: number } | undefined
  >(undefined);

  let canvasRef: HTMLDivElement | undefined;
  let paneRef: HTMLDivElement | undefined;
  let smoothTimer: number | undefined;

  const bumpSmooth = () => {
    setSmooth(true);
    if (smoothTimer !== undefined) window.clearTimeout(smoothTimer);
    smoothTimer = window.setTimeout(() => setSmooth(false), 350);
  };

  const notifyInteract = () => props.onUserInteract?.();

  // Does the player have anything to show? OperationPlayer only renders
  // dispatched Operations now — no `fallback` prop — so this is just a check
  // for an active op.
  const hasContent = createMemo(() => {
    tick();
    return !!activeOperation();
  });

  const centerFit = () => {
    const el = canvasRef;
    const { width, height } = dims();
    if (!el || width === 0 || height === 0) return;
    const padding = 32;
    const effW = Math.max(width + 16, MIN_FIT_WIDTH);
    const effH = Math.max(height + 16, MIN_FIT_HEIGHT);
    const sx = (el.clientWidth - padding) / effW;
    const sy = (el.clientHeight - padding) / effH;
    const z = Math.min(sx, sy, 1);
    const w = (width + 16) * z;
    const h = (height + 16) * z;
    setZoom(z);
    setPan({
      x: (el.clientWidth - w) / 2,
      y: (el.clientHeight - h) / 2,
    });
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    notifyInteract();
    const el = canvasRef;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.001);
    const z0 = zoom();
    const z1 = Math.max(0.05, Math.min(10, z0 * factor));
    const p = pan();
    setPan({
      x: mx - ((mx - p.x) * z1) / z0,
      y: my - ((my - p.y) * z1) / z0,
    });
    setZoom(z1);
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart: {
    dist: number;
    midx: number;
    midy: number;
    zoom: number;
    pan: { x: number; y: number };
  } | null = null;
  let panStart: {
    pointerId: number;
    x: number;
    y: number;
    pan: { x: number; y: number };
  } | null = null;
  let lastTap: { t: number; x: number; y: number } | null = null;
  let doubleTapZoom: {
    pointerId: number;
    startY: number;
    anchorX: number;
    anchorY: number;
    zoom: number;
    pan: { x: number; y: number };
  } | null = null;
  const TAP_MAX_MOVE = 10;
  const DOUBLE_TAP_WINDOW = 300;

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    notifyInteract();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (
      pointers.size === 1 &&
      e.pointerType === "touch" &&
      lastTap &&
      performance.now() - lastTap.t < DOUBLE_TAP_WINDOW &&
      Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40
    ) {
      const el = canvasRef;
      if (el) {
        const rect = el.getBoundingClientRect();
        doubleTapZoom = {
          pointerId: e.pointerId,
          startY: e.clientY,
          anchorX: e.clientX - rect.left,
          anchorY: e.clientY - rect.top,
          zoom: zoom(),
          pan: pan(),
        };
        panStart = null;
        lastTap = null;
        return;
      }
    }

    if (pointers.size === 2) {
      const el = canvasRef;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pts = [...pointers.values()];
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchStart = {
        dist: Math.hypot(dx, dy),
        midx: (pts[0].x + pts[1].x) / 2 - rect.left,
        midy: (pts[0].y + pts[1].y) / 2 - rect.top,
        zoom: zoom(),
        pan: pan(),
      };
      panStart = null;
    } else if (pointers.size === 1) {
      panStart = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        pan: pan(),
      };
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (doubleTapZoom && doubleTapZoom.pointerId === e.pointerId) {
      const dy = e.clientY - doubleTapZoom.startY;
      const factor = Math.exp(dy * 0.01);
      const z0 = doubleTapZoom.zoom;
      const z1 = Math.max(0.05, Math.min(10, z0 * factor));
      const { anchorX, anchorY, pan: p0 } = doubleTapZoom;
      setPan({
        x: anchorX - ((anchorX - p0.x) * z1) / z0,
        y: anchorY - ((anchorY - p0.y) * z1) / z0,
      });
      setZoom(z1);
      return;
    }

    if (pinchStart && pointers.size === 2) {
      const pts = [...pointers.values()];
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const z0 = pinchStart.zoom;
      const z1 = Math.max(0.05, Math.min(10, z0 * (dist / pinchStart.dist)));
      const { midx, midy, pan: p0 } = pinchStart;
      setPan({
        x: midx - ((midx - p0.x) * z1) / z0,
        y: midy - ((midy - p0.y) * z1) / z0,
      });
      setZoom(z1);
      return;
    }

    if (panStart && panStart.pointerId === e.pointerId) {
      setPan({
        x: panStart.pan.x + (e.clientX - panStart.x),
        y: panStart.pan.y + (e.clientY - panStart.y),
      });
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    const start = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;

    if (doubleTapZoom && doubleTapZoom.pointerId === e.pointerId) {
      doubleTapZoom = null;
      lastTap = null;
    } else if (
      e.pointerType === "touch" &&
      panStart &&
      panStart.pointerId === e.pointerId &&
      start &&
      Math.hypot(e.clientX - panStart.x, e.clientY - panStart.y) < TAP_MAX_MOVE
    ) {
      const now = performance.now();
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      setTimeout(() => {
        if (lastTap && performance.now() - lastTap.t >= DOUBLE_TAP_WINDOW) {
          lastTap = null;
        }
      }, DOUBLE_TAP_WINDOW + 50);
    }

    if (pointers.size === 0) panStart = null;
  };

  let didInitialFit = false;

  const tryInitialFit = () => {
    if (didInitialFit) return;
    if (!canvasRef || canvasRef.clientWidth === 0) return;
    if (dims().width === 0) return;
    centerFit();
    didInitialFit = true;
  };

  const attachCanvas = (el: HTMLDivElement) => {
    canvasRef = el;
    requestAnimationFrame(tryInitialFit);
  };

  createEffect(() => {
    dims();
    tryInitialFit();
  });

  createEffect(() => {
    const n = props.fitRequest();
    if (n > 0) {
      bumpSmooth();
      centerFit();
    }
  });

  createEffect(() => {
    const d = dims();
    if (!props.autoFit() || d.width === 0 || !canvasRef) return;
    if (!didInitialFit) return;
    bumpSmooth();
    queueMicrotask(centerFit);
  });

  createEffect(() => {
    const el = paneRef;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      if (!props.autoFit()) return;
      bumpSmooth();
      centerFit();
    });
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });

  // Follow mode: keep the current zoom, pan so the animation's focus point
  // lands in the middle of the canvas div. Transforms get smoothed so the
  // camera glides between step-to-step highlights.
  const panToAnimCenter = () => {
    const el = canvasRef;
    const c = animCenter();
    if (!el || !c) return;
    const z = zoom();
    setPan({
      x: el.clientWidth / 2 - c.x * z,
      y: el.clientHeight / 2 - c.y * z,
    });
  };

  createEffect(() => {
    if (!props.follow()) return;
    animCenter(); // subscribe
    bumpSmooth();
    panToAnimCenter();
  });

  return (
    <div class={shellLayout.treePane} ref={paneRef}>
      <Show when={error()}>
        {(err) => (
          <div class="error">
            <strong>{err().type}</strong>
            <div>{err().message}</div>
          </div>
        )}
      </Show>
      <Show
        when={!error() && hasContent()}
        fallback={
          <Show when={!error()}>
            <div class="empty">Add data to see the tree.</div>
          </Show>
        }
      >
        <div
          class="canvas"
          ref={attachCanvas}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <OperationPlayer
            op={activeOperation()}
            index={index()}
            onLayout={setDims}
            onAnimationCenter={setAnimCenter}
            class={smooth() ? "tree-svg smooth" : "tree-svg"}
            style={{
              transform: `translate(${pan().x}px, ${pan().y}px) scale(${zoom()})`,
            }}
          />
        </div>
      </Show>
    </div>
  );
}
