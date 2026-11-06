const { chromium } = require("playwright"); const fs = require("fs");
(async () => { const b = await chromium.launch(); const p = await b.newPage();
const html = fs.readFileSync(require("path").resolve(__dirname, "..", "..", "index.html"), "utf8");
const get = (k) => html.match(new RegExp(k + ': "([A-Za-z0-9+/=]+)"'))[1];
for (const k of ["buzzKetchup", "buzzMayo"]) {
  const r = await p.evaluate(async (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const buf = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(u.buffer); return buf.duration.toFixed(2) + "s"; }, get(k));
  console.log(k, "decoded", r); }
await b.close(); })();
