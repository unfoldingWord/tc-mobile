import { expect, test } from "@playwright/test";

/**
 * The phone check's DSP step, through the real MP3 worker (#1433, task T4),
 * against the SHIPPED `dist/` build.
 *
 * The Node suite proves the kernel's arithmetic and the report text, and it
 * reaches the worker only through the codec's fake. What only a browser can
 * say is that `?check=phone` -> Start runs the benchmark inside the real
 * blob-snapshot worker and that finite, positive numbers come back into the
 * report. This spec asserts that and nothing about speed: the timings the
 * issue exists to learn are phone-only (T5), and a headless runner's figures
 * say nothing about a phone.
 *
 * The DSP section is read off the report textarea, which is the one artefact
 * a tester pastes into #974, so a section the screen computed but the report
 * dropped fails here.
 */

const SECTION_HEADING = "DSP chain (1 minute of synthetic speech";

/** The lines of the DSP section: its heading up to the next blank line. */
function dspSection(report: string): string[] {
  const start = report.indexOf(SECTION_HEADING);
  if (start === -1) return [];
  return report
    .slice(start)
    .split(/\n\s*\n/)[0]!
    .split("\n");
}

test("the phone check's DSP step lands finite numbers from the real worker", async ({
  page,
}) => {
  // One minute of speech, twice, in a headless runner, plus the other steps.
  test.setTimeout(180_000);

  await page.goto("/?check=phone");
  await page.locator('[data-phone-check="start"]').click();

  const status = page.locator('[data-phone-check="status"]');
  await expect(status).toHaveText("Done.", { timeout: 150_000 });

  const report = await page.locator('[data-phone-check="report"]').inputValue();
  const lines = dspSection(report);
  expect(lines.length, "the report carries a DSP section").toBeGreaterThan(0);
  const text = lines.join("\n");

  // Landed, not failed and not skipped.
  expect(text).not.toMatch(/- failed:/);
  expect(text).not.toMatch(/not run/i);

  // Both runs report a positive, finite seconds-per-audio-minute figure.
  for (const label of ["Cold", "Warm"]) {
    const m = new RegExp(
      `- ${label} run: (\\d+(?:\\.\\d+)?) s per audio minute`
    ).exec(text);
    expect(m, `${label} run line`).not.toBeNull();
    const seconds = Number(m![1]);
    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(0);
  }

  // Per-stage times are present as finite ms figures ("under 1 ms" is a
  // legitimate fast stage, so it counts as a figure too).
  const stageLines = lines.filter((l) => l.includes("Stages:"));
  expect(stageLines).toHaveLength(2);
  for (const l of stageLines) {
    const figures = [...l.matchAll(/ (under 1|\d+) ms/g)];
    expect(figures).toHaveLength(5);
  }

  // A non-zero checksum for each run: an all-zero output means the kernel
  // produced nothing.
  const checksum =
    /- Output checksum: cold ([0-9a-f]{8}), warm ([0-9a-f]{8})/.exec(text);
  expect(checksum, "checksum line").not.toBeNull();
  expect(parseInt(checksum![1]!, 16)).toBeGreaterThan(0);
  expect(parseInt(checksum![2]!, 16)).toBeGreaterThan(0);

  // The kernel's working set is a positive size.
  const ws = /- Working set: (\d+(?:\.\d+)?) KB/.exec(text);
  expect(ws, "working-set line").not.toBeNull();
  expect(Number(ws![1])).toBeGreaterThan(0);
});
