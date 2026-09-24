import { execFile, execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  compareDeployed,
  DEFAULT_ORIGIN,
  describeFetchFailure,
  ensureRemoteRefFresh,
  isCanonicalOrigin,
  isJsonContentType,
  isMainEntry,
  parseArgs,
  PROD_ORIGIN,
  remoteRefForOrigin,
  resolveExpected,
  resolveExpectedSha,
  resolveExpectedVersion,
  SHA_LENGTH,
  shasMatch,
  SpaFallbackError,
} from "../scripts/check-deploy.mjs";

// An independent oracle for "this checkout's version", read the same way
// `currentVersion()` reads it but without importing it — the fallback
// assertions below must pin the *behaviour* (fall back to the working tree),
// not a literal that goes stale at the next release bump.
const LOCAL_VERSION: string = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")
).version;

describe("compareDeployed", () => {
  it("passes when sha and version both match", () => {
    const result = compareDeployed(
      { version: "0.1.12", sha: "abc1234" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result).toEqual({
      ok: true,
      shaMatches: true,
      versionMatches: true,
    });
  });

  it("fails on a sha mismatch even if the version matches", () => {
    const result = compareDeployed(
      { version: "0.1.12", sha: "old0000" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result.ok).toBe(false);
    expect(result.shaMatches).toBe(false);
    expect(result.versionMatches).toBe(true);
  });

  it("fails on a version mismatch even if the sha matches", () => {
    const result = compareDeployed(
      { version: "0.1.11", sha: "abc1234" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result.ok).toBe(false);
    expect(result.shaMatches).toBe(true);
    expect(result.versionMatches).toBe(false);
  });

  it("fails when both mismatch", () => {
    const result = compareDeployed(
      { version: "0.1.11", sha: "old0000" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result).toEqual({
      ok: false,
      shaMatches: false,
      versionMatches: false,
    });
  });

  // round-1 George G3: the producer (vite.config.ts) and consumer
  // (check-deploy.mjs) can disagree on short-sha length if either drifts
  // from the pinned `--short=7`. `compareDeployed` compares by prefix (via
  // `shasMatch`) so a same-commit prefix still matches even if lengths
  // differ.
  it("matches shas of different lengths when one is a prefix of the other", () => {
    const result = compareDeployed(
      { version: "0.1.12", sha: "abc1234ff" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result.shaMatches).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("still fails when prefixes genuinely differ", () => {
    const result = compareDeployed(
      { version: "0.1.12", sha: "abc9999ff" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result.shaMatches).toBe(false);
  });

  // Round-3 George P3-1: `git rev-parse --short=<N>` is a *minimum*, not
  // exact — git emits more characters when the requested length is
  // ambiguous. The previous implementation truncated both sides to
  // SHA_LENGTH before comparing, which throws away exactly the
  // disambiguating suffix: two different commits sharing the same 7-char
  // prefix (abc1234f, abc1234e) both truncated to abc1234 and compared
  // equal — a false PASS on a promotion that changed the commit but not the
  // version. `compareDeployed` must reject this pair, not pass it.
  it("rejects two same-length shas that share the pinned-length prefix but disagree on git's disambiguating suffix (the exact truncation false PASS this fix closes)", () => {
    const result = compareDeployed(
      { version: "0.1.12", sha: "abc1234f" },
      { version: "0.1.12", sha: "abc1234e" }
    );
    expect(result.shaMatches).toBe(false);
    expect(result.ok).toBe(false);
  });
});

describe("shasMatch", () => {
  it("matches two identical shas", () => {
    expect(shasMatch("abc1234", "abc1234")).toBe(true);
  });

  it("matches when the longer sha starts with the shorter one", () => {
    expect(shasMatch("abc1234", "abc1234ffffffff")).toBe(true);
  });

  it("matches symmetrically regardless of argument order", () => {
    expect(shasMatch("abc1234ffffffff", "abc1234")).toBe(true);
  });

  // The exact bug this function replaces `normalizeSha` + equality to fix:
  // truncating both sides to SHA_LENGTH would have made this pair equal.
  it("rejects two same-length shas that share the pinned-length prefix but diverge in git's disambiguating suffix", () => {
    expect(shasMatch("abc1234f", "abc1234e")).toBe(false);
  });

  it("rejects a longer sha that does not actually start with the shorter one", () => {
    expect(shasMatch("abc1234ff", "abc1234aa")).toBe(false);
  });

  it("rejects prefixes that differ within the pinned length", () => {
    expect(shasMatch("abc9999ff", "abc1234")).toBe(false);
  });

  // A "prefix match" of fewer than SHA_LENGTH characters is not a
  // meaningful disambiguation — a 3-character prefix collides constantly.
  it("does not treat a too-short string as a valid prefix match", () => {
    expect(shasMatch("abc", "abc1234")).toBe(false);
  });

  it("compares non-string input by identity, matching normalizeSha's previous fallback behavior", () => {
    expect(shasMatch(undefined, undefined)).toBe(true);
    expect(shasMatch(undefined, "abc1234")).toBe(false);
  });
});

describe("isMainEntry", () => {
  // round-1 Frank F1: `import.meta.url` percent-encodes the path (spaces
  // become %20); building the comparison URL by hand from `process.argv[1]`
  // does not, so a checkout path with a space never matched and `main()`
  // silently never ran. `isMainEntry` must use the same encoding on both
  // sides via `pathToFileURL`.
  it("matches when the module URL is the pathToFileURL of argv[1], space and all", () => {
    const argvPath = "/home/user/My Checkout/scripts/check-deploy.mjs";
    const moduleUrl = pathToFileURL(argvPath).href;
    expect(isMainEntry(moduleUrl, argvPath)).toBe(true);
  });

  it("does not match a naive unencoded file:// comparison for a spaced path", () => {
    const argvPath = "/home/user/My Checkout/scripts/check-deploy.mjs";
    const moduleUrl = pathToFileURL(argvPath).href;
    // This is the exact bug: building the URL by hand instead of via
    // pathToFileURL. Asserting it here pins the regression this fix closes.
    expect(moduleUrl === `file://${argvPath}`).toBe(false);
  });

  it("does not match a different path", () => {
    const moduleUrl = pathToFileURL("/a/b/check-deploy.mjs").href;
    expect(isMainEntry(moduleUrl, "/a/b/other.mjs")).toBe(false);
  });

  it("does not match when argv[1] is missing (e.g. a REPL)", () => {
    expect(isMainEntry("file:///a/b.mjs", undefined)).toBe(false);
  });
});

describe("CLI entry point (real subprocess, not just isMainEntry() in isolation)", () => {
  // This PR's takeover-round Frank re-review, P2: every test above exercises
  // `isMainEntry()` and the other exported helpers directly, but nothing
  // spawns the actual script — the bottom-of-file
  // `if (isMainEntry(...)) { await main(); }` call could be deleted, or
  // `main()` changed to never run, and every test in this file would still
  // pass. AGENTS.md's gate-testing rule is explicit: "test a gate script's
  // entry path and defaults, not just its exported function." A real
  // subprocess run of the CLI itself is the only thing that actually
  // exercises that line.
  const SCRIPT = path.join(
    import.meta.dirname,
    "..",
    "scripts",
    "check-deploy.mjs"
  );

  function runCli(scriptPath: string, args: string[]) {
    try {
      execFileSync("node", [scriptPath, ...args], {
        encoding: "utf8",
        timeout: 10_000,
      });
      return { status: 0, stdout: "", stderr: "" };
    } catch (err) {
      const e = err as {
        status: number | null;
        stdout: string;
        stderr: string;
      };
      return { status: e.status, stdout: e.stdout, stderr: e.stderr };
    }
  }

  it("really runs main() and exits non-zero with FAIL on an unrecognized flag", () => {
    const result = runCli(SCRIPT, ["--bogus-flag-xyz"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAIL:");
    expect(result.stderr).toContain("unrecognized argument");
  });

  // The exact regression round-1 Frank F1 fixed: a hand-built
  // `file://${process.argv[1]}` comparison skips percent-encoding, so a
  // checkout path containing a space never matched and `main()` silently
  // never ran — exit 0, no output. Copies the real script (unmodified) into
  // a directory whose name contains a space and runs it from there.
  it("still runs main() when invoked from a path containing a space (round-1 Frank F1 regression, exercised end to end)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "check deploy space "));
    try {
      const dest = path.join(dir, "check-deploy.mjs");
      cpSync(SCRIPT, dest);
      const result = runCli(dest, ["--bogus-flag-xyz"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("FAIL:");
      expect(result.stderr).toContain("unrecognized argument");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CLI entry point against a real server serving a malformed version.json body", () => {
  // Round-3 George P3-4: `fetchVersionJson` parsed `res.json()` and handed
  // the result straight to `compareDeployed`/`main()`'s log line without
  // checking its shape. `res.json()` succeeds on ANY valid JSON document —
  // `null`, `42`, `[]`, `{}` — not just an object with string `version`/`sha`
  // fields. A `200 application/json` response of `null` made `main()` throw
  // an uncaught `TypeError: Cannot read properties of null` instead of
  // printing a `FAIL:` line, the exact failure-to-fail-closed shape this
  // file's other tests exist to catch. These run the real CLI against a
  // real local HTTP server — the only way to exercise `fetchVersionJson`,
  // which is not exported — with `--sha=`/`--version=` both given so
  // `ensureRemoteRefFresh` never runs and no git/network dependency on the
  // canonical origin is needed.
  const SCRIPT = path.join(
    import.meta.dirname,
    "..",
    "scripts",
    "check-deploy.mjs"
  );

  // This block's server and its CLI child share this test process's single
  // event loop. `execFileSync` — used by the other CLI-subprocess describe
  // block above — blocks that event loop synchronously until the child
  // exits, which means the in-process `http.Server` below can never
  // dequeue the child's incoming connection: every run hung until
  // `execFileSync`'s own timeout SIGTERM'd it (observed directly: status
  // `null`, signal `SIGTERM`, no stderr — reproduced live while writing
  // this test, not theorized). `execFile` (async, promisified) yields
  // control back to the event loop while the child runs, so the server can
  // actually answer it.
  const execFileAsync = promisify(execFile);

  async function runCli(args: string[]) {
    try {
      await execFileAsync("node", [SCRIPT, ...args], {
        encoding: "utf8",
        timeout: 10_000,
      });
      return { status: 0, stdout: "", stderr: "" };
    } catch (err) {
      const e = err as {
        code: number | null;
        stdout: string;
        stderr: string;
      };
      return { status: e.code, stdout: e.stdout, stderr: e.stderr };
    }
  }

  async function withServer(
    body: string,
    fn: (origin: string) => Promise<void> | void
  ): Promise<void> {
    const server: Server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("expected a bound TCP address");
      }
      await fn(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  }

  it("fails closed with FAIL: (not an uncaught TypeError) when the origin serves a JSON null body", async () => {
    await withServer("null", async (origin) => {
      const result = await runCli([
        `--origin=${origin}`,
        "--version=0.1.12",
        "--sha=abc1234",
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("FAIL:");
      expect(result.stderr).not.toContain("TypeError");
      expect(result.stderr).toContain("not a usable version.json");
    });
  });

  it("fails closed with FAIL: when the origin serves a JSON object missing version/sha", async () => {
    await withServer(JSON.stringify({ hello: "world" }), async (origin) => {
      const result = await runCli([
        `--origin=${origin}`,
        "--version=0.1.12",
        "--sha=abc1234",
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("FAIL:");
      expect(result.stderr).not.toContain("TypeError");
      expect(result.stderr).toContain("not a usable version.json");
    });
  });

  it("fails closed with FAIL: when the origin serves a JSON array instead of an object", () =>
    withServer(JSON.stringify(["not", "an", "object"]), async (origin) => {
      const result = await runCli([
        `--origin=${origin}`,
        "--version=0.1.12",
        "--sha=abc1234",
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("FAIL:");
      expect(result.stderr).not.toContain("TypeError");
    }));

  it("still passes for a well-formed version.json body (both states, per AGENTS.md)", () =>
    withServer(
      JSON.stringify({ version: "0.1.12", sha: "abc1234", builtAt: "now" }),
      async (origin) => {
        const result = await runCli([
          `--origin=${origin}`,
          "--version=0.1.12",
          "--sha=abc1234",
        ]);
        expect(result.status).toBe(0);
      }
    ));
});

describe("CLI through an explicit symlink", () => {
  it.each(["file", "directory"] as const)(
    "checks matching and mismatching builds through a %s symlink",
    async (kind) => {
      const dir = mkdtempSync(path.join(tmpdir(), "check deploy symlink "));
      const script = path.resolve(
        import.meta.dirname,
        "../scripts/check-deploy.mjs"
      );
      const link = path.join(dir, "linked path");
      symlinkSync(
        kind === "file" ? script : path.dirname(script),
        link,
        kind === "file" ? "file" : "dir"
      );
      const entry =
        kind === "file" ? link : path.join(link, "check-deploy.mjs");
      const server = createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ version: "0.2.9", sha: "abc1234", builtAt: "now" })
        );
      });
      try {
        await new Promise<void>((resolve) =>
          server.listen(0, "127.0.0.1", resolve)
        );
        const address = server.address();
        if (address === null || typeof address === "string")
          throw new Error("expected a bound TCP address");
        const args = [
          entry,
          `--origin=http://127.0.0.1:${address.port}`,
          "--sha=abc1234",
        ];
        const run = promisify(execFile);
        const match = await run("node", [...args, "--version=0.2.9"], {
          timeout: 10_000,
        });
        expect(match.stdout).toContain("PASS:");
        await expect(
          run("node", [...args, "--version=0.2.8"], { timeout: 10_000 })
        ).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining("FAIL:"),
        });
      } finally {
        if (server.listening)
          await new Promise<void>((resolve, reject) =>
            server.close((err) => (err ? reject(err) : resolve()))
          );
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});

describe("describeFetchFailure", () => {
  // round-1 Frank F2: a hung fetch eventually threw (undici's ~300s
  // default) and was caught as a generic error — correct but a poor,
  // unbounded-feeling UX. The message must name a timeout distinctly once
  // one is enforced via AbortSignal.timeout.
  it("names a timeout distinctly from a generic network error", () => {
    const timeoutErr = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    const message = describeFetchFailure(timeoutErr, {
      timeoutMs: 15000,
      url: "https://example.test/version.json",
    });
    expect(message).toContain("timed out after 15000ms");
    expect(message).toContain("https://example.test/version.json");
  });

  it("treats an AbortError the same as a TimeoutError", () => {
    const abortErr = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    expect(describeFetchFailure(abortErr, {})).toContain("timed out");
  });

  it("falls back to a generic message for a non-timeout error", () => {
    const netErr = new Error("getaddrinfo ENOTFOUND example.test");
    const message = describeFetchFailure(netErr, {
      url: "https://example.test/version.json",
    });
    expect(message).toContain("could not fetch");
    expect(message).toContain("getaddrinfo ENOTFOUND example.test");
    expect(message).not.toContain("timed out");
  });
});

describe("isJsonContentType", () => {
  // round-1 George G4: wrangler's SPA fallback 200s with HTML when
  // version.json is missing from the deploy. Distinguishing that from a
  // real version.json response is the fix.
  it("accepts application/json", () => {
    expect(isJsonContentType("application/json")).toBe(true);
  });

  it("accepts application/json with a charset parameter", () => {
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isJsonContentType("Application/JSON")).toBe(true);
  });

  it("rejects text/html — the SPA fallback's content type", () => {
    expect(isJsonContentType("text/html; charset=utf-8")).toBe(false);
  });

  it("rejects a missing content-type header", () => {
    expect(isJsonContentType(null)).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });
});

describe("SpaFallbackError", () => {
  it("is a distinguishable Error subclass", () => {
    const err = new SpaFallbackError("origin served HTML instead of JSON");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SpaFallbackError);
    expect(err.message).toBe("origin served HTML instead of JSON");
  });
});

describe("remoteRefForOrigin", () => {
  // round-3 George #1: Cloudflare Workers Builds deploys the promoted
  // branch's tip (usually a merge commit for this repo's PR-promotion
  // flow), not whatever commit a promoter's local checkout has HEAD on. For
  // the two known default origins the expected sha must come from the
  // corresponding remote-tracking ref instead.
  it("maps the staging default origin to origin/staging", () => {
    expect(
      remoteRefForOrigin("https://tc-mobile-staging.unfoldingword.workers.dev")
    ).toBe("origin/staging");
  });

  it("maps the production origin to origin/main", () => {
    expect(
      remoteRefForOrigin("https://tc-mobile.unfoldingword.workers.dev")
    ).toBe("origin/main");
  });

  it("returns undefined for an origin that isn't a known default (e.g. a per-PR preview Worker)", () => {
    expect(
      remoteRefForOrigin("https://some-preview.unfoldingword.workers.dev")
    ).toBeUndefined();
  });
});

describe("isCanonicalOrigin", () => {
  // Round-2 George P2: `ensureRemoteRefFresh` fetches from the local
  // `origin` remote and trusts `origin/staging`/`origin/main` as the
  // promoted tip. That trust is only warranted when `origin` actually
  // points at this repo — a fork (which GitHub copies `staging`/`main`
  // into at fork time) or an unrepointed pre-transfer clone would let the
  // fetch succeed against a stale branch and reopen the #143 false PASS
  // this whole check exists to close.
  it("accepts the canonical https URL", () => {
    expect(
      isCanonicalOrigin("https://github.com/unfoldingWord/tc-mobile")
    ).toBe(true);
  });

  it("accepts the canonical https URL with a trailing .git", () => {
    expect(
      isCanonicalOrigin("https://github.com/unfoldingWord/tc-mobile.git")
    ).toBe(true);
  });

  it("accepts the canonical ssh URL", () => {
    expect(isCanonicalOrigin("git@github.com:unfoldingWord/tc-mobile")).toBe(
      true
    );
  });

  it("accepts the canonical ssh URL with a trailing .git", () => {
    expect(
      isCanonicalOrigin("git@github.com:unfoldingWord/tc-mobile.git")
    ).toBe(true);
  });

  it("is case-insensitive on the owner/repo", () => {
    expect(
      isCanonicalOrigin("https://github.com/unfoldingword/TC-Mobile.git")
    ).toBe(true);
  });

  // Round-3 George P3-2: the first release of this function only accepted
  // the plain https and scp-like ssh forms above, so a checkout cloned or
  // repointed with any of these three (all legitimate, git-accepted ways to
  // point at the same canonical repo) failed closed on a correct origin —
  // a false FAIL on the gate whenever it runs with `--sha=`/`--version=`
  // and no positional origin (which skips the fetch, but not this check).
  it("accepts an explicit ssh:// URL", () => {
    expect(
      isCanonicalOrigin("ssh://git@github.com/unfoldingWord/tc-mobile.git")
    ).toBe(true);
  });

  it("accepts an https URL with embedded userinfo", () => {
    expect(
      isCanonicalOrigin(
        "https://some-user@github.com/unfoldingWord/tc-mobile.git"
      )
    ).toBe(true);
  });

  it("accepts the ssh.github.com alias host (SSH-over-443)", () => {
    expect(
      isCanonicalOrigin("git@ssh.github.com:unfoldingWord/tc-mobile.git")
    ).toBe(true);
  });

  it("accepts an ssh:// URL without a trailing .git", () => {
    expect(
      isCanonicalOrigin("ssh://git@github.com/unfoldingWord/tc-mobile")
    ).toBe(true);
  });

  it("accepts the ssh.github.com alias host without a trailing .git", () => {
    expect(
      isCanonicalOrigin("git@ssh.github.com:unfoldingWord/tc-mobile")
    ).toBe(true);
  });

  // The exact scenario George's finding describes: a fork's origin.
  it("rejects a fork's URL", () => {
    expect(
      isCanonicalOrigin("https://github.com/sethstoll3/tc-mobile.git")
    ).toBe(false);
  });

  it("rejects the pre-transfer owner (the old, unrepointed remote)", () => {
    expect(isCanonicalOrigin("git@github.com:sethstoll3/tc-mobile.git")).toBe(
      false
    );
  });

  it("rejects a non-GitHub host", () => {
    expect(
      isCanonicalOrigin("https://gitlab.com/unfoldingWord/tc-mobile.git")
    ).toBe(false);
  });

  it("rejects a similarly-named but different repo", () => {
    expect(
      isCanonicalOrigin("https://github.com/unfoldingWord/tc-mobile-staging")
    ).toBe(false);
  });

  it("rejects http (not https)", () => {
    expect(
      isCanonicalOrigin("http://github.com/unfoldingWord/tc-mobile.git")
    ).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isCanonicalOrigin("not a url at all")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isCanonicalOrigin(undefined)).toBe(false);
  });

  // The widened matching above must still reject a fork through each of the
  // newly-accepted URL shapes, not just the original two.
  it("rejects a fork's URL via ssh://", () => {
    expect(
      isCanonicalOrigin("ssh://git@github.com/sethstoll3/tc-mobile.git")
    ).toBe(false);
  });

  it("rejects a fork's URL via the ssh.github.com alias host", () => {
    expect(
      isCanonicalOrigin("git@ssh.github.com:sethstoll3/tc-mobile.git")
    ).toBe(false);
  });

  it("rejects a fork's URL via https with embedded userinfo", () => {
    expect(
      isCanonicalOrigin("https://some-user@github.com/sethstoll3/tc-mobile.git")
    ).toBe(false);
  });

  // Frank r2 P2 on #751: a suffix-style `~/.ssh/config` Host alias is
  // rejected, because the URL text cannot show where it resolves. A benign
  // `-uw` and a hostile `-evil` are the same string shape, so the gate
  // treats them alike and fails closed on both.
  it.each([
    "git@github.com-uw:unfoldingWord/tc-mobile.git",
    "git@github.com-uw:unfoldingWord/tc-mobile",
    "git@github.com-evil:unfoldingWord/tc-mobile.git",
    "git@ssh.github.com-uw:unfoldingWord/tc-mobile.git",
    "git@github.com-uw:sethstoll3/tc-mobile.git",
  ])("rejects a suffix-style Host alias: %s", (url) => {
    expect(isCanonicalOrigin(url)).toBe(false);
  });

  it.each([
    "git@gitlab.com:unfoldingWord/tc-mobile.git",
    "git@evil.example:unfoldingWord/tc-mobile.git",
    "git@github.com.evil.example:unfoldingWord/tc-mobile.git",
    "git@localhost:unfoldingWord/tc-mobile",
    "git@gh:unfoldingWord/tc-mobile.git",
  ])("rejects a non-GitHub scp host with the canonical path: %s", (url) => {
    expect(isCanonicalOrigin(url)).toBe(false);
  });

  it("accepts an explicit ssh:// URL via the ssh.github.com alias host", () => {
    expect(
      isCanonicalOrigin("ssh://git@ssh.github.com/unfoldingWord/tc-mobile.git")
    ).toBe(true);
  });

  it("rejects a fork's URL via ssh://ssh.github.com", () => {
    expect(
      isCanonicalOrigin("ssh://git@ssh.github.com/sethstoll3/tc-mobile.git")
    ).toBe(false);
  });

  it("accepts the canonical https URL with a trailing slash", () => {
    expect(
      isCanonicalOrigin("https://github.com/unfoldingWord/tc-mobile/")
    ).toBe(true);
  });

  it("accepts the canonical https URL with a trailing .git and a trailing slash", () => {
    expect(
      isCanonicalOrigin("https://github.com/unfoldingWord/tc-mobile.git/")
    ).toBe(true);
  });

  it("rejects a fork's URL with a trailing slash", () => {
    expect(isCanonicalOrigin("https://github.com/sethstoll3/tc-mobile/")).toBe(
      false
    );
  });
});

describe("ensureRemoteRefFresh", () => {
  // Frank P1 (this takeover round): resolveExpectedSha/resolveExpectedVersion
  // read whatever the local remote-tracking ref already has — accurate only
  // if a promoter ran `git fetch origin` first. AGENTS.md said so, but
  // nothing enforced it, so a promoter who merged on GitHub without
  // fetching locally, on a checkout where Cloudflare *also* failed to
  // deploy (the #143 failure mode), got a false PASS: stale local ref,
  // stale deployed build, coincidentally equal. This fetches the specific
  // branch before either resolver reads it.
  const STAGING = "https://tc-mobile-staging.unfoldingword.workers.dev";
  const PROD = "https://tc-mobile.unfoldingword.workers.dev";
  const CANONICAL_URL = "https://github.com/unfoldingWord/tc-mobile.git";

  // A fake `runGit` that answers "git remote get-url origin" with the
  // canonical URL and defers everything else to the caller — every test
  // below that isn't specifically about the canonical-origin gate uses
  // this so it doesn't have to repeat that stub.
  function withCanonicalOrigin(rest: (cmd: string) => string) {
    return (cmd: string) => {
      if (cmd === "git remote get-url origin") return CANONICAL_URL;
      return rest(cmd);
    };
  }

  // George round 1, P3-1: a bare `git fetch origin <branch>` only updates
  // `origin/<branch>` when that branch is already covered by
  // `remote.origin.fetch` — on a `--single-branch` clone it exits 0 without
  // touching the remote-tracking ref at all, so the "fetched" state is
  // indistinguishable from "never fetched" and the promoter gets exactly
  // the staleness this function exists to prevent. The fetch must target an
  // explicit destination refspec, and the ref must be verified afterward.
  it("fetches with an explicit destination refspec for the staging default origin, not a bare branch name", () => {
    const calls: string[] = [];
    const runGit = withCanonicalOrigin((cmd) => {
      calls.push(cmd);
      return "";
    });
    const warnings: string[] = [];
    ensureRemoteRefFresh(STAGING, { runGit, warn: (m) => warnings.push(m) });
    expect(calls).toEqual([
      "git fetch origin +refs/heads/staging:refs/remotes/origin/staging --quiet",
      "git rev-parse --verify --quiet origin/staging",
    ]);
    expect(warnings.join(" ")).toContain("fetched origin/staging");
  });

  it("fetches with an explicit destination refspec for the production origin", () => {
    const calls: string[] = [];
    const runGit = withCanonicalOrigin((cmd) => {
      calls.push(cmd);
      return "";
    });
    ensureRemoteRefFresh(PROD, { runGit });
    expect(calls).toEqual([
      "git fetch origin +refs/heads/main:refs/remotes/origin/main --quiet",
      "git rev-parse --verify --quiet origin/main",
    ]);
  });

  it("does nothing for an origin with no known remote ref (never even checks the origin remote)", () => {
    const runGit = () => {
      throw new Error("must not shell out for an unknown origin");
    };
    expect(() =>
      ensureRemoteRefFresh("https://some-preview.unfoldingword.workers.dev", {
        runGit,
      })
    ).not.toThrow();
  });

  it("throws (fails closed) when the fetch itself fails, rather than leaving a stale ref unnoticed", () => {
    const runGit = withCanonicalOrigin(() => {
      throw new Error("could not resolve host: github.com");
    });
    expect(() => ensureRemoteRefFresh(STAGING, { runGit })).toThrow(
      /could not fetch origin\/staging/
    );
    expect(() => ensureRemoteRefFresh(STAGING, { runGit })).toThrow(
      /could not resolve host/
    );
  });

  // Red-first (George round 1, P3-1): the fetch itself "succeeds" (exit 0 —
  // this is exactly the `--single-branch` clone shape, objects fetched but
  // the remote-tracking ref never updated) yet the branch still cannot be
  // resolved afterward. Must throw, never fall back to HEAD/package.json
  // for a known staging/prod origin.
  it("throws (fails closed) when the fetch reports success but the ref still cannot be resolved afterward — the --single-branch shape", () => {
    const runGit = withCanonicalOrigin((cmd) => {
      if (cmd.startsWith("git fetch origin")) return ""; // "succeeds"
      if (cmd.startsWith("git rev-parse --verify")) {
        throw new Error("unknown revision or path not in the working tree");
      }
      throw new Error(`unexpected git command: ${cmd}`);
    });
    expect(() => ensureRemoteRefFresh(STAGING, { runGit })).toThrow(
      /origin\/staging still could not be resolved/
    );
  });

  // Red-first (round-2 George P2): the exact fork scenario from the finding
  // — `origin` is a fork with a stale `staging`, and the fetch against it
  // would otherwise "succeed". Must fail closed BEFORE any fetch is
  // attempted, not just distrust the result afterward.
  it("throws (fails closed) when the origin remote is not unfoldingWord/tc-mobile, before ever fetching", () => {
    const calls: string[] = [];
    const runGit = (cmd: string) => {
      calls.push(cmd);
      if (cmd === "git remote get-url origin") {
        return "https://github.com/sethstoll3/tc-mobile.git"; // a fork
      }
      throw new Error(`must not run further git commands: ${cmd}`);
    };
    expect(() => ensureRemoteRefFresh(STAGING, { runGit })).toThrow(
      /"origin" is "https:\/\/github\.com\/sethstoll3\/tc-mobile\.git", not unfoldingWord\/tc-mobile/
    );
    // The fetch itself must never run once the origin is untrusted — this
    // is what makes the check fail closed BEFORE trusting a stale fork
    // branch, not merely distrust it afterward.
    expect(calls).toEqual(["git remote get-url origin"]);
  });

  it("throws (fails closed) when the origin remote's URL can't even be read", () => {
    const runGit = () => {
      throw new Error("fatal: No such remote 'origin'");
    };
    expect(() => ensureRemoteRefFresh(STAGING, { runGit })).toThrow(
      /could not read the "origin" remote's URL/
    );
  });
});

describe("resolveExpectedSha", () => {
  // round-3 George #1: the fix itself. `runGit` is faked so these run
  // without a real git repo; `warn` is captured so the tests can assert on
  // which path (remote ref vs HEAD fallback) actually ran, not just the
  // returned sha.
  it("resolves from origin/staging for the staging default origin, not HEAD", () => {
    const calls: string[] = [];
    const runGit = (cmd: string) => {
      calls.push(cmd);
      if (cmd.includes("origin/staging")) return "afdfa6e";
      if (cmd.includes("HEAD")) return "7152289";
      throw new Error(`unexpected git command: ${cmd}`);
    };
    const warnings: string[] = [];
    const sha = resolveExpectedSha(
      "https://tc-mobile-staging.unfoldingword.workers.dev",
      { runGit, warn: (m) => warnings.push(m) }
    );
    expect(sha).toBe("afdfa6e");
    expect(calls.some((c) => c.includes("origin/staging"))).toBe(true);
    expect(calls.some((c) => c.includes("HEAD"))).toBe(false);
    expect(warnings.join(" ")).toContain("origin/staging");
  });

  it("resolves from origin/main for the production origin", () => {
    const runGit = (cmd: string) =>
      cmd.includes("origin/main") ? "deadbee" : "wrongsha";
    const sha = resolveExpectedSha(
      "https://tc-mobile.unfoldingword.workers.dev",
      { runGit }
    );
    expect(sha).toBe("deadbee");
  });

  it("falls back to local HEAD for an origin with no known remote ref", () => {
    const calls: string[] = [];
    const runGit = (cmd: string) => {
      calls.push(cmd);
      return "0feature";
    };
    const warnings: string[] = [];
    const sha = resolveExpectedSha(
      "https://some-preview.unfoldingword.workers.dev",
      { runGit, warn: (m) => warnings.push(m) }
    );
    expect(sha).toBe("0feature");
    expect(calls).toEqual(["git rev-parse --short=7 HEAD"]);
    expect(warnings.join(" ")).toContain("not a known staging/prod default");
  });

  // Round-2 George P3-2, applied symmetrically: this used to fall back to
  // local HEAD when `git rev-parse` on the ref failed. It no longer does,
  // for a *known* origin — `ensureRemoteRefFresh` already fetched and
  // `git rev-parse --verify`d this exact ref before `resolveExpectedSha` is
  // ever called via `resolveExpected`, so a failure here past that point
  // means something is genuinely wrong, and falling back would silently
  // reintroduce the mixed-source G-F1 shape.
  it("throws instead of falling back to local HEAD when the ref can't be resolved, for a known origin", () => {
    const calls: string[] = [];
    const runGit = (cmd: string) => {
      calls.push(cmd);
      if (cmd.includes("origin/staging")) {
        throw new Error("unknown revision or path not in the working tree");
      }
      return "fallback1";
    };
    expect(() =>
      resolveExpectedSha(
        "https://tc-mobile-staging.unfoldingword.workers.dev",
        { runGit }
      )
    ).toThrow(/refusing to fall back to local HEAD/);
    // Only the ref attempt ran — no silent fallback to HEAD.
    expect(calls).toEqual(["git rev-parse --short=7 origin/staging"]);
  });
});

describe("resolveExpectedVersion", () => {
  // round-5 George G-F1: round 3 moved the expected *sha* onto the promoted
  // branch's remote-tracking ref but left the expected *version* reading the
  // promoter's working tree. That is a false FAIL on a correct deploy: a
  // promoter sitting on develop at 0.1.12 runs `check:deploy:prod` after a
  // real v0.2.0 `staging -> main` promotion — the sha matches (ref-resolved),
  // the version compares local 0.1.12 against deployed 0.2.0, and the gate
  // fails the very promotion it exists to confirm. The version must resolve
  // from the same ref as the sha.
  it("resolves the version from origin/main's package.json, not this checkout's (the G-F1 false FAIL)", () => {
    const calls: string[] = [];
    const runGit = (cmd: string) => {
      calls.push(cmd);
      if (cmd === "git show origin/main:package.json") {
        return JSON.stringify({ name: "tc-mobile", version: "0.2.0" });
      }
      throw new Error(`unexpected git command: ${cmd}`);
    };
    const warnings: string[] = [];
    const version = resolveExpectedVersion(
      "https://tc-mobile.unfoldingword.workers.dev",
      { runGit, warn: (m) => warnings.push(m) }
    );
    // The promoted branch says 0.2.0, distinct from this checkout's version
    // (whatever it currently is) — pinning the checkout's own version here
    // would go stale at the next release bump, exactly what this file's
    // LOCAL_VERSION comment warns against.
    expect(version).toBe("0.2.0");
    expect(version).not.toBe(LOCAL_VERSION);
    expect(calls).toEqual(["git show origin/main:package.json"]);
    expect(warnings.join(" ")).toContain("origin/main");
  });

  it("resolves from origin/staging for the staging default origin", () => {
    const runGit = (cmd: string) =>
      cmd === "git show origin/staging:package.json"
        ? JSON.stringify({ version: "0.1.13" })
        : (() => {
            throw new Error(`unexpected git command: ${cmd}`);
          })();
    expect(
      resolveExpectedVersion(
        "https://tc-mobile-staging.unfoldingword.workers.dev",
        { runGit }
      )
    ).toBe("0.1.13");
  });

  it("falls back to this checkout's package.json for an origin with no known remote ref", () => {
    const calls: string[] = [];
    const runGit = (cmd: string) => {
      calls.push(cmd);
      throw new Error("should not shell out for an unknown origin");
    };
    const warnings: string[] = [];
    const version = resolveExpectedVersion(
      "https://some-preview.unfoldingword.workers.dev",
      { runGit, warn: (m) => warnings.push(m) }
    );
    expect(version).toBe(LOCAL_VERSION);
    expect(calls).toEqual([]);
    expect(warnings.join(" ")).toContain("not a known staging/prod default");
  });

  // Round-2 George P3-2 (the finding as filed): this used to fall back to
  // this checkout's package.json when `git show <ref>:package.json` failed.
  // It no longer does, for a *known* origin. Concrete scenario from the
  // finding: a promoter on develop at 0.2.3 confirms a real v0.2.4
  // production deploy; the fetch and `origin/main` verify succeed (sha
  // matches), but `git show origin/main:package.json` fails (a
  // sparse/partial clone that never lazy-fetched that blob) — falling back
  // would compare local 0.2.3 against deployed 0.2.4 and false-FAIL a
  // correct promotion, the exact G-F1 mixed-source shape.
  it("throws instead of falling back to this checkout's package.json when the ref's package.json can't be read, for a known origin", () => {
    const runGit = () => {
      throw new Error("unknown revision or path not in the working tree");
    };
    expect(() =>
      resolveExpectedVersion(
        "https://tc-mobile-staging.unfoldingword.workers.dev",
        { runGit }
      )
    ).toThrow(/refusing to fall back to this checkout's package\.json/);
  });

  it("throws instead of falling back when the ref's package.json has no usable version, for a known origin", () => {
    const runGit = () => JSON.stringify({ name: "tc-mobile" });
    expect(() =>
      resolveExpectedVersion(
        "https://tc-mobile-staging.unfoldingword.workers.dev",
        { runGit }
      )
    ).toThrow(/no usable "version" field/);
  });
});

describe("resolveExpected", () => {
  // The pairing itself, not either resolver on its own: G-F1 was not a broken
  // resolver, it was `main()` calling one resolver for the sha and reading the
  // working tree for the version. This is the seam that pins both halves to
  // the same commit, and the seam `main()` uses. It also now freshens the
  // ref first (Frank P1, this round) — `refGit` here handles the
  // fetch-then-verify pair `ensureRemoteRefFresh` makes before either
  // resolver reads the ref.
  const PROD = "https://tc-mobile.unfoldingword.workers.dev";
  const refGit = (cmd: string) => {
    if (cmd === "git remote get-url origin")
      return "https://github.com/unfoldingWord/tc-mobile.git";
    if (
      cmd ===
      "git fetch origin +refs/heads/main:refs/remotes/origin/main --quiet"
    )
      return "";
    if (cmd === "git rev-parse --verify --quiet origin/main") return "merge01";
    if (cmd === "git show origin/main:package.json")
      return JSON.stringify({ version: "0.2.0" });
    if (cmd === "git rev-parse --short=7 origin/main") return "merge01";
    throw new Error(`unexpected git command: ${cmd}`);
  };

  it("takes BOTH halves from the promoted branch's ref when neither is given", () => {
    expect(resolveExpected(PROD, {}, { runGit: refGit })).toEqual({
      version: "0.2.0",
      sha: "merge01",
    });
  });

  it("checks the origin remote, fetches the ref (with an explicit destination refspec), and verifies it before resolving either half", () => {
    const calls: string[] = [];
    const runGit = (cmd: string) => {
      calls.push(cmd);
      return refGit(cmd);
    };
    resolveExpected(PROD, {}, { runGit });
    expect(calls[0]).toBe("git remote get-url origin");
    expect(calls[1]).toBe(
      "git fetch origin +refs/heads/main:refs/remotes/origin/main --quiet"
    );
    expect(calls[2]).toBe("git rev-parse --verify --quiet origin/main");
  });

  it("lets an explicit --version override the ref resolution", () => {
    const expected = resolveExpected(
      PROD,
      { version: "9.9.9" },
      { runGit: refGit }
    );
    expect(expected.version).toBe("9.9.9");
    expect(expected.sha).toBe("merge01");
  });

  it("lets an explicit --sha override the ref resolution", () => {
    const expected = resolveExpected(
      PROD,
      { sha: "abc1234" },
      { runGit: refGit }
    );
    expect(expected.sha).toBe("abc1234");
    expect(expected.version).toBe("0.2.0");
  });

  it("shells out to git for neither half when both are given explicitly (no fetch either)", () => {
    const runGit = () => {
      throw new Error("git must not be consulted when both are explicit");
    };
    expect(
      resolveExpected(PROD, { version: "0.2.0", sha: "abc1234" }, { runGit })
    ).toEqual({ version: "0.2.0", sha: "abc1234" });
  });

  it("propagates ensureRemoteRefFresh's failure — refuses to compare against a possibly-stale ref rather than falling back silently (Frank P1)", () => {
    const runGit = (cmd: string) => {
      if (cmd === "git remote get-url origin") {
        return "https://github.com/unfoldingWord/tc-mobile.git";
      }
      if (cmd.startsWith("git fetch origin")) {
        throw new Error("could not resolve host: github.com");
      }
      throw new Error(`unexpected git command: ${cmd}`);
    };
    expect(() => resolveExpected(PROD, {}, { runGit })).toThrow(
      /could not fetch origin\/main/
    );
  });

  it("propagates the non-canonical-origin failure too (round-2 George P2)", () => {
    const runGit = (cmd: string) => {
      if (cmd === "git remote get-url origin") {
        return "https://github.com/sethstoll3/tc-mobile.git"; // a fork
      }
      throw new Error(`must not run further git commands: ${cmd}`);
    };
    expect(() => resolveExpected(PROD, {}, { runGit })).toThrow(
      /not unfoldingWord\/tc-mobile/
    );
  });
});

describe("parseArgs", () => {
  it("defaults to the staging origin when nothing is given", () => {
    const { origin } = parseArgs([]);
    expect(origin).toBe("https://tc-mobile-staging.unfoldingword.workers.dev");
  });

  it("accepts a positional origin", () => {
    const { origin } = parseArgs(["https://example.test/"]);
    expect(origin).toBe("https://example.test");
  });

  it("accepts an explicit --origin= flag", () => {
    const { origin } = parseArgs([
      "--origin=https://tc-mobile.unfoldingword.workers.dev",
    ]);
    expect(origin).toBe("https://tc-mobile.unfoldingword.workers.dev");
  });

  it("parses --version and --sha", () => {
    const { version, sha } = parseArgs(["--version=0.1.12", "--sha=abc1234"]);
    expect(version).toBe("0.1.12");
    expect(sha).toBe("abc1234");
  });

  // round-1 George G2: the bare `check:deploy` command defaults to staging,
  // and nothing forced a promoter checking a `staging -> main` (production)
  // promotion to say so explicitly — a copy-pasted bare command against a
  // production promotion silently PASSes for staging instead.
  // `check:deploy:prod` sets `--require-origin` for exactly this reason.
  it("--require-origin throws when no origin was given", () => {
    expect(() => parseArgs(["--require-origin"])).toThrow(
      /no origin was given/
    );
  });

  it("--require-origin is satisfied by a positional origin", () => {
    const { origin } = parseArgs(["--require-origin", "https://example.test"]);
    expect(origin).toBe("https://example.test");
  });

  it("--require-origin is satisfied by --origin=", () => {
    const { origin } = parseArgs([
      "--require-origin",
      "--origin=https://tc-mobile.unfoldingword.workers.dev",
    ]);
    expect(origin).toBe("https://tc-mobile.unfoldingword.workers.dev");
  });

  // round-5 Frank F-P2: unrecognized `--` flags were silently dropped, so a
  // typo'd `--verison=0.1.13` matched no branch, contributed nothing, and the
  // run carried on comparing against whatever the default resolution produced.
  // A deployment gate that ignores an argument the promoter meant to constrain
  // it with is failing open — the same defect class as round-1 George G2.
  it("throws on a typo'd --version flag instead of silently ignoring it", () => {
    expect(() => parseArgs(["--verison=0.1.13"])).toThrow(/--verison=0.1.13/);
    expect(() => parseArgs(["--verison=0.1.13"])).toThrow(/unrecognized/);
  });

  it("throws on any unrecognized -- flag", () => {
    expect(() => parseArgs(["--dry-run"])).toThrow(/unrecognized/);
  });

  it("still accepts every recognized flag together", () => {
    const parsed = parseArgs([
      "--require-origin",
      "--origin=https://example.test",
      "--version=0.2.0",
      "--sha=abc1234",
    ]);
    expect(parsed).toEqual({
      origin: "https://example.test",
      version: "0.2.0",
      sha: "abc1234",
    });
  });

  // Also round-5 Frank F-P2: two origins is an ambiguous instruction to the
  // highest-stakes gate in the repo. Last-one-wins silently checked one origin
  // while the promoter believed they had named the other.
  it("throws when an origin is given both positionally and with --origin=", () => {
    expect(() =>
      parseArgs(["https://example.test", "--origin=https://other.test"])
    ).toThrow(/more than once/);
  });

  it("throws when --origin= is given twice with different values", () => {
    expect(() =>
      parseArgs([
        "--origin=https://example.test",
        "--origin=https://other.test",
      ])
    ).toThrow(/more than once/);
  });

  it("throws even when the two origins are identical — one origin, stated once", () => {
    expect(() =>
      parseArgs(["https://example.test", "--origin=https://example.test"])
    ).toThrow(/more than once/);
  });

  // This takeover round's Frank P2: --sha and --version silently kept the
  // last value on a duplicate, unlike --origin — the same fail-open shape
  // round-5 Frank F-P2 already fixed for --origin. A promoter who edits or
  // copies a command with two --sha= flags gets the *second* one checked
  // with no sign the first was ever discarded.
  it("throws when --sha is given twice, even with the same value — one sha, stated once", () => {
    expect(() => parseArgs(["--sha=abc1234", "--sha=abc1234"])).toThrow(
      /--sha was given more than once/
    );
  });

  it("throws when --sha is given twice with different values", () => {
    expect(() => parseArgs(["--sha=abc1234", "--sha=def5678"])).toThrow(
      /--sha was given more than once/
    );
  });

  it("throws when --version is given twice, even with the same value", () => {
    expect(() => parseArgs(["--version=0.2.0", "--version=0.2.0"])).toThrow(
      /--version was given more than once/
    );
  });

  it("throws when --version is given twice with different values", () => {
    expect(() => parseArgs(["--version=0.2.0", "--version=0.3.0"])).toThrow(
      /--version was given more than once/
    );
  });
});

describe("package.json's check:deploy:prod stays in sync with PROD_ORIGIN", () => {
  // Round-2 George P3-4: `check:deploy:prod`'s `--origin=` and
  // `remoteRefForOrigin`'s exact-match map were two unshared strings. A
  // later edit to the npm script's URL (a custom domain, a typo) would
  // silently drop `remoteRefForOrigin` back to `undefined` for that origin,
  // which resolves expected sha/version from local HEAD/package.json
  // instead of the promoted ref — a false FAIL (or a coincidental false
  // PASS) on every real production promotion, discovered only by a
  // promoter's confusion, not by this suite. Reading `package.json` fresh
  // (not importing it, so this also catches a JSON-level edit at build
  // time) and asserting the exported constant appears in the script text
  // closes that gap mechanically.
  it("check:deploy:prod's npm script contains the exact exported PROD_ORIGIN", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:deploy:prod"]).toContain(PROD_ORIGIN);
  });

  // Not asserted by the finding, but the same drift risk for the staging
  // default: `check:deploy` doesn't pass --origin at all (it relies on
  // parseArgs' DEFAULT_ORIGIN), so this instead pins DEFAULT_ORIGIN itself
  // against remoteRefForOrigin's map, closing the loop on both origins.
  it("remoteRefForOrigin maps the exact exported DEFAULT_ORIGIN and PROD_ORIGIN", () => {
    expect(remoteRefForOrigin(DEFAULT_ORIGIN)).toBe("origin/staging");
    expect(remoteRefForOrigin(PROD_ORIGIN)).toBe("origin/main");
  });
});

describe("vite.config.ts stays in sync with SHA_LENGTH", () => {
  // Round-2 George P3-5: `SHA_LENGTH = 7` here parallels `vite.config.ts`'s
  // `git rev-parse --short=7 HEAD` (the sha producer, reused by the footer
  // build stamp). `git rev-parse --short=<N>` is a *minimum*, not exact —
  // it can emit more than `N` characters when that prefix is ambiguous —
  // and nothing previously tied the two literals together once
  // `SHA_LENGTH` was introduced as its own constant. This reads
  // `vite.config.ts`'s source fresh and asserts it still pins the exact
  // same length as the exported `SHA_LENGTH`.
  it("vite.config.ts's buildSha pins the same --short=<N> as SHA_LENGTH", () => {
    const viteConfigSource = readFileSync(
      path.join(import.meta.dirname, "..", "vite.config.ts"),
      "utf8"
    );
    // Match the actual `execSync(...)` call, not a doc comment: the file's
    // own comment block above `buildSha` explains the `--short=7` choice in
    // prose, and a plain `toContain("--short=" + SHA_LENGTH)` matched that
    // prose even when the real call below it was mutated to `--short=8` —
    // a false green caught only by running this test against the mutation
    // (round-2 George P3-5 mutation proof, this round). Anchoring on
    // `execSync("git rev-parse --short=<N> HEAD"` pins the assertion to the
    // code path that actually produces the build's sha.
    const match = /execSync\(\s*["']git rev-parse --short=(\d+) HEAD["']/.exec(
      viteConfigSource
    );
    expect(
      match,
      'expected an execSync("git rev-parse --short=<N> HEAD") call in vite.config.ts'
    ).not.toBeNull();
    expect(Number(match![1])).toBe(SHA_LENGTH);
  });

  // Round-3 George P3-3: the `execSync` call above isn't the only literal
  // `7` in this file — the fallback for when `git` isn't available
  // (`process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 7)`) carries an unshared
  // copy of the same length. The test above didn't cover it, so a drift
  // here (e.g. bumping the primary call to `--short=8` without touching the
  // fallback slice) would go undetected.
  it("vite.config.ts's WORKERS_CI_COMMIT_SHA fallback slices to the same length as SHA_LENGTH", () => {
    const viteConfigSource = readFileSync(
      path.join(import.meta.dirname, "..", "vite.config.ts"),
      "utf8"
    );
    const match = /WORKERS_CI_COMMIT_SHA\?\.slice\(0,\s*(\d+)\)/.exec(
      viteConfigSource
    );
    expect(
      match,
      "expected a WORKERS_CI_COMMIT_SHA?.slice(0, <N>) fallback in vite.config.ts"
    ).not.toBeNull();
    expect(Number(match![1])).toBe(SHA_LENGTH);
  });
});
