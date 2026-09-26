/**
 * Which of the O4 workbench's five recorder states the stage is in (#945,
 * epic #936). `recorder.tsx` writes the answer to the stage's `data-o4-look`
 * attribute, only under O4, and `app/styles/o4/recorder.css` keys its
 * per-state rules off it; `RecorderStamp` (`recorder-o4.tsx`) reads it too.
 */

/** The workbench's recorder states: 08 idle, 09 recording, 10 recorded, 11 playing, 12 editing. */
export type RecorderLook =
  "idle" | "recording" | "recorded" | "playing" | "editing";

export function recorderLook({
  recording,
  playing,
  editing,
  hasAudio,
}: {
  recording: boolean;
  playing: boolean;
  editing: boolean;
  hasAudio: boolean;
}): RecorderLook {
  if (recording) return "recording";
  // An edit-mode audition is playing, as in the workbench (trim -> play).
  if (playing) return "playing";
  if (editing) return "editing";
  return hasAudio ? "recorded" : "idle";
}
