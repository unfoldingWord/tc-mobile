import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compareDeployed,
  describeFetchFailure,
  isJsonContentType,
  isMainEntry,
  normalizeSha,
  parseArgs,
  remoteRefForOrigin,
  resolveExpected,
  resolveExpectedSha,
  resolveExpectedVersion,
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
  // from the pinned `--short=7`. `compareDeployed` normalizes both sides so
  // a same-commit prefix still matches even if lengths differ.
  it("matches shas of different lengths when one is a prefix of the other", () => {
    const result = compareDeployed(
      { version: "0.1.12", sha: "abc1234ff" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result.shaMatches).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("still fails when normalized prefixes genuinely differ", () => {
    const result = compareDeployed(
      { version: "0.1.12", sha: "abc9999ff" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result.shaMatches).toBe(false);
  });
});

describe("normalizeSha", () => {
  it("truncates a long sha to the pinned length", () => {
    expect(normalizeSha("abc1234ffffffff")).toBe("abc1234");
  });

  it("leaves a sha already at the pinned length unchanged", () => {
    expect(normalizeSha("abc1234")).toBe("abc1234");
  });

  it("passes through non-string input unchanged", () => {
    expect(normalizeSha(undefined)).toBeUndefined();
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

  it("falls back to local HEAD when the remote-tracking ref can't be resolved (e.g. not fetched)", () => {
    const calls: string[] = [];
    const runGit = (cmd: string) => {
      calls.push(cmd);
      if (cmd.includes("origin/staging")) {
        throw new Error("unknown revision or path not in the working tree");
      }
      return "fallback1";
    };
    const warnings: string[] = [];
    const sha = resolveExpectedSha(
      "https://tc-mobile-staging.unfoldingword.workers.dev",
      { runGit, warn: (m) => warnings.push(m) }
    );
    expect(sha).toBe("fallback1");
    expect(calls).toEqual([
      "git rev-parse --short=7 origin/staging",
      "git rev-parse --short=7 HEAD",
    ]);
    expect(warnings.join(" ")).toContain("could not resolve origin/staging");
    expect(warnings.join(" ")).toContain("git fetch origin");
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
    // The promoted branch says 0.2.0; the local checkout still says 0.1.12.
    expect(LOCAL_VERSION).toBe("0.1.12");
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

  it("falls back to this checkout's package.json when the ref can't be resolved (e.g. not fetched)", () => {
    const runGit = () => {
      throw new Error("unknown revision or path not in the working tree");
    };
    const warnings: string[] = [];
    const version = resolveExpectedVersion(
      "https://tc-mobile-staging.unfoldingword.workers.dev",
      { runGit, warn: (m) => warnings.push(m) }
    );
    expect(version).toBe(LOCAL_VERSION);
    expect(warnings.join(" ")).toContain(
      "could not read origin/staging:package.json"
    );
    expect(warnings.join(" ")).toContain("git fetch origin");
  });

  it("falls back to this checkout's package.json when the ref's package.json has no usable version", () => {
    const runGit = () => JSON.stringify({ name: "tc-mobile" });
    const warnings: string[] = [];
    const version = resolveExpectedVersion(
      "https://tc-mobile-staging.unfoldingword.workers.dev",
      { runGit, warn: (m) => warnings.push(m) }
    );
    expect(version).toBe(LOCAL_VERSION);
    expect(warnings.join(" ")).toContain("no usable");
  });
});

describe("resolveExpected", () => {
  // The pairing itself, not either resolver on its own: G-F1 was not a broken
  // resolver, it was `main()` calling one resolver for the sha and reading the
  // working tree for the version. This is the seam that pins both halves to
  // the same commit, and the seam `main()` uses.
  const PROD = "https://tc-mobile.unfoldingword.workers.dev";
  const refGit = (cmd: string) => {
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

  it("shells out to git for neither half when both are given explicitly", () => {
    const runGit = () => {
      throw new Error("git must not be consulted when both are explicit");
    };
    expect(
      resolveExpected(PROD, { version: "0.2.0", sha: "abc1234" }, { runGit })
    ).toEqual({ version: "0.2.0", sha: "abc1234" });
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
});
