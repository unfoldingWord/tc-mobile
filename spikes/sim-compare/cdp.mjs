// Evaluate JS in the app's Android WebView over CDP. Usage:
//   node cdp.mjs <serial> <pkg> '<expression>' [timeoutMs]
// Awaits promises and prints the JSON value. Never touches any other device.
import { execFileSync } from "node:child_process";
const [serial, pkg, expr, timeout = "600000"] = process.argv.slice(2);
if (!serial?.startsWith("emulator-")) throw new Error("emulators only");
const adb = (...a) =>
  execFileSync("adb", ["-s", serial, ...a], { encoding: "utf8" }).trim();
let pid = "";
try {
  pid = adb("shell", "pidof", pkg);
} catch {}
if (!pid) {
  console.log(JSON.stringify({ dead: true }));
  process.exit(3);
}
const port = 9300 + Number(serial.split("-")[1]) % 100;
adb("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
const timer = setTimeout(() => {
  console.log(JSON.stringify({ timeout: true }));
  process.exit(4);
}, Number(timeout));
ws.onclose = () => {
  console.log(JSON.stringify({ disconnected: true }));
  process.exit(5);
};
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id !== 1) return;
  clearTimeout(timer);
  ws.onclose = null;
  const r = d.result;
  if (r?.exceptionDetails)
    console.log(
      JSON.stringify({
        exception:
          r.exceptionDetails.exception?.description ??
          r.exceptionDetails.text,
      })
    );
  else console.log(JSON.stringify(r?.result?.value ?? d));
  ws.close();
  process.exit(0);
};
ws.send(
  JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression: expr, awaitPromise: true, returnByValue: true },
  })
);
