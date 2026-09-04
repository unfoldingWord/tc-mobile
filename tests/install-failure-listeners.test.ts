import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";

/**
 * The two `window` listeners the entry installs, and only the filtering they do.
 *
 * The module registers its listeners as an import-time side effect on `window`,
 * which the Node test environment has no equivalent of. A minimal `window` stub
 * installed BEFORE the dynamic import captures the two handlers, so the real
 * wiring — event field to sink `context` — is exercised, not a re-implementation.
 * `reportFailure` itself is covered in tests/report-failure.ts; what is asserted
 * here is what reaches it: a benign ResizeObserver notice is dropped, a real
 * uncaught error is not.
 */
type WindowHandler = (event: {
  error?: unknown;
  message?: string;
  reason?: unknown;
}) => void;

const handlers: Record<string, WindowHandler> = {};

/**
 * Invoke a registered handler, failing loudly if the import did not register it.
 * The guard also narrows the indexed lookup for `noUncheckedIndexedAccess`, so
 * the call needs no non-null assertion.
 */
const fire = (
  type: "error" | "unhandledrejection",
  event: Parameters<WindowHandler>[0]
): void => {
  const handler = handlers[type];
  if (!handler) throw new Error(`no ${type} handler was registered`);
  handler(event);
};

beforeAll(async () => {
  (globalThis as unknown as { window: unknown }).window = {
    addEventListener: (type: string, handler: WindowHandler) => {
      handlers[type] = handler;
    },
  };
  await import("@/app/install-failure-listeners");
});

describe("install-failure-listeners", () => {
  let seen: FailureReport[];
  let off: () => void;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    seen = [];
    off = subscribeToFailures((report) => seen.push(report));
  });

  afterEach(() => {
    off();
    vi.restoreAllMocks();
  });

  it("registered both window handlers on import", () => {
    expect(typeof handlers.error).toBe("function");
    expect(typeof handlers.unhandledrejection).toBe("function");
  });

  it("drops Chromium's ResizeObserver loop notice — either wording", () => {
    // No `event.error`: the cause would be the string message, which the sink's
    // identity dedup cannot collapse, so an unfiltered resize burst spams it.
    fire("error", {
      error: null,
      message: "ResizeObserver loop completed with undelivered notifications.",
    });
    fire("error", {
      error: null,
      message: "ResizeObserver loop limit exceeded",
    });

    expect(seen).toEqual([]);
  });

  it("forwards a real uncaught error to the sink", () => {
    const cause = new Error("real render-adjacent throw");
    fire("error", {
      error: cause,
      message: "Error: real render-adjacent throw",
    });

    expect(seen).toEqual([{ context: "uncaught-error", cause }]);
  });

  it("forwards an unhandled rejection's reason to the sink", () => {
    const reason = new Error("nothing awaited this");
    fire("unhandledrejection", { reason });

    expect(seen).toEqual([{ context: "unhandled-rejection", cause: reason }]);
  });
});
