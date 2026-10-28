import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { stripYamlComments } from "./support";

/**
 * #1674 item 1: on a guard SKIP the Play and TestFlight lanes run no prep.
 *
 * #1616 put a pre-upload guard in both lanes and gated only the upload step on
 * its verdict, so a SKIP still ran `npm ci`, the web build, the key writes and
 * the native build while the lane lock was held, and a prep failure turned a
 * correct skip red. The APK lane already gates its build on the verdict.
 *
 * The workflow is read, not restated: each lane's steps are cut from the
 * stripped yml, every `if:` is evaluated by a small model of GitHub's
 * expression rules for the three situations a lane meets, and the steps that
 * would run are compared with the steps that must.
 *
 * - SKIP: the guard ran and said upload=false. Nothing after it may run
 *   except the always-steps (credential cleanup).
 * - UPLOAD: the guard said upload=true. Every step runs.
 * - build_only (Play only; no `inputs` context on a push, and the guard step
 *   is itself skipped): the prep and the build run, the upload and the
 *   Play-only secrets and gem install do not. A bare `upload == 'true'` on a
 *   prep step would break this state, which is why it is a case here.
 *
 * This is a model of the expression rules, not a run: no GitHub runner, no
 * signing and no upload took part. The native lanes have not been run with
 * this change.
 *
 * Read through the shared YAML comment strip (#822).
 */

interface Step {
  /** `name:` or the `uses:` line. */
  label: string;
  id: string | null;
  cond: string | null;
}

interface Lane {
  file: string;
  /** Does the lane have a `build_only` dispatch input? */
  buildOnly: boolean;
  /** Steps after the guard that must run on every path. */
  alwaysRuns: string[];
  /** Steps that run on an upload and on no other path. */
  uploadOnly: string[];
}

const LANES: Lane[] = [
  {
    file: "android-play.yml",
    buildOnly: true,
    alwaysRuns: ["Remove decoded credentials"],
    uploadOnly: [
      "Install fastlane",
      "Write the Play service-account key",
      "Upload to Google Play",
    ],
  },
  {
    file: "ios-testflight.yml",
    buildOnly: false,
    alwaysRuns: ["Remove decoded credentials"],
    uploadOnly: [],
  },
];

const text = (file: string) =>
  stripYamlComments(
    readFileSync(
      new URL(`../.github/workflows/${file}`, import.meta.url),
      "utf8"
    )
  );

/** The steps of `yml` from the guard step on, in order, guard included. */
function stepsFromGuard(yml: string): Step[] {
  const guardAt = yml.indexOf("        id: guard\n");
  if (guardAt < 0) throw new Error("no guard step");
  const start = yml.lastIndexOf("\n      - ", guardAt) + 1;
  const body = yml.slice(start);
  if (/^ {2}[A-Za-z0-9_-]+:$/m.test(body)) {
    throw new Error("a second job follows the guard; read the wrong slice");
  }
  const chunks = body.split(/^(?= {6}- )/m).filter((c) => c.trim() !== "");
  return chunks.map((c) => {
    const first = /^ {6}- (name|uses): (.+)$/m.exec(c);
    if (!first) throw new Error(`unreadable step: ${c.slice(0, 60)}`);
    const id = /^ {8}id: (\S+)$/m.exec(c)?.[1] ?? null;
    const cond = /^ {8}if: (.+)$/m.exec(c)?.[1]?.trim() ?? null;
    return { label: first[2]?.trim() ?? "", id, cond };
  });
}

interface World {
  /** The guard's `upload` output, or "" when the guard did not write one. */
  upload: string;
  /** `inputs.build_only`, empty on a push. */
  buildOnly: boolean;
}

/**
 * Which steps run, in order. Models the job-status rule: a step with no `if:`
 * runs only while nothing before it failed (nothing fails here); `always()`
 * runs regardless. `steps.<id>.outcome` is "success" for a step that ran and
 * "skipped" for one that did not.
 */
function ran(steps: Step[], world: World): Set<string> {
  const outcome = new Map<string, string>();
  const out = new Set<string>();
  steps.forEach((s) => {
    const runs = s.cond === null ? true : evaluate(s.cond, world, outcome);
    if (runs) out.add(s.label);
    if (s.id) outcome.set(s.id, runs ? "success" : "skipped");
  });
  return out;
}

/** One `${{ ... }}` over the context names the lanes use; anything else throws. */
function evaluate(
  cond: string,
  world: World,
  outcome: Map<string, string>
): boolean {
  // `if:` takes a bare expression or one wrapped in `${{ }}`.
  const m = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(cond);
  const raw = m ? (m[1] ?? "") : cond;
  const expr = raw
    .replace(/steps\.guard\.outputs\.upload/g, "ctx.upload")
    .replace(/inputs\.build_only/g, "ctx.buildOnly")
    .replace(/steps\.(\w+)\.outcome/g, (_, id: string) =>
      JSON.stringify(outcome.get(id) ?? "skipped")
    )
    .replace(/always\(\)/g, "true");
  const left = expr.replace(/"[^"]*"|'[^']*'|ctx\.\w+|true|false/g, "");
  if (/[A-Za-z_$]/.test(left))
    throw new Error(`unmodelled expression: ${cond}`);
  const fn = new Function("ctx", `return Boolean(${expr});`) as (
    ctx: World
  ) => boolean;
  return fn(world);
}

describe.each(LANES)("$file: prep waits for the guard (#1674)", (lane) => {
  const steps = stepsFromGuard(text(lane.file));
  const after = steps.slice(1);
  const labels = after.map((s) => s.label);

  it("finds the steps it expects to reason about", () => {
    expect(steps[0]?.id).toBe("guard");
    expect(after.length).toBeGreaterThan(8);
    for (const name of [...lane.alwaysRuns, ...lane.uploadOnly]) {
      expect(labels).toContain(name);
    }
    expect(labels).toContain("Install dependencies");
  });

  it("on a SKIP runs nothing after the guard except the always-steps", () => {
    const skipped = ran(steps, { upload: "false", buildOnly: false });
    const ranAfter = labels.filter((l) => skipped.has(l));
    expect(ranAfter).toEqual(lane.alwaysRuns);
  });

  it("on an UPLOAD runs every step", () => {
    const all = ran(steps, { upload: "true", buildOnly: false });
    expect(labels.filter((l) => !all.has(l))).toEqual([]);
  });

  it("names the first prep step as gated, so the mutation has a target", () => {
    const first = after.find((s) => s.label === "Install dependencies");
    expect(first?.cond).toContain("steps.guard.outputs.upload == 'true'");
  });

  if (lane.buildOnly) {
    it("a build_only run (no guard verdict) still preps and builds, and only skips the upload-only steps", () => {
      const bo = ran(steps, { upload: "", buildOnly: true });
      const missing = labels.filter((l) => !bo.has(l));
      expect(missing.sort()).toEqual([...lane.uploadOnly].sort());
      expect(bo.has("Install dependencies")).toBe(true);
      expect(bo.has("Build the release bundle")).toBe(true);
      expect(bo.has("Write the upload keystore")).toBe(true);
    });

    it("the guard itself is skipped on build_only, which is why prep cannot gate on the verdict alone", () => {
      expect(
        ran(steps, { upload: "", buildOnly: true }).has(steps[0]?.label ?? "")
      ).toBe(false);
    });
  }
});

describe("the model reads the conditions, not a constant", () => {
  it("a prep step with no condition would run on a SKIP", () => {
    const steps: Step[] = [
      { label: "guard", id: "guard", cond: null },
      { label: "Install dependencies", id: null, cond: null },
    ];
    expect(ran(steps, { upload: "false", buildOnly: false })).toContain(
      "Install dependencies"
    );
  });

  it("a bare upload == 'true' on a prep step would skip it on build_only", () => {
    const steps: Step[] = [
      { label: "guard", id: "guard", cond: "${{ !inputs.build_only }}" },
      {
        label: "Install dependencies",
        id: null,
        cond: "${{ steps.guard.outputs.upload == 'true' }}",
      },
    ];
    expect(ran(steps, { upload: "", buildOnly: true })).not.toContain(
      "Install dependencies"
    );
  });

  it("refuses an expression it does not model", () => {
    expect(() =>
      evaluate(
        "${{ github.event_name == 'push' }}",
        { upload: "", buildOnly: false },
        new Map()
      )
    ).toThrow(/unmodelled/);
  });
});
