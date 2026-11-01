import { createSignal } from "solid-js";
import { Button } from "../ui/Button";

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
      <Button disabled>Delete</Button>
      <p class="hint">Delete isn't wired up yet.</p>
    </section>
  );
}
