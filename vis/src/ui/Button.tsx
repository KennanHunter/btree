import type { JSX } from "solid-js";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary";

export function Button(props: {
  variant?: Variant;
  shake?: boolean;
  subtle?: boolean;
  small?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: (e: MouseEvent) => void;
  children: JSX.Element;
}) {
  return (
    <button
      type={props.type ?? "button"}
      class={styles.btn}
      classList={{
        [styles.secondary]: props.variant === "secondary",
        [styles.subtle]: props.subtle,
        [styles.small]: props.small,
        [styles.shake]: props.shake,
      }}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
