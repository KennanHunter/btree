import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
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
  setSpeed: (n: number) => void;
  togglePlay: () => void;
  stepBack: () => void;
  stepForward: () => void;
};

const PlaybackContext = createContext<PlaybackContextValue>();

export const MIN_SPEED = 1;
export const MAX_SPEED = 5;

export function PlaybackProvider(props: { children: JSX.Element }) {
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(1);
  const [index, setIndex] = createSignal(0);
  const [total, setTotal] = createSignal(0);

  const stepForward = () => {
    const t = total();
    if (t === 0) return;
    setIndex((i) => (i + 1 >= t ? i : i + 1));
  };

  const stepBack = () => {
    setIndex((i) => (i > 0 ? i - 1 : 0));
  };

  const togglePlay = () => {
    if (!isPlaying() && index() >= total() - 1) setIndex(0);
    setIsPlaying((p) => !p);
  };

  createEffect(() => {
    if (!isPlaying()) return;
    const interval = 1000 / speed();
    const id = window.setInterval(() => {
      const t = total();
      const next = index() + 1;
      if (next >= t) {
        setIsPlaying(false);
        setIndex(t === 0 ? 0 : t - 1);
      } else {
        setIndex(next);
      }
    }, interval);
    onCleanup(() => window.clearInterval(id));
  });

  const value: PlaybackContextValue = {
    isPlaying,
    speed,
    index,
    total,
    setTotal,
    setSpeed,
    togglePlay,
    stepBack,
    stepForward,
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
