/**
 * The pure half of the iOS Simulator harness (#1840): argument parsing,
 * picking the booted Simulator, the app's process and its WebView target,
 * the async-eval slot protocol, and the XCUITest action environment. No
 * process, socket or Simulator is touched here; scripts/ios-sim.mjs does that.
 */

export const BUNDLE_ID = "org.unfoldingword.tcmobile";

/**
 * Where the inspector bridge listens. inspect-webkit 0.0.5's listen() turns
 * localhost, 127.0.0.1 and ::1 into a dual-stack "::", every interface, with no
 * authentication on the debugger. This spelling of loopback is passed through
 * unchanged. scripts/ios-sim.mjs still checks after starting it, since a
 * dependency upgrade could widen this one too.
 */
export const BRIDGE_HOST = "::ffff:127.0.0.1";

/**
 * The addresses `os.networkInterfaces()` reports that another machine could
 * reach, link-local IPv6 included (#1857): a "::" bind answers on those too,
 * and the connect needs the interface as a zone (`fe80::1%en0`) to be dialled.
 * An empty result means no external interface, so nothing remote can connect.
 */
export function nonLoopbackAddresses(interfaces) {
  return Object.entries(interfaces).flatMap(([name, addrs]) =>
    (addrs ?? [])
      .filter((a) => a && !a.internal)
      .map((a) =>
        a.address.toLowerCase().startsWith("fe80:")
          ? `${a.address}%${name}`
          : a.address
      )
  );
}

/** Flags that never take a value, so `eval --async '<js>'` keeps its `<js>`. */
const BOOLEAN_FLAGS = new Set(["async", "harness", "verbose"]);

/** `ios-sim <command> [positionals] [--flag | --flag=value | --flag value]`. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positionals = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (
      !BOOLEAN_FLAGS.has(arg.slice(2)) &&
      rest[i + 1] !== undefined &&
      !rest[i + 1].startsWith("--")
    ) {
      flags[arg.slice(2)] = rest[++i];
    } else flags[arg.slice(2)] = true;
  }
  return { command, positionals, flags };
}

/** Every booted device in `xcrun simctl list devices --json`, optionally only the one named. */
export function bootedDevices(list, name) {
  const found = [];
  for (const devices of Object.values(list.devices ?? {})) {
    for (const d of devices) {
      if (d.state === "Booted" && (name === undefined || d.name === name)) {
        found.push({ udid: d.udid, name: d.name });
      }
    }
  }
  return found;
}

/** The first booted device, optionally by name. Callers that act on it use bootedDevices and refuse an ambiguous pick. */
export function bootedDevice(list, name) {
  return bootedDevices(list, name)[0] ?? null;
}

/**
 * The live pid of `bundleId` in `simctl spawn <udid> launchctl list`. The
 * label is `UIKitApplication:<bundle>[…]`, so the bracket ends the match: the
 * harness host's `<bundle>.harnesshost` must not count as the app.
 */
export function appPid(launchctl, bundleId) {
  const label = `UIKitApplication:${bundleId}[`;
  for (const line of launchctl.split("\n")) {
    const [pid, , name] = line.split("\t");
    if (name?.startsWith(label) && /^\d+$/.test(pid)) return Number(pid);
  }
  return null;
}

/**
 * The CDP page whose id carries `PID:<pid>:`. Never by URL: the bridge's
 * listing has shown a stale `about:blank` for a page on capacitor://localhost.
 */
export function pickTarget(list, pid) {
  return (
    list.find((t) => t.type === "page" && t.id.includes(`:PID:${pid}:`)) ?? null
  );
}

/**
 * The bridge does not translate `awaitPromise`, so an async expression runs
 * detached and leaves its outcome in `window.__harness[slot]` for pollSlot.
 */
export function asyncExpression(expression, slot) {
  const at = `window.__harness[${JSON.stringify(slot)}]`;
  return [
    "window.__harness = window.__harness || {};",
    `${at} = { done: false };`,
    `Promise.resolve().then(() => (${expression})).then(`,
    `  (value) => { ${at} = { done: true, ok: true, value }; },`,
    `  (e) => { ${at} = { done: true, ok: false, error: String(e) }; }`,
    ");",
  ].join("\n");
}

export function slotExpression(slot) {
  return `(window.__harness && window.__harness[${JSON.stringify(slot)}]) || { done: false }`;
}

/** Read the slot until it is done; resolve its value, throw its error, or time out. */
export async function pollSlot(read, { timeoutMs, intervalMs, now, sleep }) {
  const start = now();
  for (;;) {
    const slot = await read();
    if (slot?.done) {
      if (slot.ok) return slot.value;
      throw new Error(slot.error);
    }
    if (now() - start >= timeoutMs) {
      throw new Error(`async eval timed out after ${timeoutMs} ms`);
    }
    await sleep(intervalMs);
  }
}

/** What each number flag accepts. `--timeout` is milliseconds for eval and tap alike. */
const NUMBER_FLAGS = {
  timeout: "a positive number of milliseconds",
  seconds: "a positive number of seconds",
  port: "a port number from 1 to 65535",
};

/**
 * A number flag's value, or `fallback` when it is absent. Anything else is
 * refused: `NaN` never satisfies pollSlot's deadline check, for one.
 */
export function numberFlag(flags, name, fallback) {
  const value = flags[name];
  if (value === undefined) return fallback;
  const n = typeof value === "string" ? Number(value) : NaN;
  const ok =
    name === "port"
      ? Number.isInteger(n) && n >= 1 && n <= 65535
      : Number.isFinite(n) && n > 0;
  if (!ok)
    throw new Error(`--${name} wants ${NUMBER_FLAGS[name]}, got ${value}`);
  return n;
}

/** What DriveTests.swift handles; tests/ios-harness-project.test.ts keeps the two in step. */
export const HARNESS_ACTIONS = ["tap", "home", "describe"];
const ACTIONS = new Set(HARNESS_ACTIONS);

/** The env `xcodebuild test-without-building` hands DriveTests (TEST_RUNNER_ is stripped). */
export function harnessEnv({ action, label, timeoutS = 10 }) {
  if (!ACTIONS.has(action)) throw new Error(`unknown harness action ${action}`);
  if (action === "tap" && !label) throw new Error("tap needs a label");
  return {
    TEST_RUNNER_HARNESS_ACTION: action,
    TEST_RUNNER_HARNESS_LABEL: label ?? "",
    TEST_RUNNER_HARNESS_TIMEOUT: String(timeoutS),
    TEST_RUNNER_HARNESS_BUNDLE: BUNDLE_ID,
  };
}
