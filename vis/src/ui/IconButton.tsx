import type { JSX } from "solid-js";
import styles from "./IconButton.module.css";

type CommonProps = {
  active?: boolean;
  shake?: boolean;
  title?: string;
  "aria-label"?: string;
  children: JSX.Element;
};

export function IconButton(
  props: CommonProps & {
    onClick?: (e: MouseEvent) => void;
    disabled?: boolean;
  },
) {
  return (
    <button
      class={styles.btn}
      classList={{ [styles.active]: props.active, [styles.shake]: props.shake }}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      aria-label={props["aria-label"]}
    >
      {props.children}
    </button>
  );
}

export function IconLink(
  props: CommonProps & {
    href: string;
    target?: string;
    rel?: string;
  },
) {
  return (
    <a
      class={styles.btn}
      classList={{ [styles.active]: props.active, [styles.shake]: props.shake }}
      href={props.href}
      target={props.target}
      rel={props.rel}
      title={props.title}
      aria-label={props["aria-label"]}
    >
      {props.children}
    </a>
  );
}
