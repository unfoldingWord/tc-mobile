import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { installedVersion } from "../scripts/licence-versions.mjs";
import { licenceNoticeVersionsPlugin } from "../vite.config.ts";

/**
 * The licence-notice middleware wired into a real Vite dev server whose `base`
 * is not `/` (#1415). `tests/licence-versions.test.ts` pins `noticeNameForUrl`
 * on its own; this pins that the plugin's `configureServer` hands it the
 * server's base. The server carries this one plugin only, listens on a free
 * loopback port, runs no file watcher, HMR socket or dependency scan, and is
 * closed after the suite.
 */

const root = path.resolve(import.meta.dirname, "..");
const BASE = "/sub/";
const NOTICE = "THIRD-PARTY-NOTICES.txt";

let server: ViteDevServer;
let origin = "";

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root,
    base: BASE,
    logLevel: "silent",
    plugins: [licenceNoticeVersionsPlugin()],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: "127.0.0.1", port: 0, ws: false, watch: null },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address() as AddressInfo | null;
    if (!address?.port) throw new Error("dev server reported no port");
    origin = `http://127.0.0.1:${address.port}`;
  } catch (cause) {
    await server.close();
    throw cause;
  }
});

afterAll(async () => {
  await server?.close();
});

describe("licence notices from the dev server under base /sub/ (#1415)", () => {
  it("the source notice asks for versions, so a raw copy would be visible", () => {
    const source = readFileSync(
      path.join(root, "public", "licenses", NOTICE),
      "utf8"
    );
    expect(source).toContain("{{version:react}}");
  });

  it("serves the notice under the base with every version filled", async () => {
    const res = await fetch(`${origin}${BASE}licenses/${NOTICE}?t=1`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("{{version:");
    const react = installedVersion(root, "react");
    expect(react).toBeTruthy();
    expect(body).toContain(String(react));
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("does not serve the notice at a path outside the base", async () => {
    const res = await fetch(`${origin}/licenses/${NOTICE}`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("{{version:");
  });
});
