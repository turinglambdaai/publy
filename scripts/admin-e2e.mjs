// Admin console E2E: drive the REAL admin page in a real browser via CDP —
// login, verify tables, exercise the WeChat credential check, screenshots.
//
//   node scripts/admin-e2e.mjs [admin-url] [admin-key]

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const adminUrl = process.argv[2] ?? "http://127.0.0.1:18081/admin";
const adminKey = process.argv[3] ?? JSON.parse(fs.readFileSync(path.join(os.homedir(), ".publy", "config.json"), "utf8")).api_key;
const DEBUG_PORT = 18463;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const exe = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((c) => fs.existsSync(c));
if (!exe) throw new Error("Edge not found");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "publy-edge-"));
const child = spawn(exe, [
  "--remote-debugging-port=" + DEBUG_PORT,
  "--user-data-dir=" + profile,
  "--no-first-run",
  "--window-size=1280,1000",
  adminUrl,
], { detached: true, stdio: "ignore" });
child.unref();

let target = null;
for (let i = 0; i < 20 && !target; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    target = list.find((t) => t.type === "page" && t.url.includes("/admin"));
  } catch { /* retry */ }
}
if (!target) throw new Error("admin page target not found");
console.log("target ok:", target.url);

const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const consoleErrs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (m.params.type === "error") consoleErrs.push(text.slice(0, 250));
  }
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("ws failed")); });
function send(method, params) {
  return new Promise((res) => {
    const i = ++msgId;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
function evalJs(expression, awaitPromise = true, timeout = 15000) {
  return Promise.race([
    (async () => {
      const m = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
      return m.result?.result?.value;
    })(),
    (async () => { await sleep(timeout); throw new Error("evaluate timeout"); })(),
  ]);
}
async function screenshot(name) {
  const file = path.join(os.tmpdir(), "publy-admin-" + name + ".png");
  fs.rmSync(file, { force: true });
  const m = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(file, Buffer.from(m.result.data, "base64"));
  console.log("screenshot:", file);
}

await send("Runtime.enable");
await send("Page.enable");

// login
await evalJs(`document.getElementById("key").value = ${JSON.stringify(adminKey)}; load();`, false, 8000);
await sleep(2500);
const diag = await evalJs(`JSON.stringify({
  panel: document.getElementById("panel")?.style.display ?? null,
  userRows: document.querySelectorAll("#tbl tbody tr").length,
  pendingRows: document.querySelectorAll("#ordtbl tbody tr").length
})`);
console.log("after login:", diag);
await screenshot("1-console");

// exercise verify-wechat with deliberately wrong secret → human-readable error
await evalJs(`document.getElementById("acc-appid").value = "wxd1020bf54f0994e4";
document.getElementById("acc-secret").value = "deliberately-wrong-secret";
verifyAcc();`, false, 8000);
await sleep(6000); // real WeChat API call from the server
const accOut = await evalJs(`document.getElementById("acc-out").textContent`);
console.log("verify-wechat:", accOut);

await screenshot("2-verify");
console.log("--- console errors ---");
console.log(consoleErrs.slice(-5).join("\n") || "(none)");
ws.close();
child.unref();
process.exit(0);
