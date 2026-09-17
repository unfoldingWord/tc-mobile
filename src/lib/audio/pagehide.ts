/**
 * What a `pagehide` owes an in-progress capture (#58).
 *
 * The handler in `hooks/use-audio-session.ts` used to be
 * `const onPageHide = () => leave();` — an unconditional teardown that reaches
 * `cancel()` and empties the chunk array. Under the F8 commit-on-close model
 * nothing has been written to the database until the recorder sheet closes, so
 * that discarded the WHOLE take, and the pending slot stayed empty: no recovery
 * screen, nothing to record over, nothing to say. A `pagehide` that the browser
 * only SUSPENDED the page for — `event.persisted === true`, the bfcache case
 * that a `pageshow` restores with every ref, stream and `MediaRecorder` intact —
 * lost a multi-minute recording to a navigation the page came straight back
 * from.
 *
 * The decision is here, pure, so all ten cells are proven in plain Node rather
 * than only on a device. The hook keeps the browser wiring — the sibling of
 * `floor-transitions.ts`, and consumed by the same hook.
 *
 * `CaptureState` is imported from `lib/takes/close-plan.ts` rather than
 * re-declared. That file's own note explains why it is a local union and not an
 * import of `RecorderState`: `lib/` may not reach `hooks/`. Nothing there argues
 * against two `lib/` modules sharing ONE union, and two copies of a five-member
 * state list is how a sixth state gets added to one of them. The import is
 * type-only, so it is erased and adds no runtime edge.
 */

import type { CaptureState } from "@/lib/takes/close-plan";

/**
 * What the session does with the capture:
 *
 *   release  the full `leave()` — floor, microphone, take and all.
 *   pause    suspend capture and HOLD the chunks; the take survives a restore.
 *   none     leave the capture exactly as it is.
 *
 * Playback is silenced on all three: nothing should keep sounding into a hidden
 * page, whatever happens to the microphone. That is the hook's job, not this
 * table's — see the handler.
 */
type PageHideAction = "release" | "pause" | "none";

/**
 * Decide it.
 *
 * `persisted === false` is a real teardown: the page is going away and may never
 * come back, so everything is released. That is byte-identical to the pre-#58
 * behaviour, deliberately — nothing regresses on this path even if every
 * assumption below about the bfcache turns out to be wrong on a real device.
 * Committing the take instead is NOT an option here and is not a gap this
 * function leaves open: `leave()`'s own comment gives the reason (`addTake`
 * makes every new take the active one, so writing a fragment would quietly
 * replace a good recording with a truncated one), and there is no guarantee an
 * async stop → decode → write started inside a `pagehide` handler ever finishes.
 *
 * `persisted === true` is a suspend, and each state owes something different:
 *
 *   recording   pause. `pause()` banks the elapsed span, stops the tick and
 *               freezes the scope before `setState("paused")`, so the take is
 *               whole and the timer cannot jump on resume — and "paused" is an
 *               already-existing, already-reviewed state the recorder renders
 *               Resume and a close-commit from. It does NOT bet on the mic
 *               surviving the freeze: if the stream dies, the track's `ended`
 *               fires the #59 interruption path into `processing`, where
 *               `stop()` still recovers the chunks.
 *   paused      nothing. The mic is already suspended-but-held and still owns
 *               the floor; there is no capture to stop and releasing would be
 *               the very discard this fixes.
 *   processing  nothing, and emphatically not "release". A #59 mic interruption
 *               freezes a REAL take here whose chunks `stop()` recovers; so does
 *               a stop already in flight. Cancelling either loses audio.
 *
 *               This is the one cell that changes a CONTRACT the unchanged tree
 *               was written against (George R1 P2-2): `stop()` steals the chunks,
 *               stream and tap into locals before its first await precisely
 *               because a `pagehide` used to mean `cancel()`. It still does, on
 *               `persisted === false`. On `persisted === true` the stop stays
 *               CURRENT, and every consumer of supersession — `classifyCapture`,
 *               `classifyStopDecode`, `planClose` — treats it as a case it
 *               handles, never an invariant it requires, so none of them breaks;
 *               supersession still arrives from a newer `start()`, from `cancel()`
 *               on unmount, and from every `leave()`. The outcomes both ways:
 *               RESTORED, the in-flight stop resumes and `close()` reaches
 *               `save-take` instead of the superseded arm, which drops the take
 *               and its pending edits — strictly better. DISCARDED, nothing
 *               further runs in EITHER design: `cancel()` only mutated heap refs,
 *               so the old teardown persisted nothing a discard now loses. The
 *               #165 held blob is produced after those awaits and is in memory
 *               too, so it is equally unreachable. Nothing that was kept before
 *               is lost now.
 *   requesting  nothing. A `getUserMedia` prompt is up and no recorder exists; a
 *               frozen page cannot resolve it either way.
 *   idle        nothing. Nothing has been captured.
 *
 * No `default:` arm on purpose: a sixth state added to `CaptureState` fails
 * `npm run typecheck:lib` here instead of silently reading as "nothing to do".
 */
export function pageHideAction(
  state: CaptureState,
  persisted: boolean
): PageHideAction {
  if (!persisted) return "release";
  switch (state) {
    case "recording":
      return "pause";
    case "paused":
    case "processing":
    case "requesting":
    case "idle":
      return "none";
  }
}
