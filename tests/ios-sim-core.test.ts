import { describe, expect, it } from "vitest";

import {
  appPid,
  asyncExpression,
  bootedDevice,
  BRIDGE_HOST,
  harnessEnv,
  nonLoopbackAddresses,
  parseArgs,
  pickTarget,
  pollSlot,
  slotExpression,
  numberFlag,
} from "../scripts/ios-sim-core.mjs";

// The pure half of the iOS Simulator harness (#1840): everything the CLI
// decides without touching a Simulator. The CLI, its guards and its entry
// path are pinned in tests/ios-sim.test.ts.

const BUNDLE = "org.unfoldingword.tcmobile";

describe("parseArgs", () => {
  it("reads the command, its positionals and --flags", () => {
    expect(
      parseArgs(["eval", "1+1", "--async", "--timeout=5000", "--device", "X"])
    ).toEqual({
      command: "eval",
      positionals: ["1+1"],
      flags: { async: true, timeout: "5000", device: "X" },
    });
  });

  it("never lets a boolean flag swallow the positional after it", () => {
    expect(parseArgs(["eval", "--async", "Promise.resolve(1)"])).toEqual({
      command: "eval",
      positionals: ["Promise.resolve(1)"],
      flags: { async: true },
    });
    expect(parseArgs(["build", "--harness", "x", "--verbose", "y"])).toEqual({
      command: "build",
      positionals: ["x", "y"],
      flags: { harness: true, verbose: true },
    });
  });

  it("returns no command for an empty argv", () => {
    expect(parseArgs([]).command).toBeUndefined();
  });
});

describe("bootedDevice", () => {
  const list = {
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
        { udid: "A", name: "iPhone 18 Pro", state: "Shutdown" },
        { udid: "B", name: "iPhone 17e", state: "Booted" },
      ],
    },
  };

  it("finds the booted device", () => {
    expect(bootedDevice(list)).toEqual({ udid: "B", name: "iPhone 17e" });
  });

  it("matches a named device only when it is booted", () => {
    expect(bootedDevice(list, "iPhone 17e")?.udid).toBe("B");
    expect(bootedDevice(list, "iPhone 18 Pro")).toBeNull();
  });

  it("returns null when nothing is booted", () => {
    expect(bootedDevice({ devices: {} })).toBeNull();
  });
});

describe("appPid", () => {
  // `xcrun simctl spawn <udid> launchctl list`, trimmed to the shape it has.
  const launchctl = [
    "PID\tStatus\tLabel",
    "512\t0\tUIKitApplication:org.unfoldingword.tcmobile.harnesshost[1a2b][rb-legacy]",
    "6800\t0\tUIKitApplication:org.unfoldingword.tcmobile[5c86][rb-legacy]",
    "-\t0\tUIKitApplication:com.apple.mobilesafari[77aa][rb-legacy]",
  ].join("\n");

  it("reads the running app's pid, not a bundle that only starts with it", () => {
    expect(appPid(launchctl, BUNDLE)).toBe(6800);
  });

  it("returns null when the app has no live process", () => {
    expect(appPid(launchctl, "com.apple.mobilesafari")).toBeNull();
    expect(appPid(launchctl, "org.example.absent")).toBeNull();
  });
});

describe("pickTarget", () => {
  const page = (id: string, url = "about:blank") => ({
    id,
    type: "page",
    url,
    webSocketDebuggerUrl: `ws://localhost:9224/devtools/page/${id}`,
  });

  it("picks the page whose id carries the app's pid", () => {
    const list = [page("sim:1:PID:41:1"), page("sim:1:PID:6800:1")];
    expect(pickTarget(list, 6800)?.id).toBe("sim:1:PID:6800:1");
  });

  it("does not choose by URL: a stale about:blank listing still matches by pid", () => {
    expect(
      pickTarget([page("sim:1:PID:6800:1", "about:blank")], 6800)
    ).not.toBeNull();
    expect(
      pickTarget([page("sim:1:PID:41:1", "capacitor://localhost")], 6800)
    ).toBeNull();
  });

  it("does not let pid 68 match PID:6800", () => {
    expect(pickTarget([page("sim:1:PID:6800:1")], 68)).toBeNull();
  });

  it("ignores non-page targets", () => {
    expect(
      pickTarget([{ ...page("sim:1:PID:6800:1"), type: "worker" }], 6800)
    ).toBeNull();
  });
});

describe("asyncExpression and slotExpression", () => {
  it("stores a resolved value in the slot", async () => {
    const window: Record<string, unknown> = {};
    new Function("window", asyncExpression("Promise.resolve(41 + 1)", "s1"))(
      window
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(
      new Function("window", `return ${slotExpression("s1")}`)(window)
    ).toEqual({ done: true, ok: true, value: 42 });
  });

  it("stores a rejection's message, not a resolved value", async () => {
    const window: Record<string, unknown> = {};
    new Function(
      "window",
      asyncExpression('Promise.reject(new Error("nope"))', "s2")
    )(window);
    await new Promise((r) => setTimeout(r, 0));
    expect(
      new Function("window", `return ${slotExpression("s2")}`)(window)
    ).toEqual({ done: true, ok: false, error: "Error: nope" });
  });

  it("reads an unfinished slot as not done", () => {
    const window: Record<string, unknown> = {};
    new Function("window", asyncExpression("new Promise(() => {})", "s3"))(
      window
    );
    expect(
      new Function("window", `return ${slotExpression("s3")}`)(window)
    ).toEqual({ done: false });
  });
});

describe("pollSlot", () => {
  const clock = () => {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  };

  it("returns the value once the slot is done", async () => {
    const reads = [{ done: false }, { done: true, ok: true, value: "v" }];
    const read = async () => reads.shift();
    await expect(
      pollSlot(read, { timeoutMs: 1000, intervalMs: 100, ...clock() })
    ).resolves.toBe("v");
  });

  it("throws the page's error when the promise rejected", async () => {
    const read = async () => ({ done: true, ok: false, error: "Error: nope" });
    await expect(
      pollSlot(read, { timeoutMs: 1000, intervalMs: 100, ...clock() })
    ).rejects.toThrow("Error: nope");
  });

  it("times out instead of waiting forever", async () => {
    // Capped so a broken timeout fails here instead of hanging the worker.
    let reads = 0;
    const read = async () => {
      if (++reads > 1000) throw new Error("pollSlot never timed out");
      return { done: false };
    };
    await expect(
      pollSlot(read, { timeoutMs: 500, intervalMs: 100, ...clock() })
    ).rejects.toThrow(/timed out after 500 ms/);
  });
});

describe("harnessEnv", () => {
  it("passes the action to the UI test through TEST_RUNNER_ variables", () => {
    expect(harnessEnv({ action: "tap", label: "Copy", timeoutS: 8 })).toEqual({
      TEST_RUNNER_HARNESS_ACTION: "tap",
      TEST_RUNNER_HARNESS_LABEL: "Copy",
      TEST_RUNNER_HARNESS_TIMEOUT: "8",
      TEST_RUNNER_HARNESS_BUNDLE: BUNDLE,
    });
  });

  it("refuses a tap with no label", () => {
    expect(() => harnessEnv({ action: "tap" })).toThrow(/needs a label/);
  });
});

describe("the inspector bridge's bind address", () => {
  it("is loopback, spelled so inspect-webkit 0.0.5 does not widen it to ::", () => {
    // Its listen() maps localhost, 127.0.0.1 and ::1 to a dual-stack "::",
    // which is every interface. Any other spelling is passed through as is.
    expect(BRIDGE_HOST).toBe("::ffff:127.0.0.1");
  });

  it("lists every external address and no loopback or link-local one", () => {
    expect(
      nonLoopbackAddresses({
        lo0: [
          { address: "127.0.0.1", family: "IPv4", internal: true },
          { address: "::1", family: "IPv6", internal: true },
        ],
        en0: [
          { address: "fe80::1c2b:3a4d", family: "IPv6", internal: false },
          { address: "10.250.0.36", family: "IPv4", internal: false },
          { address: "2001:db8::5", family: "IPv6", internal: false },
        ],
        utun3: undefined,
      })
    ).toEqual(["10.250.0.36", "2001:db8::5"]);
  });
});

describe("numberFlag", () => {
  it("reads a number flag, with a default when it is absent", () => {
    expect(numberFlag({}, "timeout", 30_000)).toBe(30_000);
    expect(numberFlag({ timeout: "2500" }, "timeout", 30_000)).toBe(2500);
    expect(numberFlag({ seconds: "5" }, "seconds", 60)).toBe(5);
    expect(numberFlag({ port: "9230" }, "port", 9224)).toBe(9230);
  });

  it("refuses a timeout or seconds that is not a positive number, so nothing waits forever", () => {
    for (const bad of [
      "foo",
      "30s",
      "NaN",
      "Infinity",
      "0",
      "-5",
      true,
    ] as const) {
      expect(() => numberFlag({ timeout: bad }, "timeout", 1)).toThrow(
        /--timeout wants a positive number of milliseconds/
      );
      expect(() => numberFlag({ seconds: bad }, "seconds", 1)).toThrow(
        /--seconds wants a positive number of seconds/
      );
    }
  });

  it("refuses a port that is not a whole number from 1 to 65535", () => {
    for (const bad of ["foo", "0", "65536", "9224.5", true] as const)
      expect(() => numberFlag({ port: bad }, "port", 9224)).toThrow(
        /--port wants a port number from 1 to 65535/
      );
  });
});
