// Loopback-only command channel for the iOS Capacitor harness (#1921).
// The page polls GET /next; `curl /cmd -d <js>` queues JS and waits for the result.
import http from "node:http";
const q = []; const wait = new Map(); let n = 0;
http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    if (req.url === "/next") { const c = q.shift(); if (!c) { res.statusCode = 204; return res.end(); } return res.end(JSON.stringify(c)); }
    if (req.url === "/result") { const { id, out } = JSON.parse(b); wait.get(id)?.end(JSON.stringify(out ?? null) + "\n"); wait.delete(id); return res.end(); }
    if (req.url === "/cmd") { const id = ++n; q.push({ id, code: b }); wait.set(id, res); return; }
    res.statusCode = 404; res.end();
  });
}).listen(8921, "127.0.0.1");
