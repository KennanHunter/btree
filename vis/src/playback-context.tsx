import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";

type PlaybackContextValue = {
  isPlaying: Accessor<boolean>;
  speed: Accessor<number>;
  index: Accessor<number>;
  total: Accessor<number>;
  setTotal: (n: number) => void;
  setIndex: (n: number) => void;
  setSpeed: (n: number) => void;
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  stepBack: () => void;
  stepForward: () => void;
  // Advancing with a weight-aware delay: each step's dwell time is
  // `(1000/speed) * stepWeight(i)`, matching the player's tween length so
  // multi-keyframe steps (sum(weights) > 1) are not cut off mid-flight.
  setStepWeightFn: (fn: (i: number) => number) => void;
};

const PlaybackContext = createContext<PlaybackContextValue>();

export const MIN_SPEED = 1;
export const MAX_SPEED = 5;

export function PlaybackProvider(props: { children: JSX.Element }) {
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(2);
  const [index, setIndex] = createSignal(0);
  const [total, setTotal] = createSignal(0);
  // Solid's setter treats a function argument as a reducer, so we always
  // wrap writes in `() => fn` to store the function itself.
  const [stepWeightFn, setStepWeightFnRaw] = createSignal<
    (i: number) => number
  >(() => 1);
  const setStepWeightFn = (fn: (i: number) => number) =>
    setStepWeightFnRaw(() => fn);

  const stepForward = () => {
    const t = total();
    if (t === 0) return;
    setIndex((i) => (i + 1 >= t ? i : i + 1));
  };

  const stepBack = () => {
    setIsPlaying(false);
    setIndex((i) => (i > 0 ? i - 1 : 0));
  };

  const play = () => {
    if (index() >= total() - 1) setIndex(0);
    setIsPlaying(true);
  };

  const pause = () => setIsPlaying(false);

  const togglePlay = () => {
    if (!isPlaying() && index() >= total() - 1) setIndex(0);
    setIsPlaying((p) => !p);
  };

  createEffect(() => {
    if (!isPlaying()) return;
    // Reactive deps captured at the top of the effect so changes to speed
    // or the weight function restart the scheduling chain.
    const base = 1000 / speed();
    const weightFn = stepWeightFn();
    let timer: number | undefined;
    // `index` is read via untrack so that `setIndex` inside the setTimeout
    // chain doesn't re-trigger this effect — otherwise each tick would
    // spawn an extra parallel timer and pause() couldn't catch them all.
    const schedule = () => {
      const current = untrack(index);
      const delay = base * weightFn(current);
      timer = window.setTimeout(() => {
        const t = untrack(total);
        const next = current + 1;
        if (next >= t) {
          setIsPlaying(false);
          setIndex(t === 0 ? 0 : t - 1);
          return;
        }
        setIndex(next);
        schedule();
      }, delay);
    };
    schedule();
    onCleanup(() => {
      if (timer !== undefined) window.clearTimeout(timer);
    });
  });

  const value: PlaybackContextValue = {
    isPlaying,
    speed,
    index,
    total,
    setTotal,
    setIndex,
    setSpeed,
    togglePlay,
    play,
    pause,
    stepBack,
    stepForward,
    setStepWeightFn,
  };

  return (
    <PlaybackContext.Provider value={value}>
      {props.children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback must be used within PlaybackProvider");
  return ctx;
}
