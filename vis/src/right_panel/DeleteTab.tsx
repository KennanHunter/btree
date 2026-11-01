import { useLocalStorage } from "../local-storage-context";
import { Button } from "../ui/Button";
import section from "../ui/Section.module.css";

export function DeleteTab() {
  const { deleteText, setDeleteText } = useLocalStorage();

  return (
    <section class={section.section}>
      <label>
        <span>Value</span>
        <input
          type="number"
          value={deleteText()}
          onInput={(e) => setDeleteText(e.currentTarget.value)}
        />
      </label>
      <Button disabled>Delete</Button>
      <p class={section.hint}>Delete isn't wired up yet.</p>
    </section>
  );
}
