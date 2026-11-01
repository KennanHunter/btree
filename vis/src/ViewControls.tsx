import { FiMaximize } from "solid-icons/fi";
import { AiOutlineAim } from "solid-icons/ai";
import styles from "./ViewControls.module.css";

type Props = {
  autoFit: () => boolean;
  follow: () => boolean;
  toggleAutoFit: () => void;
  toggleFollow: () => void;
};

export function ViewControls(props: Props) {
  const highlightIndex = (): number | null => {
    if (props.autoFit()) return 0;
    if (props.follow()) return 1;
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
        classList={{ [styles.active]: props.follow() }}
        onClick={props.toggleFollow}
        title="Follow animation"
        aria-label="Follow animation"
      >
        <AiOutlineAim />
      </button>
    </div>
  );
}
