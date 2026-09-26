/**
 * Put text on the clipboard from a tap, or select it so the tester can copy
 * it by hand (#1009's Copy button).
 *
 * `writeText` is called SYNCHRONOUSLY, before any `await`: the Clipboard API
 * needs the tap's user activation, and an earlier `await` would spend it on
 * some WebViews. Where the API is missing, or refuses (no permission, an
 * insecure context, an old WebView), `select` runs instead, which leaves the
 * text highlighted for the phone's own Copy.
 */
export type CopyOutcome = "copied" | "selected";

export interface ClipboardLike {
  readonly writeText: (text: string) => Promise<void>;
}

export function copyText(
  text: string,
  clipboard: ClipboardLike | undefined,
  select: () => void
): Promise<CopyOutcome> {
  if (!clipboard) {
    select();
    return Promise.resolve("selected");
  }
  let pending: Promise<void>;
  try {
    pending = clipboard.writeText(text);
  } catch {
    // A synchronous throw is the same refusal as a rejection: fall back to
    // selecting, which is the whole of this function's contract.
    select();
    return Promise.resolve("selected");
  }
  return pending.then(
    () => "copied" as const,
    () => {
      select();
      return "selected" as const;
    }
  );
}
