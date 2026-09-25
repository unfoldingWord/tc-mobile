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
  | "more"
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
  | "share-android"
  | "share-busy"
  // The O4 batch (#940, part of #936): the 13 icons the O4 screens use,
  // redrawn from the 24-unit, stroke-2.2 reference sprite
  // (docs/design/o4/o4-icons.svg, landing with #935) onto this file's
  // 22-unit grid at a proportionally scaled stroke. No screen wires any of
  // these yet — that is a later O4 batch under #936 — so today's only
  // consumer is this file's own render tests.
  | "hear"
  | "hear-large"
  | "mic"
  | "tap-hand"
  | "pencil"
  | "restart"
  | "phone"
  | "file-zip"
  | "file-audio"
  | "book"
  | "book-open"
  | "person"
  | "open";

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
  // Three dots, stacked — an object's own menu (a book, a chapter, a segment,
  // since #589/#683) and, since #863, the recorder's edit-toolbar menu
  // opener. Distinguishes these from the global ≡ (#608) and from the
  // recorder's own record-mode header opener, which stays ≡.
  more: (
    <>
      <circle cx="11" cy="6" r="2" fill="currentColor" />
      <circle cx="11" cy="11" r="2" fill="currentColor" />
      <circle cx="11" cy="16" r="2" fill="currentColor" />
    </>
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
  /* The four outcomes a share can settle into (#178, #491, redrawn for #850):
     standard platform marks, not an invented tray family. Each follows a
     Material Symbols shape for the state it names, so the SILHOUETTE is one
     a translator may already have seen on a phone somewhere else, rather
     than a share-specific glyph nobody has met before. Each stays a
     hand-drawn path on the same 22-unit grid, `currentColor`, no icon font —
     the precedent #490 already set for the Android Share control.

     Whether a non-reader actually reads any of the four this way is NOT
     decided here. That is the ten-minute icon-recognition protocol at the
     training (#249), which #178 named as its own acceptance evidence and
     which none of the four below has been through yet. */
  /* `share-partial`: an open ring, three-quarters drawn — Material's
     `incomplete_circle`. The gap IS the message: some of the chapter went
     out and some did not, the way a partly-filled ring already reads
     "not finished" in a battery or a download meter. Distinct from the full,
     closed ring `share-sent` draws below. */
  "share-partial": (
    <path
      d="M11 3.6 A7.4 7.4 0 1 1 3.6 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  /* `share-empty`: a closed ring with a single bar through the middle —
     Material's `do_not_disturb`, the standard "nothing here" mark. `nothing`
     and `failed` (the triangle below) share a tone (#178), so this shape is
     the ONLY thing that tells a non-reader "there is nothing to share yet"
     from "it tried and failed" — a closed ring is also not the open,
     three-quarter one `share-partial` draws above, so the three marks that
     can share a modal stay three different silhouettes. */
  "share-empty": (
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
        d="M6.8 11 L15.2 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </>
  ),
  /* The two outcomes a share can end in once the sheet has closed (#491).
     `share-sent`: a closed ring with a tick — Material's `check_circle`, the
     universal "done" mark. Not the bare `check` (that is the "Share now"
     control the person just tapped, and a success wearing the control's own
     mark says "tap this" rather than "this happened") and not the plain
     `share`. It means HANDED TO THE SHEET and nothing further — a resolve
     proves the bytes reached the OS, not that any app kept them
     (`resolveProvesDelivery`), so the copy under it stops there too.

     `share-closed`: a plain X — Material's `close`, the standard dismiss
     mark. Not `back` (a control glyph, not an outcome) and not the alert
     triangle: this outcome carries the `info` tone and the muted ink, not
     the failure colour, so the mark must not read as an error either.

     Neither mark has been shown to a non-reader; #249 is the acceptance
     evidence for both, the same as `share-partial`/`share-empty` above.
     Drawn at 48px (the modal) — check them there before claiming anything
     about legibility. */
  "share-sent": (
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
        d="M7.6 11.2 L9.8 13.6 L14.6 8.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  "share-closed": (
    <path
      d="M7.2 7.2 L14.8 14.8 M14.8 7.2 L7.2 14.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
  ),
  /* Android's own share glyph — three discs joined by two strokes, the shape
     Material draws and every Android phone has already taught (#490, decided
     2026-09-19). The Android BUILD's Share control wears this; iOS and the
     web keep the tray above (`share`, the plain up-arrow-out-of-a-tray),
     because on those the tray is the shape the platform teaches. #490 names
     the CONTROL glyph only. The share OUTCOME marks are a separate
     vocabulary: #850 redrew four of them (sent, closed, partial, empty) to
     Material Symbols shapes on every build alike, and `failed` keeps the
     shared `alert` triangle. That redraw does not reopen #490, since #490
     was never about them. Hand-rolled on the same 22-unit grid, `currentColor`,
     no icon font. */
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
  /* The share overlay's busy mark (#850): a ring of eight dots, the
     iOS/Material indeterminate activity indicator a translator has already
     seen in every camera roll and app-store download — not the static
     `retry` arrow the overlay used to borrow from `notice-tone.ts`'s shared
     `busy` entry for every OTHER wait in the app.

     The eight dots are drawn pre-faded, each one dimmer than the last going
     clockwise from the top. `.share-scrim[data-outcome="busy"]
     .share-progress-glyph` (3-components.css) already rotates whatever sits
     in the busy slot on the same `control-spin` keyframes every
     `aria-busy` control uses, and already drops to a still frame under
     `prefers-reduced-motion: reduce` — that rule predates this glyph, so
     spinning the pre-faded ring is the whole animation; nothing new was
     added to the stylesheet. The pre-fade also matters for the
     reduced-motion case: eight EQUALLY lit dots sitting still would read as
     a plain ring, not a paused spinner, so the fade itself has to be baked
     into the glyph rather than done by the animation.

     Scoped to the share overlay only. `notice-tone.ts`'s own `busy` entry —
     the retry arc every other wait in the app still wears — is unchanged;
     widening this to every `Notice` is out of #850's scope. */
  "share-busy": (
    <>
      <circle cx="11" cy="3.6" r="1.5" fill="currentColor" opacity="1" />
      <circle cx="16.23" cy="5.77" r="1.5" fill="currentColor" opacity="0.85" />
      <circle cx="18.4" cy="11" r="1.5" fill="currentColor" opacity="0.7" />
      <circle
        cx="16.23"
        cy="16.23"
        r="1.5"
        fill="currentColor"
        opacity="0.55"
      />
      <circle cx="11" cy="18.4" r="1.5" fill="currentColor" opacity="0.4" />
      <circle cx="5.77" cy="16.23" r="1.5" fill="currentColor" opacity="0.28" />
      <circle cx="3.6" cy="11" r="1.5" fill="currentColor" opacity="0.18" />
      <circle cx="5.77" cy="5.77" r="1.5" fill="currentColor" opacity="0.12" />
    </>
  ),
  // The speaker glyph — "hear the name/title" buttons. A filled speaker cone
  // with two sound-wave arcs, redrawn from o4-icons.svg's `hear` symbol.
  hear: (
    <>
      <path
        d="M3.7 8.7 3.7 13.3 6.9 13.3 11 17 11 5 6.9 8.7Z"
        fill="currentColor"
      />
      <path
        d="M14.2 8.3a3.7 3.7 0 0 1 0 5.5M16.5 6a6.9 6.9 0 0 1 0 10.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
  // The same speaker, drawn with wider wave spacing for the large "hear this"
  // controls (the recorder stage, the sheet header) — o4-icons.svg's
  // `hear-large` symbol.
  "hear-large": (
    <>
      <path
        d="M3.2 8.3 3.2 13.8 6.9 13.8 11.5 17.9 11.5 4.1 6.9 8.3Z"
        fill="currentColor"
      />
      <path
        d="M14.2 7.8a4.6 4.6 0 0 1 0 6.4M17 5a8.3 8.3 0 0 1 0 11.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
  // Microphone body, capsule outline over the stand — the record-permission
  // and name-recording glyph, redrawn from o4-icons.svg's `mic` symbol. Not
  // to be confused with `record` (the filled dot the transport wears).
  mic: (
    <>
      <rect
        x="8.3"
        y="2.8"
        width="5.5"
        height="10.1"
        rx="2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M4.6 10.1a6.4 6.4 0 0 0 12.8 0M11 16.5v2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
  // A hand tapping — the guided "tap here" affordance. Redrawn from
  // o4-icons.svg's `tap-hand` symbol; the most detailed path in this batch
  // (four fingers over a palm), kept as one path since the original draws it
  // as continuous strokes.
  "tap-hand": (
    <path
      d="M7.3 11.9V5a1.4 1.4 0 0 1 2.8 0V10.1M10.1 9.6V3.7a1.4 1.4 0 0 1 2.7 0V9.6M12.8 9.6V5a1.4 1.4 0 0 1 2.8 0V11M15.6 8.7a1.4 1.4 0 0 1 2.7 0V13.8a5.5 5.5 0 0 1-5.5 5.5h-1.3a5.5 5.5 0 0 1-4.3-2.1L4.6 14.2a1.5 1.5 0 0 1 2.2-1.9L7.3 12.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // A pencil, tip to the lower-left — the segment/book rename affordance.
  // Redrawn from o4-icons.svg's `pencil` symbol. Distinct from the existing
  // `edit` glyph (the row-menu "Edit" entry that reopens the recorder);
  // this one is the O4 screens' own rename control.
  pencil: (
    <>
      <path
        d="M3.7 18.3H7.3L17.4 8.3 13.8 4.6 3.7 14.7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.4 6l3.6 3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
  // A refresh arc with its arrowhead — "try again" / "start again", redrawn
  // from o4-icons.svg's `restart` symbol. Distinct from the existing `retry`
  // glyph (a smaller, differently proportioned arc already in use elsewhere).
  restart: (
    <>
      <path
        d="M18.3 11a7.3 7.3 0 1 1-2.1-5.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M18.3 3.7V8.3H13.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  // A phone outline with a home indicator — "ask your helper", redrawn from
  // o4-icons.svg's `phone` symbol.
  phone: (
    <>
      <rect
        x="6.4"
        y="2.3"
        width="9.2"
        height="17.4"
        rx="2.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M10.1 16.5h1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </>
  ),
  // An arrow leaving an open bracket — "open" (a book, a file), redrawn from
  // o4-icons.svg's `open` symbol. Not `chevron-right` (a disclosure caret)
  // and not `share` (the OS tray).
  open: (
    <>
      <path
        d="M12.8 4.6l5.5 5.5-5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.3 10.1H9.2a5.5 5.5 0 0 0-5.5 5.5v1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  // An open book, two facing pages over a shared spine — redrawn from
  // o4-icons.svg's `book-open` symbol (a closed-path cubic-bezier outline).
  // Distinct from the plain `book` cover glyph below.
  "book-open": (
    <>
      <path
        d="M2.3 5.5C5 4 8.1 4 11 6.1 13.9 4 17 4 19.7 5.5V17.4C17 16 13.9 16 11 18 8.1 16 5 16 2.3 17.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11 6.1v11.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </>
  ),
  // A head and shoulders — "ask your helper", redrawn from o4-icons.svg's
  // `person` symbol.
  person: (
    <>
      <circle
        cx="11"
        cy="7.3"
        r="3.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M3.7 19.3a7.3 7.3 0 0 1 14.6 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </>
  ),
  // A closed book, spine at the bottom — a book's cover/list glyph, redrawn
  // from o4-icons.svg's `book` symbol.
  book: (
    <>
      <rect
        x="4.6"
        y="2.8"
        width="12.8"
        height="16.5"
        rx="1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M4.6 15.6h12.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
  // A zip archive: a file outline, a dashed fold, and a zipper pull —
  // "Share Book" (a zip of chapter MP3s, per B7/#33), redrawn from
  // o4-icons.svg's `file-zip` symbol.
  "file-zip": (
    <>
      <path
        d="M5.5 2.8H13.8L17.4 6.4V19.3H5.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.8 2.8V6.4H17.4M10.1 2.8V4.6M10.1 6.4V8.3M10.1 10.1V11.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="8.7"
        y="12.8"
        width="2.8"
        height="3.7"
        rx="0.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </>
  ),
  // An audio file: the same file outline and fold, with waveform bars in
  // place of the zip pull — "Share Chapter" (one concatenated MP3),
  // redrawn from o4-icons.svg's `file-audio` symbol.
  "file-audio": (
    <>
      <path
        d="M5.5 2.8H13.8L17.4 6.4V19.3H5.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.8 2.8V6.4H17.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.3 14.7V11.9M11 16.5V10.1M13.8 14.7V11.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
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
