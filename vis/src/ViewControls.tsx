import { FiMaximize } from "solid-icons/fi";
import { AiOutlineAim } from "solid-icons/ai";
import styles from "./ViewControls.module.css";

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
    <div class={styles.pill}>
      <div
        class={styles.highlight}
        classList={{
          [styles.hidden]: highlightIndex() === null,
          [styles.slot0]: highlightIndex() === 0,
          [styles.slot1]: highlightIndex() === 1,
        }}
      />
      <button
        class={styles.btn}
        classList={{ [styles.active]: props.autoFit() }}
        onClick={props.toggleAutoFit}
        title="Center and fit"
        aria-label="Center and fit"
      >
        <FiMaximize />
      </button>
      <button
        class={styles.btn}
        disabled
        title="Follow animation (coming soon)"
        aria-label="Follow animation"
      >
        <AiOutlineAim />
      </button>
    </div>
  );
}
