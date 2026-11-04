import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";

import { startCdpServer } from "inspect-webkit";
import { afterAll, describe, expect, it } from "vitest";

import { BRIDGE_HOST, nonLoopbackAddresses } from "../scripts/ios-sim-core.mjs";

import { main, reachableOn, withPage, type Deps } from "../scripts/ios-sim.mjs";

// The CLI half of the iOS Simulator harness (#1840). The rules are in
// tests/ios-sim-core.test.ts; this file pins the guards (each in both
// states), the eval and tap paths through injected seams, and the real entry
// path with a fake `xcrun` on PATH. Nothing here boots a Simulator.

const ROOT = path.resolve(import.meta.dirname, "..");
const UDID = "15E0DCD8-0FBF-42B8-93E6-39CCA3726A4F";
const BOOTED = JSON.stringify({
  devices: { ios: [{ udid: UDID, name: "iPhone 18 Pro", state: "Booted" }] },
});
const LAUNCHCTL =
  "PID\tStatus\tLabel\n6800\t0\tUIKitApplication:org.unfoldingword.tcmobile[5c86][rb-legacy]\n";

interface Call {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
}

function fakes(
  over: Partial<Deps> & { booted?: string; launchctl?: string } = {}
) {
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const evaluated: string[] = [];
  const { booted = BOOTED, launchctl = LAUNCHCTL, ...rest } = over;
  const deps: Deps = {
    run: (cmd, args, opts) => {
      calls.push({ cmd, args, env: opts?.env });
      if (args.join(" ").startsWith("simctl list devices"))
        return { status: 0, stdout: booted, stderr: "" };
      if (args.includes("launchctl"))
        return { status: 0, stdout: launchctl, stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    },
    exists: () => true,
    withPage: async (pid, body) => {
      if (pid !== 6800) throw new Error(`no WebView target for pid ${pid}`);
      return body(async (expression) => {
        evaluated.push(expression);
        return { result: { type: "number", value: 2 } };
      });
    },
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    now: () => 0,
    sleep: async () => {},
    root: ROOT,
    ...rest,
  };
  return { deps, calls, out, err, evaluated };
}

describe("usage", () => {
  it("exits 2 with the command list for no command or an unknown one", async () => {
    for (const argv of [[], ["frobnicate"]]) {
      const f = fakes();
      expect(await main(argv, f.deps)).toBe(2);
      expect(f.err.join("\n")).toMatch(/usage: npm run ios-sim -- <command>/);
    }
  });
});

describe("the booted-Simulator guard", () => {
  it("fails closed when nothing is booted, before touching the app", async () => {
    const f = fakes({ booted: JSON.stringify({ devices: {} }) });
    expect(await main(["eval", "1+1"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toMatch(/no booted Simulator/);
    expect(f.evaluated).toEqual([]);
  });

  it("passes when a device is booted", async () => {
    const f = fakes();
    expect(await main(["eval", "1+1"], f.deps)).toBe(0);
  });

  const TWO = JSON.stringify({
    devices: {
      ios: [
        { udid: UDID, name: "iPhone 18 Pro", state: "Booted" },
        { udid: "B", name: "iPhone 17e", state: "Booted" },
      ],
    },
  });

  it("refuses two booted devices without --device, eval included (#1857 F3)", async () => {
    const f = fakes({ booted: TWO });
    expect(await main(["eval", "1+1"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toMatch(
      /2 Simulators are booted.*iPhone 18 Pro.*iPhone 17e.*--device/s
    );
    expect(f.evaluated).toEqual([]);
  });

  const SAME_NAME = JSON.stringify({
    devices: {
      ios26: [{ udid: "U-26", name: "iPhone 17", state: "Booted" }],
      ios27: [{ udid: "U-27", name: "iPhone 17", state: "Booted" }],
    },
  });

  it("refuses two booted devices that share a name, printing name (udid) (#1891)", async () => {
    const f = fakes({ booted: SAME_NAME });
    expect(await main(["eval", "1+1", "--device", "iPhone 17"], f.deps)).toBe(
      1
    );
    expect(f.err.join("\n")).toMatch(
      /2 Simulators are booted.*iPhone 17 \(U-26\).*iPhone 17 \(U-27\).*--device/s
    );
    expect(f.evaluated).toEqual([]);
  });

  it("accepts --device by UDID to pick one of two same-named devices (#1891)", async () => {
    const f = fakes({ booted: SAME_NAME });
    expect(await main(["eval", "1+1", "--device", "U-27"], f.deps)).toBe(0);
    expect(f.evaluated).toEqual(["1+1"]);
  });

  it("accepts two booted devices when --device names one", async () => {
    const f = fakes({ booted: TWO });
    expect(await main(["eval", "1+1", "--device", "iPhone 17e"], f.deps)).toBe(
      0
    );
  });
});

describe("boot --device (#1891)", () => {
  const LIST = JSON.stringify({
    devices: {
      a: [{ udid: "U-26", name: "iPhone 17", state: "Shutdown" }],
      b: [{ udid: "U-27", name: "iPhone 17", state: "Shutdown" }],
    },
  });

  it("boots the one device a UDID names, not the first of two same-named", async () => {
    const f = fakes({ booted: LIST });
    expect(await main(["boot", "--device", "U-27"], f.deps)).toBe(0);
    expect(f.calls.map((c) => c.args.join(" "))).toContain("simctl boot U-27");
    expect(f.calls.map((c) => c.args.join(" "))).not.toContain(
      "simctl boot U-26"
    );
  });

  it("still refuses a selector that matches no name or UDID", async () => {
    const f = fakes({ booted: LIST });
    expect(await main(["boot", "--device", "U-99"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toMatch(/no available Simulator named U-99/);
  });
});

describe("the running-app guard", () => {
  it("fails closed when tC Mobile has no live process", async () => {
    const f = fakes({ launchctl: "PID\tStatus\tLabel\n" });
    expect(await main(["eval", "1+1"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toMatch(/tC Mobile is not running/);
    expect(f.evaluated).toEqual([]);
  });
});

describe("eval", () => {
  it("prints the value as JSON", async () => {
    const f = fakes();
    expect(await main(["eval", "1+1"], f.deps)).toBe(0);
    expect(f.out).toEqual(["2"]);
    expect(f.evaluated).toEqual(["1+1"]);
  });

  it("fails when the page has no WebView target for the app's pid", async () => {
    const f = fakes({
      launchctl:
        "6801\t0\tUIKitApplication:org.unfoldingword.tcmobile[5c86][rb-legacy]\n",
    });
    expect(await main(["eval", "1+1"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toMatch(/no WebView target for pid 6801/);
  });

  it("fails on an exception thrown in the page", async () => {
    const f = fakes({
      withPage: async (_pid, body) =>
        body(async () => ({
          result: { type: "object" },
          wasThrown: true,
          exceptionDetails: { text: "ReferenceError: nope" },
        })),
    });
    expect(await main(["eval", "nope"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toMatch(/ReferenceError: nope/);
  });

  it("--async polls the slot and prints the resolved value", async () => {
    const replies = [
      { result: { type: "undefined" } },
      { result: { type: "object", value: { done: false } } },
      {
        result: { type: "object", value: { done: true, ok: true, value: 42 } },
      },
    ];
    const seen: string[] = [];
    const f = fakes({
      withPage: async (_pid, body) =>
        body(async (expression) => {
          seen.push(expression);
          return replies.shift()!;
        }),
    });
    expect(await main(["eval", "fetchThing()", "--async"], f.deps)).toBe(0);
    expect(f.out).toEqual(["42"]);
    expect(seen[0]).toContain("(fetchThing())");
    expect(seen.slice(1).every((e) => e.includes("window.__harness"))).toBe(
      true
    );
  });

  it("--async exits 1 on a rejection", async () => {
    const f = fakes({
      withPage: async (_pid, body) =>
        body(async (expression) =>
          expression.includes("Promise.resolve()")
            ? { result: { type: "undefined" } }
            : {
                result: {
                  type: "object",
                  value: { done: true, ok: false, error: "Error: denied" },
                },
              }
        ),
    });
    expect(await main(["eval", "x()", "--async"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toMatch(/Error: denied/);
  });

  it("prints undefined for an expression with no value", async () => {
    const f = fakes({
      withPage: async (_pid, body) =>
        body(async () => ({ result: { type: "undefined" } })),
    });
    expect(await main(["eval", "void 0"], f.deps)).toBe(0);
    expect(f.out).toEqual(["undefined"]);
  });

  it("exits 1 when the result has no JSON value, rather than printing one", async () => {
    // The shapes inspect-webkit 0.0.5 returns for `1n` and `() => 1`.
    for (const [expression, result, shown] of [
      ["1n", { type: "bigint", description: "1n" }, "1n"],
      ["() => 1", { type: "function", value: {} }, "function"],
    ] as const) {
      const f = fakes({
        withPage: async (_pid, body) => body(async () => ({ result })),
      });
      expect(await main(["eval", expression], f.deps)).toBe(1);
      expect(f.out).toEqual([]);
      expect(f.err.join("\n")).toContain(`no JSON value (${shown})`);
    }
  });

  it("refuses a --timeout that is not a number before evaluating anything", async () => {
    // withPage throws, so a broken guard fails here instead of polling forever.
    const f = fakes({
      withPage: async () => {
        throw new Error("evaluated despite a bad --timeout");
      },
    });
    expect(
      await main(["eval", "x()", "--async", "--timeout", "foo"], f.deps)
    ).toBe(2);
    expect(f.err.join("\n")).toMatch(/--timeout wants a positive number/);
    expect(f.evaluated).toEqual([]);
  });

  it("refuses a --port that is not a port number before starting a bridge", async () => {
    const f = fakes({
      withPage: async () => {
        throw new Error("started a bridge despite a bad --port");
      },
    });
    expect(await main(["eval", "1", "--port", "99999"], f.deps)).toBe(2);
    expect(f.err.join("\n")).toMatch(/--port wants a port number/);
  });

  it("refuses eval with no expression", async () => {
    const f = fakes();
    expect(await main(["eval"], f.deps)).toBe(2);
  });
});

describe("tap, home and describe", () => {
  it("fails closed when the harness has not been built", async () => {
    const f = fakes({ exists: (p) => !p.includes(".ios-sim/harness") });
    expect(await main(["tap", "Copy"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toMatch(/build --harness/);
    expect(f.calls.some((c) => c.args.includes("test-without-building"))).toBe(
      false
    );
  });

  it("runs one test-without-building with the action in TEST_RUNNER_ env", async () => {
    const f = fakes({
      exists: () => true,
      findXctestrun: () => "/x/Harness.xctestrun",
    });
    expect(await main(["tap", "Copy"], f.deps)).toBe(0);
    const run = f.calls.find((c) => c.args.includes("test-without-building"))!;
    expect(run.args).toEqual(
      expect.arrayContaining([
        "-xctestrun",
        "/x/Harness.xctestrun",
        "-destination",
        `platform=iOS Simulator,id=${UDID}`,
      ])
    );
    expect(run.env).toMatchObject({
      TEST_RUNNER_HARNESS_ACTION: "tap",
      TEST_RUNNER_HARNESS_LABEL: "Copy",
    });
  });

  it("passes a failed UI test through as exit 1 with its reason", async () => {
    const f = fakes({
      findXctestrun: () => "/x/Harness.xctestrun",
      run: (_cmd, args) =>
        args.includes("test-without-building")
          ? {
              status: 65,
              stdout:
                'DriveTests.swift:27: error: -[HarnessUITests.DriveTests testDrive] : XCTUnwrap failed: expected non-nil value of type "XCUIElement" - no element labelled Nope\n',
              stderr: "",
            }
          : args.join(" ").startsWith("simctl list")
            ? { status: 0, stdout: BOOTED, stderr: "" }
            : { status: 0, stdout: "", stderr: "" },
    });
    expect(await main(["tap", "Nope"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toMatch(/no element labelled Nope/);
  });

  it("hands the UI test --timeout in seconds, read from milliseconds like eval's", async () => {
    for (const [argv, seconds] of [
      [["tap", "Copy"], "10"],
      [["tap", "Copy", "--timeout", "2000"], "2"],
    ] as const) {
      const f = fakes({ findXctestrun: () => "/x/Harness.xctestrun" });
      expect(await main([...argv], f.deps)).toBe(0);
      const run = f.calls.find((c) =>
        c.args.includes("test-without-building")
      )!;
      expect(run.env?.TEST_RUNNER_HARNESS_TIMEOUT).toBe(seconds);
    }
  });

  it("refuses a tap --timeout that is not a number", async () => {
    const f = fakes({ findXctestrun: () => "/x/Harness.xctestrun" });
    expect(await main(["tap", "Copy", "--timeout=30s"], f.deps)).toBe(2);
    expect(f.calls.some((c) => c.args.includes("test-without-building"))).toBe(
      false
    );
  });

  it("describe prints the tree between the markers", async () => {
    const f = fakes({
      findXctestrun: () => "/x/Harness.xctestrun",
      run: (_cmd, args) =>
        args.includes("test-without-building")
          ? {
              status: 0,
              stdout:
                "HARNESS_TREE_BEGIN\nApplication 'tC Mobile'\nHARNESS_TREE_END\n",
              stderr: "",
            }
          : { status: 0, stdout: BOOTED, stderr: "" },
    });
    expect(await main(["describe"], f.deps)).toBe(0);
    expect(f.out).toEqual(["Application 'tC Mobile'"]);
  });

  it("describe exits 1 when the run printed no tree, even if it passed", async () => {
    const f = fakes({ findXctestrun: () => "/x/Harness.xctestrun" });
    expect(await main(["describe"], f.deps)).toBe(1);
    expect(f.err.join("\n")).toMatch(/describe printed no element tree/);
  });

  it("refuses tap with no label", async () => {
    const f = fakes({ findXctestrun: () => "/x/Harness.xctestrun" });
    expect(await main(["tap"], f.deps)).toBe(2);
  });
});

describe("logs", () => {
  it("asks for the last --seconds of the app's log", async () => {
    const f = fakes();
    expect(await main(["logs", "--seconds", "5"], f.deps)).toBe(0);
    const show = f.calls.find((c) => c.args.includes("show"))!;
    expect(show.args).toEqual(expect.arrayContaining(["--last", "5s"]));
  });

  it("refuses a --seconds that is not a positive number", async () => {
    const f = fakes();
    expect(await main(["logs", "--seconds", "foo"], f.deps)).toBe(2);
    expect(f.calls.some((c) => c.args.includes("show"))).toBe(false);
  });
});

describe("build", () => {
  it("copies web assets with cap copy, never cap sync (sync rewrites Package.swift)", async () => {
    const f = fakes();
    expect(await main(["build"], f.deps)).toBe(0);
    const lines = f.calls.map((c) => `${c.cmd} ${c.args.join(" ")}`);
    expect(lines).toContain("npx cap copy ios");
    expect(lines.some((l) => l.includes("cap sync"))).toBe(false);
    expect(lines.some((l) => l.includes("CODE_SIGNING_ALLOWED=NO"))).toBe(true);
  });

  it("stops at the first failing step", async () => {
    const f = fakes({
      run: (_cmd, args) => ({
        status: args.includes("build:native") ? 1 : 0,
        stdout: "",
        stderr: "vite failed",
      }),
    });
    expect(await main(["build"], f.deps)).toBe(1);
    expect(f.calls.some((c) => c.cmd === "xcodebuild")).toBe(false);
  });
});

describe("the real entry path", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ios-sim-entry-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // A fake xcrun that reports no booted device: `npm run ios-sim -- eval`
  // must fail closed through main()'s real defaults, not just the fakes'.
  const xcrun = path.join(dir, "xcrun");
  writeFileSync(
    xcrun,
    `#!/bin/sh\nif [ "$1 $2 $3" = "simctl list devices" ]; then echo '{"devices":{}}'; exit 0; fi\necho "unexpected: $*" >&2; exit 9\n`
  );
  chmodSync(xcrun, 0o755);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };

  it("fails closed with no booted Simulator", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts/ios-sim.mjs"), "eval", "1+1"],
      { env, encoding: "utf8" }
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no booted Simulator/);
    expect(r.stderr).not.toMatch(/unexpected/);
  });

  it("prints usage and exits 2 with no command", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts/ios-sim.mjs")],
      { env, encoding: "utf8" }
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage:/);
  });
});

describe("reachableOn, the check that the bridge is loopback-only", () => {
  const listening = (host: string) =>
    new Promise<{ server: Server; port: number }>((resolve) => {
      const server = createServer().listen(0, host, () => {
        const address = server.address();
        if (address === null || typeof address === "string")
          throw new Error("no TCP address");
        resolve({ server, port: address.port });
      });
    });

  it("names the address a listener answers on", async () => {
    const { server, port } = await listening("127.0.0.1");
    try {
      await expect(reachableOn(port, ["127.0.0.1"])).resolves.toBe("127.0.0.1");
    } finally {
      server.close();
    }
  });

  it("counts a connection that neither opens nor refuses as reachable", async () => {
    // Fail closed: a probe that timed out has not shown the port is shut.
    const stalled = () => {
      const socket = Object.assign(new EventEmitter(), { destroy() {} });
      setTimeout(() => socket.emit("timeout"), 0);
      return socket;
    };
    await expect(
      reachableOn(1, ["10.0.0.9"], { connect: stalled })
    ).resolves.toBe("10.0.0.9");
  });

  it("returns null once nothing answers", async () => {
    const { server, port } = await listening("127.0.0.1");
    await new Promise((r) => server.close(r));
    await expect(reachableOn(port, ["127.0.0.1"])).resolves.toBeNull();
  });
});

describe("withPage restores console.error (#1857 F2)", () => {
  it("restores it when startCdpServer throws", async () => {
    const before = console.error;
    await expect(
      withPage(
        1,
        async () => 0,
        {},
        {
          startServer: async () => {
            throw new Error("EADDRINUSE");
          },
        }
      )
    ).rejects.toThrow(/EADDRINUSE/);
    expect(console.error).toBe(before);
  });

  it("restores it when stop() throws (#1891)", async () => {
    const before = console.error;
    await expect(
      withPage(
        1,
        async () => 0,
        { port: "1" },
        {
          startServer: async () => ({
            stop: () => {
              throw new Error("stop failed");
            },
          }),
        }
      )
    ).rejects.toThrow();
    expect(console.error).toBe(before);
  });

  it("restores it when stop() is fine (green case)", async () => {
    const before = console.error;
    await expect(
      withPage(
        1,
        async () => 0,
        { port: "1" },
        { startServer: async () => ({ stop: () => {} }) }
      )
    ).rejects.toThrow();
    expect(console.error).toBe(before);
  });
});

describe("the pinned inspect-webkit bridge, on a real socket", () => {
  // The bind spelling is only worth what the dependency does with it, so this
  // starts the real server rather than comparing strings. Its sources are
  // optional: with no device or Simulator it still listens.
  const external = nonLoopbackAddresses(networkInterfaces());
  const freePort = async () => {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    await new Promise((r) => server.close(r));
    if (address === null || typeof address === "string")
      throw new Error("no TCP address");
    return address.port;
  };
  const quietly = async <T>(body: () => Promise<T>) => {
    const quiet = console.error;
    console.error = () => {};
    try {
      return await body();
    } finally {
      console.error = quiet;
    }
  };

  it("has an external address to probe, or this test would prove nothing", () => {
    expect(external.length).toBeGreaterThan(0);
  });

  it("answers on loopback and on no external address when bound to BRIDGE_HOST", async () => {
    const port = await freePort();
    const server = await quietly(() =>
      startCdpServer({ port, host: BRIDGE_HOST })
    );
    try {
      await expect(reachableOn(port, ["127.0.0.1"])).resolves.toBe("127.0.0.1");
      await expect(reachableOn(port, external)).resolves.toBeNull();
    } finally {
      server.stop();
    }
  });

  // A host with no fe80 address cannot show this, so it reports as skipped
  // rather than as a pass that asserted nothing.
  const linkLocal = external.filter((a) => a.startsWith("fe80:"));
  it.skipIf(linkLocal.length === 0)(
    "a server on :: is caught through a link-local address alone (#1857 F1)",
    async () => {
      const port = await freePort();
      const server = createServer();
      // reachableOn resolves the same for an accept and for a connect timeout
      // (the README counts a timeout as reachable), so the result alone cannot
      // tell them apart. The server's own connection event can: only a real
      // accept raises it.
      const accepted = new Promise<void>((r) => server.once("connection", r));
      await new Promise<void>((r) => server.listen(port, "::", r));
      try {
        await expect(reachableOn(port, linkLocal)).resolves.toBe(linkLocal[0]);
        await expect(
          Promise.race([
            accepted.then(() => "accepted"),
            new Promise((r) => setTimeout(() => r("no accept"), 1000)),
          ])
        ).resolves.toBe("accepted");
      } finally {
        server.close();
      }
    }
  );

  it("answers on an external address when bound to localhost (the state F1 found)", async () => {
    const port = await freePort();
    const server = await quietly(() =>
      startCdpServer({ port, host: "localhost" })
    );
    try {
      await expect(reachableOn(port, external)).resolves.not.toBeNull();
    } finally {
      server.stop();
    }
  });
});
