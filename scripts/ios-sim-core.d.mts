// Hand-written declaration for ios-sim-core.mjs's exports, so
// tests/ios-sim-core.test.ts type-checks without pulling scripts/ into
// tsconfig.app.json's `include` (the same arrangement as check-deploy.d.mts).

export declare const BUNDLE_ID: string;
export declare const BRIDGE_HOST: string;

export interface InterfaceAddress {
  address: string;
  family: string;
  internal: boolean;
}

export declare function nonLoopbackAddresses(
  interfaces: Record<string, InterfaceAddress[] | undefined>
): string[];

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | true>;
}
export declare function parseArgs(argv: string[]): ParsedArgs;

/** `xcrun simctl list devices --json`, as much of it as the core reads. */
export interface DeviceList {
  devices?: Record<
    string,
    Array<{ udid: string; name: string; state: string; [key: string]: unknown }>
  >;
}
export declare function bootedDevice(
  list: DeviceList,
  name?: string
): { udid: string; name: string } | null;

export declare function appPid(
  launchctl: string,
  bundleId: string
): number | null;

/** One entry of the bridge's `/json/list`. */
export interface CdpPage {
  id: string;
  type: string;
  url?: string;
  webSocketDebuggerUrl?: string;
  [key: string]: unknown;
}
export declare function pickTarget<T extends CdpPage>(
  list: T[],
  pid: number
): T | null;

export declare function asyncExpression(
  expression: string,
  slot: string
): string;
export declare function slotExpression(slot: string): string;

/** What slotExpression reads back: `{ done: false }`, or done with a value or an error. */
export interface Slot {
  done: boolean;
  ok?: boolean;
  value?: unknown;
  error?: string;
}
export declare function pollSlot(
  read: () => Promise<Slot | undefined>,
  options: {
    timeoutMs: number;
    intervalMs: number;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
  }
): Promise<unknown>;

export declare function numberFlag(
  flags: Record<string, string | true | undefined>,
  name: "timeout" | "seconds" | "port",
  fallback: number
): number;

export declare const HARNESS_ACTIONS: readonly string[];

export declare function harnessEnv(options: {
  action: string;
  label?: string;
  timeoutS?: number;
}): Record<string, string>;
