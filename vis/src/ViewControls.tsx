import { FiMaximize } from "solid-icons/fi";
import { AiOutlineAim } from "solid-icons/ai";

type Props = {
  autoFit: () => boolean;
  toggleAutoFit: () => void;
};

export function ViewControls(props: Props) {
  const highlightIndex = (): number | null => {
    if (props.autoFit()) return 0;
    return null;
  };

  return (
    <div class="view-pill">
      <div
        class="view-pill-highlight"
        classList={{
          hidden: highlightIndex() === null,
          slot0: highlightIndex() === 0,
          slot1: highlightIndex() === 1,
        }}
      />
      <button
        class="view-pill-btn"
        classList={{ active: props.autoFit() }}
        onClick={props.toggleAutoFit}
        title="Center and fit"
        aria-label="Center and fit"
      >
        <FiMaximize />
      </button>
      <button
        class="view-pill-btn"
        disabled
        title="Follow animation (coming soon)"
        aria-label="Follow animation"
      >
        <AiOutlineAim />
      </button>
    </div>
  );
}
