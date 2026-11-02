#!/usr/bin/env node
/**
 * Drive the native iOS build in the Simulator from the shell (#1840): build,
 * boot, install, evaluate JS in the app's WKWebView, tap native UI, capture
 * screenshots and logs. Local and Mac-only; nothing here runs in CI.
 *
 *   npm run ios-sim -- build [--harness]
 *   npm run ios-sim -- boot [--device "<name>"] | install | launch | grant-mic
 *   npm run ios-sim -- eval '<expression>' [--async] [--timeout <ms>] [--port <n>]
 *   npm run ios-sim -- tap '<accessibility label>' | home | describe
 *   npm run ios-sim -- shot <file.png> | logs [--seconds <n>]
 *
 * JS goes through inspect-webkit's CDP bridge, started for one command and
 * stopped after it, so no long-lived bridge can hold a target from an earlier
 * boot. Native taps go through ios/Harness (one XCUITest run per command).
 * What the Simulator cannot stand in for is listed in docs/native/README.md.
 * The decisions are in scripts/ios-sim-core.mjs; this file only acts.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import net from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";

import { isMainEntry } from "./check-commit-messages.mjs";
import {
  appPid,
  asyncExpression,
  bootedDevice,
  BRIDGE_HOST,
  BUNDLE_ID,
  harnessEnv,
  nonLoopbackAddresses,
  parseArgs,
  pickTarget,
  pollSlot,
  slotExpression,
} from "./ios-sim-core.mjs";

const USAGE = `usage: npm run ios-sim -- <command>
  build [--harness]        build the app for the Simulator (or the XCUITest harness)
  boot [--device <name>]   boot a Simulator (default: the first available iPhone)
  install | launch         install or launch the built app on the booted Simulator
  grant-mic                pre-grant the microphone to tC Mobile
  eval <expr> [--async]    evaluate JS in the app's WebView and print the value
  tap <label> | home | describe   native UI through XCUITest
  shot <file.png>          screenshot the booted Simulator
  logs [--seconds <n>]     print the app's recent log`;

const APP_PRODUCTS =
  ".ios-sim/app/Build/Products/Debug-iphonesimulator/App.app";
const HARNESS_PRODUCTS = ".ios-sim/harness/Build/Products";

class Fail extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

function check(result, what) {
  if (result.status !== 0) {
    throw new Fail(
      `${what} failed (exit ${result.status})${result.stderr ? `: ${result.stderr.trim()}` : ""}`
    );
  }
  return result;
}

function booted(deps, flags) {
  const list = JSON.parse(
    check(
      deps.run("xcrun", ["simctl", "list", "devices", "--json"]),
      "simctl list"
    ).stdout
  );
  const device = bootedDevice(
    list,
    typeof flags.device === "string" ? flags.device : undefined
  );
  if (!device)
    throw new Fail("no booted Simulator: run `npm run ios-sim -- boot` first");
  return device;
}

function runningPid(deps, udid) {
  const listing = check(
    deps.run("xcrun", ["simctl", "spawn", udid, "launchctl", "list"]),
    "launchctl list"
  ).stdout;
  const pid = appPid(listing, BUNDLE_ID);
  if (pid === null)
    throw new Fail(
      "tC Mobile is not running: run `npm run ios-sim -- launch` first"
    );
  return pid;
}

/** The CDP reply's value, or a Fail carrying the page's exception. */
function valueOf(reply) {
  if (reply.wasThrown || reply.exceptionDetails) {
    throw new Fail(
      `page threw: ${reply.exceptionDetails?.text ?? reply.result?.description ?? "unknown error"}`
    );
  }
  return reply.result?.value;
}

async function evalCommand(deps, positionals, flags) {
  const [expression] = positionals;
  if (!expression) throw new Fail("eval needs an expression", 2);
  const device = booted(deps, flags);
  const pid = runningPid(deps, device.udid);
  const value = await deps.withPage(
    pid,
    async (evaluate) => {
      if (!flags.async) return valueOf(await evaluate(expression));
      const slot = `s${deps.now()}`;
      valueOf(await evaluate(asyncExpression(expression, slot)));
      return pollSlot(
        async () => valueOf(await evaluate(slotExpression(slot))),
        {
          timeoutMs: Number(flags.timeout ?? 30_000),
          intervalMs: 200,
          now: deps.now,
          sleep: deps.sleep,
        }
      ).catch((e) => {
        throw new Fail(e.message);
      });
    },
    flags
  );
  deps.out(value === undefined ? "undefined" : JSON.stringify(value));
}

function harnessCommand(deps, action, positionals, flags) {
  const label = positionals[0];
  if (action === "tap" && !label)
    throw new Fail("tap needs an accessibility label", 2);
  const device = booted(deps, flags);
  const xctestrun = (deps.findXctestrun ?? findXctestrun)(deps);
  if (!xctestrun)
    throw new Fail(
      "the harness is not built: run `npm run ios-sim -- build --harness`"
    );
  const timeoutS = flags.timeout === undefined ? 10 : Number(flags.timeout);
  const result = deps.run(
    "xcodebuild",
    [
      "test-without-building",
      "-xctestrun",
      xctestrun,
      "-destination",
      `platform=iOS Simulator,id=${device.udid}`,
    ],
    { env: harnessEnv({ action, label, timeoutS }) }
  );
  const output = result.stdout + result.stderr;
  if (action === "describe") {
    const tree = output.match(
      /HARNESS_TREE_BEGIN\n([\s\S]*?)\nHARNESS_TREE_END/
    );
    if (tree) deps.out(tree[1]);
  }
  if (result.status !== 0) {
    const reason = output
      .split("\n")
      .find((l) => l.includes("error:"))
      ?.replace(/^.*?error:\s*/, "");
    throw new Fail(
      `${action} failed: ${reason ?? `xcodebuild exit ${result.status}`}`
    );
  }
}

/** The .xctestrun `build --harness` leaves, or null when it has not run. */
function findXctestrun(deps) {
  const dir = path.join(deps.root, HARNESS_PRODUCTS);
  if (!deps.exists(dir)) return null;
  const name = readdirSync(dir).find((f) => f.endsWith(".xctestrun"));
  return name ? path.join(dir, name) : null;
}

function build(deps, flags) {
  if (flags.harness) {
    const device = booted(deps, flags);
    check(
      deps.run(
        "xcodebuild",
        [
          "build-for-testing",
          "-project",
          "ios/Harness/Harness.xcodeproj",
          "-scheme",
          "Harness",
          "-destination",
          `platform=iOS Simulator,id=${device.udid}`,
          "-derivedDataPath",
          ".ios-sim/harness",
        ],
        { inherit: true }
      ),
      "harness build"
    );
    return;
  }
  // `cap copy`, not `cap sync`: sync rewrites ios/App/CapApp-SPM/Package.swift
  // and drops its 15.4 floor (#1052); the committed package is already resolved.
  check(
    deps.run("npm", ["run", "build:native"], { inherit: true }),
    "build:native"
  );
  check(
    deps.run("npx", ["cap", "copy", "ios"], { inherit: true }),
    "cap copy ios"
  );
  check(
    deps.run(
      "xcodebuild",
      [
        "-project",
        "ios/App/App.xcodeproj",
        "-scheme",
        "App",
        "-sdk",
        "iphonesimulator",
        "-configuration",
        "Debug",
        "-derivedDataPath",
        ".ios-sim/app",
        "CODE_SIGNING_ALLOWED=NO",
        "build",
      ],
      { inherit: true }
    ),
    "app build"
  );
}

function boot(deps, flags) {
  const list = JSON.parse(
    check(
      deps.run("xcrun", ["simctl", "list", "devices", "available", "--json"]),
      "simctl list"
    ).stdout
  );
  const already = bootedDevice(
    list,
    typeof flags.device === "string" ? flags.device : undefined
  );
  if (already) return deps.out(`booted: ${already.name} ${already.udid}`);
  const all = Object.values(list.devices ?? {}).flat();
  const device =
    typeof flags.device === "string"
      ? all.find((d) => d.name === flags.device)
      : all.find((d) => d.name.startsWith("iPhone"));
  if (!device)
    throw new Fail(
      `no available Simulator${typeof flags.device === "string" ? ` named ${flags.device}` : ""}`
    );
  check(deps.run("xcrun", ["simctl", "boot", device.udid]), "simctl boot");
  check(
    deps.run("xcrun", ["simctl", "bootstatus", device.udid, "-b"]),
    "simctl bootstatus"
  );
  deps.out(`booted: ${device.name} ${device.udid}`);
}

const COMMANDS = {
  build: (deps, _p, flags) => build(deps, flags),
  boot: (deps, _p, flags) => boot(deps, flags),
  install: (deps, _p, flags) => {
    const device = booted(deps, flags);
    const app = path.join(deps.root, APP_PRODUCTS);
    if (!deps.exists(app))
      throw new Fail("the app is not built: run `npm run ios-sim -- build`");
    check(
      deps.run("xcrun", ["simctl", "install", device.udid, app]),
      "simctl install"
    );
  },
  launch: (deps, _p, flags) =>
    deps.out(
      check(
        deps.run("xcrun", [
          "simctl",
          "launch",
          booted(deps, flags).udid,
          BUNDLE_ID,
        ]),
        "simctl launch"
      ).stdout.trim()
    ),
  "grant-mic": (deps, _p, flags) =>
    check(
      deps.run("xcrun", [
        "simctl",
        "privacy",
        booted(deps, flags).udid,
        "grant",
        "microphone",
        BUNDLE_ID,
      ]),
      "simctl privacy"
    ),
  eval: evalCommand,
  tap: (deps, p, flags) => harnessCommand(deps, "tap", p, flags),
  home: (deps, p, flags) => harnessCommand(deps, "home", p, flags),
  describe: (deps, p, flags) => harnessCommand(deps, "describe", p, flags),
  shot: (deps, [file], flags) => {
    if (!file) throw new Fail("shot needs a file path", 2);
    check(
      deps.run("xcrun", [
        "simctl",
        "io",
        booted(deps, flags).udid,
        "screenshot",
        file,
      ]),
      "simctl io screenshot"
    );
  },
  logs: (deps, _p, flags) =>
    deps.out(
      check(
        deps.run("xcrun", [
          "simctl",
          "spawn",
          booted(deps, flags).udid,
          "log",
          "show",
          "--style",
          "compact",
          "--last",
          `${Number(flags.seconds ?? 60)}s`,
          "--predicate",
          'process == "App"',
        ]),
        "log show"
      ).stdout
    ),
};

export async function main(argv, deps = realDeps()) {
  const { command, positionals, flags } = parseArgs(argv);
  const run = COMMANDS[command];
  if (!run) {
    deps.err(USAGE);
    return 2;
  }
  try {
    await run(deps, positionals, flags);
    return 0;
  } catch (e) {
    deps.err(`ios-sim: ${e.message}`);
    if (e.code === 2) deps.err(USAGE);
    return e instanceof Fail ? e.code : 1;
  }
}

function realDeps() {
  const root = path.resolve(import.meta.dirname, "..");
  return {
    root,
    run: (cmd, args, opts = {}) => {
      const r = spawnSync(cmd, args, {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, ...opts.env },
        stdio: opts.inherit ? "inherit" : "pipe",
        maxBuffer: 64 * 1024 * 1024,
      });
      if (r.error) return { status: 127, stdout: "", stderr: r.error.message };
      return {
        status: r.status,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
      };
    },
    exists: existsSync,
    withPage,
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

/** The first of `addresses` that accepts a TCP connection on `port`, or null. */
export async function reachableOn(port, addresses, timeoutMs = 500) {
  for (const host of addresses) {
    const open = await new Promise((resolve) => {
      const socket = net.connect({ host, port, timeout: timeoutMs });
      const done = (ok) => {
        socket.destroy();
        resolve(ok);
      };
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
      socket.once("timeout", () => done(false));
    });
    if (open) return host;
  }
  return null;
}

/** Start the bridge, find the app's page, hand `body` an evaluate(), stop the bridge. */
async function withPage(pid, body, flags = {}) {
  const port = Number(flags.port ?? 9224);
  const { startCdpServer } = await import("inspect-webkit");
  const quiet = console.error;
  // The bridge prints a banner and narrates every attach on console.error. Our
  // own failures go through process.stderr, so muting it loses nothing of ours.
  if (!flags.verbose) console.error = () => {};
  const server = await startCdpServer({ port, host: BRIDGE_HOST });
  try {
    // The debugger has no authentication, so a bridge another machine can
    // reach is refused before any target is attached (BRIDGE_HOST says why).
    const exposed = await reachableOn(
      port,
      nonLoopbackAddresses(networkInterfaces())
    );
    if (exposed)
      throw new Fail(
        `the inspector bridge answers on ${exposed}:${port}, not only on loopback; refusing to evaluate`
      );
    let target = null;
    for (let i = 0; i < 50 && !target; i++) {
      const list = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      target = pickTarget(list, pid);
      if (!target) await new Promise((r) => setTimeout(r, 100));
    }
    if (!target)
      throw new Fail(
        `no WebView target for pid ${pid} (a Debug build? has the page loaded?)`
      );
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", () =>
        reject(new Fail("could not attach to the WebView"))
      );
    });
    let next = 0;
    const evaluate = (expression) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(
          () => reject(new Fail("the WebView did not answer within 10 s")),
          10_000
        );
        const onMessage = (event) => {
          const m = JSON.parse(event.data);
          if (m.id !== id) return;
          clearTimeout(timer);
          ws.removeEventListener("message", onMessage);
          resolve(
            m.result ?? {
              wasThrown: true,
              exceptionDetails: { text: m.error?.message },
            }
          );
        };
        ws.addEventListener("message", onMessage);
        ws.send(
          JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression, returnByValue: true },
          })
        );
      });
    try {
      return await body(evaluate);
    } finally {
      ws.close();
    }
  } finally {
    server.stop();
    console.error = quiet;
  }
}

if (isMainEntry(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
