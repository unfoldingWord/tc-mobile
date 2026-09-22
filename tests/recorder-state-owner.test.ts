import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const audioSession = readFileSync("src/hooks/use-audio-session.ts", "utf8");
const recorder = readFileSync("src/hooks/use-recorder.ts", "utf8");

function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(";", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("recorder state ownership (#173)", () => {
  it("useRecorder exposes a synchronous readState from the owner", () => {
    expect(recorder).toMatch(/readonly readState: \(\) => RecorderState;/);
    expect(recorder).toMatch(
      /const stateRef = useRef<RecorderState>\("idle"\);/
    );
    expect(recorder).toMatch(
      /const readState = useCallback\(\(\): RecorderState => stateRef\.current, \[\]\);/
    );
  });

  it("useAudioSession consumes readState instead of mirroring and eagerly writing recorder state", () => {
    expect(audioSession).toMatch(/readState: readRecorderState,/);
    expect(audioSession).not.toMatch(/recorderStateRef/);
    expect(bodyOf(audioSession, "resumeRecording")).not.toMatch(
      /readRecorderState|recorderState.*=.*["']recording["']/
    );
  });
});
