import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripYamlComments } from "./support";

// #1442: the PR-body gate runs in its own workflow so that a body or title
// edit can re-run it without cancelling the full CI (`edited` is not in
// ci.yml's trigger). This reads the workflow text, comments stripped first
// (#822), so a commented-out line cannot satisfy a pin.
const ROOT = path.join(import.meta.dirname, "..");
const FILE = ".github/workflows/pr-body.yml";
const workflow = stripYamlComments(readFileSync(path.join(ROOT, FILE), "utf8"));

/** The text of every `run:` step: a one-line value or an indented block. */
function runBodies(yaml: string): string[] {
  const lines = yaml.split("\n");
  const bodies: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:[ \t]*(.*)$/.exec(lines[i] ?? "");
    if (!m) continue;
    const indent = (m[1] ?? "").length;
    let value = (m[2] ?? "").trim();
    if (/^[|>][+-]?$/.test(value)) {
      const block: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j] ?? "";
        const lead = /^(\s*)\S/.exec(line);
        if (lead && (lead[1] ?? "").length <= indent) break;
        block.push(line.trim());
      }
      value = block.filter(Boolean).join("\n");
    }
    bodies.push(value);
  }
  return bodies;
}

describe(`${FILE} runs the PR-body gate (#1442)`, () => {
  it("fires on pull_request for every event that can change the body or the head", () => {
    const m = /^on:\s*\n\s+pull_request:\s*\n\s+types:\s*\[([^\]]*)\]/m.exec(
      workflow
    );
    expect(m).not.toBeNull();
    const types = (m?.[1] ?? "").split(",").map((t) => t.trim());
    for (const t of [
      "opened",
      "edited",
      "reopened",
      "synchronize",
      "ready_for_review",
    ]) {
      expect(types).toContain(t);
    }
  });

  it("is triggered by pull_request only, never pull_request_target or push", () => {
    expect(workflow).not.toMatch(/pull_request_target/);
    expect(workflow).not.toMatch(/^\s+push:/m);
  });

  it("holds contents: read and nothing else", () => {
    const m = /^permissions:\s*\n((?:[ \t]+\S.*\n?)+)/m.exec(workflow);
    expect(m).not.toBeNull();
    const entries = (m?.[1] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(entries).toEqual(["contents: read"]);
  });

  it("reads Node from .node-version, with no literal pin", () => {
    expect(workflow).toMatch(/actions\/setup-node@/);
    expect(workflow).toMatch(/node-version-file:\s*\.node-version/);
    expect(workflow).not.toMatch(/node-version:\s*["']?\d/);
  });

  it("checks out full history, so the size cap can diff origin/<base>...<head>", () => {
    expect(workflow).toMatch(/actions\/checkout@/);
    expect(workflow).toMatch(/fetch-depth:\s*0\b/);
    expect(workflow).toMatch(/persist-credentials:\s*false/);
  });

  it("names the job so it reads as a check", () => {
    expect(workflow).toMatch(/^\s+name:\s*PR Body\s*$/m);
  });

  it("runs the gate on the event payload file", () => {
    expect(runBodies(workflow)).toContain(
      'node scripts/check-pr-body.mjs --event "$GITHUB_EVENT_PATH"'
    );
  });

  it("never puts PR-controlled text in a shell command", () => {
    // A title or body is attacker-controlled; interpolating either into a
    // `run:` is a script injection. The gate reads the payload from disk.
    expect(workflow).not.toMatch(
      /github\.event\.pull_request\.(body|title|head\.ref)/
    );
    const runs = runBodies(workflow);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run).not.toContain("${{");
    }
  });
});
