import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { region, stripHtmlComments, uniqueIndexOf } from "./support";

// #1321: the runbook's section 5 rollback read is a bash block a person
// runs before a promotion. It is the only record of what production serves
// when a rollback is wanted, so it is run here for real: the block is cut
// out of the runbook, its two production origins are swapped for local
// servers, and bash executes it. Both states are tested: a gate that only
// went red on a bad origin would not prove it stays green on a good one.

const ROOT = path.resolve(import.meta.dirname, "..");
const PROD = "https://tcmobile.app";
const WORKERS = "https://tc-mobile.unfoldingword.workers.dev";

function rollbackBlock(): string {
  const text = stripHtmlComments(
    readFileSync(path.join(ROOT, "docs/release/promotion-v1.0.0.md"), "utf8")
  );
  const start = uniqueIndexOf(text, "## 5. Rollback readiness");
  const fence = text.indexOf("```bash\n", start) + "```bash\n".length;
  const end = text.indexOf("\n```", fence);
  return region(text, { from: fence, to: end });
}

type Reply = { status: number; body: string; type?: string } | "hangup";

let server: Server;
let base: string;
const replies = new Map<string, Reply>();

beforeAll(async () => {
  server = createServer((req, res) => {
    const key = (req.url ?? "").split("/")[1];
    const reply = replies.get(key ?? "");
    if (!reply || reply === "hangup") {
      req.socket.destroy();
      return;
    }
    res.writeHead(reply.status, {
      "content-type": reply.type ?? "application/json",
    });
    res.end(reply.body);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

function run(a: Reply, b: Reply) {
  replies.set("a", a);
  replies.set("b", b);
  const script = rollbackBlock()
    .replace(PROD, `${base}/a`)
    .replace(WORKERS, `${base}/b`);
  return new Promise<{ code: number; out: string }>((done) => {
    execFile("bash", ["-c", script], (err, stdout, stderr) => {
      const code = err ? ((err as { code?: number }).code ?? 1) : 0;
      done({ code, out: stdout + stderr });
    });
  });
}

const good = (sha: string, version: string): Reply => ({
  status: 200,
  body: JSON.stringify({ sha, version, builtAt: "x" }),
});

describe("runbook section 5 rollback read", () => {
  it("names both production origins, so the swap below cannot be a no-op", () => {
    const block = rollbackBlock();
    expect(block).toContain(PROD);
    expect(block).toContain(WORKERS);
  });

  it("two good origins: exit 0 and an OK line each", async () => {
    const { code, out } = await run(
      good("abc1234", "1.2.3"),
      good("abc1234", "1.2.3")
    );
    expect(code).toBe(0);
    expect(out.match(/^OK: /gm)).toHaveLength(2);
    expect(out).not.toContain("FAIL");
  });

  it("prints values decoded, not as quoted JSON, with quote and backslash intact", async () => {
    const { code, out } = await run(
      good('a"b\\c', "1.2.3"),
      good("abc1234", "1.2.3")
    );
    expect(code).toBe(0);
    expect(out).toContain('sha=a"b\\c version=1.2.3');
    expect(out).not.toContain('sha="');
  });

  it("an origin that does not answer: exit non-zero after trying both, and says it did not answer", async () => {
    const { code, out } = await run("hangup", good("abc1234", "1.2.3"));
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL: .*\/a did not answer/);
    expect(out).toMatch(/OK: .*\/b sha=abc1234/);
  });

  it("an HTTP error is an origin that did not answer", async () => {
    const { code, out } = await run(good("abc1234", "1.2.3"), {
      status: 500,
      body: "boom",
    });
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL: .*\/b did not answer/);
  });

  it.each([
    ["an HTML 200", { status: 200, body: "<html></html>", type: "text/html" }],
    ["an empty 200", { status: 200, body: "" }],
    ["a record with an empty sha", good("", "1.2.3")],
    ["a record with a control character", good("abc\u001b[2J", "1.2.3")],
    ["a record with a space", good("abc 123", "1.2.3")],
    ["a record with a bidi control", good("abc‮123", "1.2.3")],
  ] as [string, Reply][])(
    "%s: exit non-zero and say it answered but is not a deploy record",
    async (_name, bad) => {
      const { code, out } = await run(bad, good("abc1234", "1.2.3"));
      expect(code).toBe(1);
      expect(out).toMatch(/FAIL: .*\/a answered but .*not a deploy record/);
      expect(out).not.toMatch(/did not answer/);
      expect(out).toMatch(/OK: .*\/b sha=abc1234/);
    }
  );
});
