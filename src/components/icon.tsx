/**
 * The drawn icon set.
 *
 * Platform emoji are banned in UI chrome: they render differently on every
 * device, clash with the palette, and make a screen read as a template. These
 * are plain paths on a 22-unit grid, inheriting `currentColor` so a control's
 * state colours its glyph for free.
 */

export type IconName =
  | "back"
  | "play"
  | "pause"
  | "record"
  | "stop"
  | "plus"
  | "prev"
  | "next"
  | "trash"
  | "alert"
  | "info"
  | "copies"
  | "retry"
  | "menu"
  | "edit"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "zoom-in"
  | "zoom-out"
  | "selection"
  | "scissors"
  | "paste"
  | "undo"
  | "redo"
  | "share"
  | "sun"
  | "moon"
  | "share-partial"
  | "share-empty"
  | "share-sent"
  | "share-closed"
  | "share-android";

const PATHS: Record<IconName, React.ReactNode> = {
  back: (
    <path
      d="M14 5 8 11l6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  play: <path d="M8 5.5 16 11l-8 5.5z" fill="currentColor" />,
  pause: (
    <>
      <rect x="7" y="6" width="3" height="10" rx="1.2" fill="currentColor" />
      <rect x="12" y="6" width="3" height="10" rx="1.2" fill="currentColor" />
    </>
  ),
  record: <circle cx="11" cy="11" r="6" fill="currentColor" />,
  stop: (
    <rect x="6.5" y="6.5" width="9" height="9" rx="2" fill="currentColor" />
  ),
  plus: (
    <path
      d="M11 5v12M5 11h12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  prev: (
    <path
      d="M13 5 7 11l6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  next: (
    <path
      d="M9 5l6 6-6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  trash: (
    <>
      <path
        d="M5 7h12M9 7V5.5h4V7M7 7l.8 9.5h6.4L15 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  alert: (
    <>
      <path
        d="M11 3.6 19.4 18.4H2.6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M11 8.8v3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <circle cx="11" cy="15.4" r="1.05" fill="currentColor" />
    </>
  ),
  // A heads-up (#112): a ring with an i. Deliberately neither the alert
  // triangle nor the retry arc, so a non-reader tells "left out" from "failed"
  // and from "wait" by shape alone.
  info: (
    <>
      <circle
        cx="11"
        cy="11"
        r="7.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M11 10.2v4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="11" cy="7.4" r="1.05" fill="currentColor" />
    </>
  ),
  // Two sheets, one behind the other (#221): "there is another copy of this app
  // open." Neither the alert triangle nor the info ring — a translator who
  // cannot read has to tell "close the other one" from "this failed" by shape.
  // The one behind is drawn as its two visible edges rather than a whole
  // rectangle, so the overlap stays legible at the 56px panel size.
  copies: (
    <>
      <path
        d="M7.4 3.4h9.4a1.8 1.8 0 0 1 1.8 1.8v9.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <rect
        x="3.4"
        y="7.4"
        width="11.2"
        height="11.2"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </>
  ),
  retry: (
    <>
      <path
        d="M17 11a6 6 0 1 1-1.9-4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16.6 3.2v3.9h-3.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  // Three rules — the global menu (hamburger). B2's menu shell opens from it.
  menu: (
    <path
      d="M4 7h14M4 11h14M4 15h14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  // Edit: a pencil over its stroke. The row menu's "Edit" entry, which reopens
  // the recorder to insert/append/re-record the segment.
  edit: (
    <path
      d="M4 18v-3L14.5 4.5l3 3L7 18H4zM12.5 6.5l3 3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // The finished tick, drawn inside the checkbox when a segment is affirmed.
  check: (
    <path
      d="M5 11.5 9.2 15.5 17 6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Book disclosure: down = expanded, right = collapsed. Kept as two glyphs
  // rather than one rotated so the affordance reads without a transform.
  "chevron-down": (
    <path
      d="M5 8l6 6 6-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  "chevron-right": (
    <path
      d="M8 5l6 6-6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Zoom toggle: a magnifier carrying the sign of what a tap DOES (#91).
  //
  // These were two facing-arrow glyphs (`-><-` and `<-->`), and the first
  // external tester read them as the state rather than the action and asked
  // whether they were reversed. Arrows drawn apart or together describe a
  // GEOMETRY, and a geometry reads equally well as "this is how the view is" and
  // as "this is what tapping will do" — the ambiguity was in the metaphor, not
  // in which way round it was wired. A magnifier with a plus is a verb: nothing
  // about the current view is shaped like a lens, so there is no state reading
  // left to take. The state is carried separately, by `aria-pressed` and the
  // `is-on` mark on the button.
  "zoom-in": (
    <>
      <circle
        cx="9.5"
        cy="9.5"
        r="5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M13.6 13.6 18.4 18.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M9.5 6.8v5.4M6.8 9.5h5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </>
  ),
  "zoom-out": (
    <>
      <circle
        cx="9.5"
        cy="9.5"
        r="5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M13.6 13.6 18.4 18.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M6.8 9.5h5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </>
  ),
  // Selection-frame toggle: the two brackets that frame the picked span (mockup
  // 4). Drawn as a facing pair so the button reads as "enclose a region".
  selection: (
    <path
      d="M9 5.5H6v11h3M13 5.5h3v11h-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Cut: two finger loops and crossing blades. Appears below the waveform once a
  // selection exists (mockup 4).
  scissors: (
    <>
      <circle
        cx="6.5"
        cy="7.4"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle
        cx="6.5"
        cy="14.6"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8.3 8.6 17 15M8.3 13.4 17 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  // Paste: audio dropping onto the centerline (mockup 5). A down arrow over the
  // line it inserts at.
  paste: (
    <path
      d="M11 4v8m-3.5-3.5L11 12l3.5-3.5M6 16h10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Undo: an arrow curving back to the left (↶), toolbar control.
  undo: (
    <path
      d="M8.5 6.5 5 10l3.5 3.5M5 10h6.5a4.5 4.5 0 0 1 0 9H9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Redo: undo mirrored (↝), lives in the recorder menu.
  redo: (
    <path
      d="M13.5 6.5 17 10l-3.5 3.5M17 10h-6.5a4.5 4.5 0 0 0 0 9H13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Share: a tray with an up-arrow leaving it — the OS share-sheet glyph.
  share: (
    <>
      <path
        d="M11 4 L11 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.7 7 L11 3.7 L14.3 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 9 L5.5 9 L5.5 17.5 L16.5 17.5 L16.5 9 L14.5 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  /* The theme toggle's two faces (#171). Deliberately the most conventional
     shapes in the set — a disc with rays, and a crescent — because this is the
     one control in the app whose meaning cannot be learned by watching what it
     does to audio, and the icon-recognition check at the training (#249) is
     where a text-free glyph earns or loses its place. */
  sun: (
    <>
      <circle
        cx="11"
        cy="11"
        r="3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M11 2.6v2.2M11 17.2v2.2M2.6 11h2.2M17.2 11h2.2M5.1 5.1l1.6 1.6M15.3 15.3l1.6 1.6M16.9 5.1l-1.6 1.6M6.7 15.3l-1.6 1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </>
  ),
  moon: (
    <path
      d="M14.6 14.1A6 6 0 0 1 9.2 4.6a7 7 0 1 0 7.3 10.8 6 6 0 0 1-1.9-1.3z"
      fill="currentColor"
    />
  ),
  /* The two share outcomes that had no mark of their own (#178). Share is the
     only way audio leaves the phone, so "some of it went" and "none of it
     could" must not look alike — a facilitator who reads them as the same
     thing collects an incomplete chapter believing it is whole.

     Both are built on `share`'s own up-arrow-out-of-a-tray, so they read as
     members of the share family rather than as two unrelated signs, and both
     say what they mean by what is MISSING from that shape: `share-partial`
     breaks the tray's rim on one side (some went, some stayed), `share-empty`
     drops the arrow entirely (none of it could go).

     Checked at the real 20px Notice size, not just drawn: with `alert` for the
     third outcome, the three are three distinct silhouettes — arrow + broken
     tray, bare tray, triangle — rather than one shape wearing modifiers, which
     is what survives at that size.

     Whether a non-reader actually reads them that way is NOT decided here.
     That is the ten-minute icon-recognition protocol at the training (#249),
     which #178 names as its own acceptance evidence. */
  "share-partial": (
    <>
      <path
        d="M11 3.7 L11 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.7 7 L11 3.7 L14.3 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The tray, with its right-hand wall and part of its floor absent —
          the gap IS the message, so it is drawn as an open path, never as a
          dashed rectangle that could read as a selection. */}
      <path
        d="M14.5 9 L16.5 9 L16.5 12.5 M5.5 17.5 L11 17.5 M7.5 9 L5.5 9 L5.5 17.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  /* The share tray with NO ARROW — nothing is going out. The absence is the
     whole mark, and it is deliberately not a crossed-out share glyph.

     Three crossed-out variants were drawn and rendered at the real 20px
     Notice size (full share + full-bleed slash, tray + slash, share + ring)
     and ALL THREE were mud: at 22 units and 1.8 stroke there is not enough
     room to lay a prohibition stroke over a tray and an arrow and have either
     survive. Dropping the arrow instead changes the silhouette by a third of
     the glyph's height, which is what actually reads small. Recorded because
     it is the kind of thing the next person will otherwise try again. */
  "share-empty": (
    <path
      d="M7.5 9 L5.5 9 L5.5 17.5 L16.5 17.5 L16.5 9 L14.5 9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  /* The two outcomes a share can end in once the sheet has closed (#491):
     handed over, and dismissed. Same tray family as the three above, for the
     same reason — five marks that read as one vocabulary, each saying what
     it means by what happens to the arrow.

     `share-sent`: the tray with a TICK where the arrow was. Not the bare
     `check` (that is the "Share now" control the person just tapped, and a
     success wearing the control's own mark says "tap this" rather than "this
     happened"), and not the plain `share`. It means HANDED TO THE SHEET and
     nothing further — a resolve proves the bytes reached the OS, not that
     any app kept them (`resolveProvesDelivery`), so the copy under it stops
     there too.

     `share-closed`: the arrow pointing DOWN into the tray — it came back,
     nothing left. Not `back` (a control glyph). Shown for a sheet the person
     closed; on Android native the plugin can resolve a Back after the
     activity stopped as a success, so this mark is the clean-cancel case
     only, and that hole is documented where it lives, not papered over here.

     Neither has been shown to a non-reader. The recognition check at the
     training (#249) is the acceptance evidence for both, as #178 already
     says for the three above. Drawn at 48px (the modal) — check them there
     before claiming anything about legibility. */
  "share-sent": (
    <>
      <path
        d="M7.6 8.2 L10.4 11 L15.2 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 9 L5.5 9 L5.5 17.5 L16.5 17.5 L16.5 9 L14.5 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  "share-closed": (
    <>
      <path
        d="M11 4 L11 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.7 10 L11 13.3 L14.3 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 9 L5.5 9 L5.5 17.5 L16.5 17.5 L16.5 9 L14.5 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  /* Android's own share glyph — three discs joined by two strokes, the shape
     Material draws and every Android phone has already taught (#490, decided
     2026-09-19). The Android BUILD's Share control wears this; iOS and the
     web keep the tray above, because on those the tray is the shape the
     platform teaches. The outcome marks stay one tray family on every build:
     the decision names the control only, and a second family of outcome
     glyphs would double the surface #249 has to check. Hand-rolled on the
     same 22-unit grid, `currentColor`, no icon font. */
  "share-android": (
    <>
      <path
        d="M6.5 11 L15.5 5 M6.5 11 L15.5 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="15.5" cy="5" r="2.2" fill="currentColor" />
      <circle cx="6.5" cy="11" r="2.2" fill="currentColor" />
      <circle cx="15.5" cy="17" r="2.2" fill="currentColor" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 22, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 22 22"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
