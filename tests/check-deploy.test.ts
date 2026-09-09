import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compareDeployed,
  describeFetchFailure,
  isJsonContentType,
  isMainEntry,
  normalizeSha,
  parseArgs,
  SpaFallbackError,
} from "../scripts/check-deploy.mjs";

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
});
