import { createSignal } from "solid-js";

export function DeleteTab() {
  const [value, setValue] = createSignal("");

  return (
    <section class="section">
      <label>
        <span>Value</span>
        <input
          type="number"
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
        />
      </label>
      <button class="btn" disabled>
        Delete
      </button>
      <p class="hint">Delete isn't wired up yet.</p>
    </section>
  );
}
