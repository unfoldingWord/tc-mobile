import { Control } from "./control";
import { strings } from "@/lib/strings";
import { useDesign } from "@/hooks/use-design";

/**
 * The O4 design switch, mounted in the app's global `≡` menu (#938, batch 0 of
 * epic #936) — so testers and the requirements owner can compare the current
 * look against O4 on a phone, per that batch's own "Done when" clause.
 *
 * Modelled on `ThemeControl`, but simpler in one respect that control's own
 * docblock explains: the theme toggle has no `aria-pressed` state to carry
 * "which one you have", so its glyph and label instead name the destination.
 * This control DOES have that state — `Control`'s `pressed` prop, the same
 * `aria-pressed` + `is-on` mechanism the zoom and level-meter toggles already
 * use (#286, #91) — so one fixed label, "New look (O4)", is enough: a screen
 * reader hears the state from `aria-pressed` itself, the same way it hears a
 * checkbox's checked state without the label having to say "checked".
 *
 * Unlike `ThemeControl`, this is mounted once — only in the app `≡`
 * (`books-screen.tsx`) — per #938's own files-owned list ("the app ≡ menu
 * component (the menu entry only)"); the chapter and recorder menus are out
 * of this batch's scope.
 */
export function DesignControl() {
  const design = useDesign();
  return (
    <Control
      icon="edit"
      label={strings.newLookO4}
      variant="quiet"
      pressed={design.design === "o4"}
      onClick={design.toggle}
    />
  );
}
