import { render } from "solid-js/web";
import {
  CANVAS_PADDING,
  OperationPlayer,
  build_tree,
  choreograph,
  dispatch,
  fit_to_viewport,
  resolve_probe_at,
  step_count,
  type Ctx,
  type Operation,
  type OperationPlayerHandle,
} from "component";
import { random } from "benchmark";

const VIEW_W = 1280;
const VIEW_H = 720;
const PADDING = 48;
const FPS = 30;
const STEP_MS = 320;

const url = new URL(window.location.href);
const seed = Number(url.searchParams.get("seed") ?? 0xbeef);
const size = Number(url.searchParams.get("size") ?? 10);

const workload = random(size, seed);
const built = build_tree(
  {
    fanout: 3,
    insert_mode: "bottom_up",
    search_mode: "binary",
    inner_nodes_have_data: false,
  },
  [],
);
if (!built.ok) throw new Error("tree config invalid");
const op: Operation = dispatch(built.tree, {
  kind: "bulk_insert",
  values: workload.keys,
});

const total_steps = step_count(op);

// Precompute max pose bounds across every keyframe of every step so we can
// lock the stage transform once (static zoom, no per-frame rescale jitter).
let max_w = 0;
let max_h = 0;
for (let i = 0; i < total_steps; i++) {
  const probe = resolve_probe_at(op, i);
  const ctx: Ctx = {
    op,
    index: i,
    probe_id: probe?.id,
    probe_value: probe?.value,
  };
  for (const kf of choreograph(ctx)) {
    if (kf.pose.width > max_w) max_w = kf.pose.width;
    if (kf.pose.height > max_h) max_h = kf.pose.height;
  }
}

const content_w = max_w + CANVAS_PADDING * 2;
const content_h = max_h + CANVAS_PADDING * 2;
const fit = fit_to_viewport({
  contentW: content_w,
  contentH: content_h,
  viewW: VIEW_W,
  viewH: VIEW_H,
  padding: PADDING,
  maxScale: 1.8,
});

const stage = document.getElementById("stage")!;
stage.style.transform = `translate(${fit.panX}px, ${fit.panY}px) scale(${fit.scale})`;
stage.style.width = `${content_w}px`;
stage.style.height = `${content_h}px`;
stage.style.display = "flex";
stage.style.alignItems = "center";
stage.style.justifyContent = "center";

let handle: OperationPlayerHandle | undefined;

render(
  () => (
    <OperationPlayer
      op={op}
      stepMs={STEP_MS}
      onReady={(h) => {
        handle = h;
        (window as unknown as { __recorder_ready: boolean }).__recorder_ready =
          true;
      }}
    />
  ),
  stage,
);

const total_weight_per_step = (step: number): number => {
  const probe = resolve_probe_at(op, step);
  const ctx: Ctx = {
    op,
    index: step,
    probe_id: probe?.id,
    probe_value: probe?.value,
  };
  return choreograph(ctx).reduce((a, kf) => a + kf.weight, 0) || 1;
};

const step_boundaries: number[] = [0];
for (let i = 0; i < total_steps; i++) {
  step_boundaries.push(step_boundaries[i] + total_weight_per_step(i) * STEP_MS);
}
const total_ms = step_boundaries[total_steps];
const total_frames = Math.max(1, Math.ceil((total_ms * FPS) / 1000));

const api = {
  fps: FPS,
  stepMs: STEP_MS,
  totalFrames: total_frames,
  getTotalFrames: () => total_frames,
  renderFrame: (frame_idx: number) => {
    if (!handle) return;
    const ms = (frame_idx / FPS) * 1000;
    // Find which step this ms lands in.
    let step = total_steps - 1;
    for (let i = 0; i < total_steps; i++) {
      if (ms < step_boundaries[i + 1]) {
        step = i;
        break;
      }
    }
    const span = step_boundaries[step + 1] - step_boundaries[step];
    const t = span === 0 ? 1 : Math.min(1, (ms - step_boundaries[step]) / span);
    handle.renderAt(step, t);
  },
};

(window as unknown as { __recorder: typeof api }).__recorder = api;
