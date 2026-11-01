import type { JSX } from "solid-js";
import { Show } from "solid-js";
import styles from "./AppShell.module.css";

export function AppShell(props: {
  devMode: boolean;
  asideOpen: boolean;
  leftTall: boolean;
  mainSplit: boolean;
  onBackdropClick: () => void;
  left: JSX.Element;
  main: JSX.Element;
  right: JSX.Element;
  iconsLeft: JSX.Element;
  iconsRight: JSX.Element;
  asideToggle: JSX.Element;
  playback: JSX.Element;
}) {
  return (
    <div
      class={styles.app}
      classList={{
        [styles.asideOpen]: props.asideOpen,
        [styles.devMode]: props.devMode,
      }}
    >
      <Show when={props.asideOpen}>
        <div class={styles.asideBackdrop} onClick={props.onBackdropClick} />
      </Show>
      <aside
        class={styles.asideLeft}
        classList={{ [styles.leftTall]: props.leftTall }}
      >
        {props.left}
      </aside>
      <main
        class={styles.main}
        classList={{ [styles.mainSplit]: props.mainSplit }}
      >
        {props.main}
      </main>
      <div class={styles.playbackControls}>{props.playback}</div>
      <aside class={styles.aside}>{props.right}</aside>
      <div class={styles.iconRow}>
        <div class={styles.iconRowLeft}>{props.iconsLeft}</div>
        <div class={styles.iconRowRight}>{props.iconsRight}</div>
        <div class={styles.asideToggle}>{props.asideToggle}</div>
      </div>
    </div>
  );
}

/* Expose the tree-pane layout class to TreeCanvas, which lives inside .main
 * but is a sibling component that needs the padded/positioned container. */
export const shellLayout = {
  treePane: styles.treePane,
  devPane: styles.devPane,
};
