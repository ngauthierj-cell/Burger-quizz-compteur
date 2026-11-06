const { chromium } = require("playwright"); const path = require("path"), fs = require("fs"), http = require("http");
const ROOT = path.resolve(__dirname, "..", "..");
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split("?")[0]); if (u === "/") u = "/index.html";
  if (u === "/config.js") { res.setHeader("content-type", "text/javascript"); return res.end(process.env.NOCONF ? "// rien" : 'window.MIAMS_CONFIG={supabaseUrl:"https://unreachable.invalid",supabaseAnonKey:"anon-key-for-tests-0123456789"};'); }
  const f = path.join(ROOT, u); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : "text/html"); fs.createReadStream(f).pipe(res);
}).listen(8766);
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ serviceWorkers: "block" })).newPage(); p.on("pageerror", e => errs.push(e.message));
  await p.goto("http://localhost:8766/"); await p.click("#roleHost"); await p.click("#buzzersBtn"); await p.click("#buzzStart");
  await p.waitForFunction(() => document.querySelector("#buzzNote").classList.contains("err"), null, { timeout: 20000 });
  console.log("host note:", await p.textContent("#buzzNote"));
  if (!process.env.NOCONF) {
    const r = await p.evaluate(() => new Promise(res => {
      const c = window.supabase.createClient("https://unreachable.invalid", "anon-key-for-tests-0123456789", { auth: { persistSession: false } });
      const seen = [];
      const ch = c.channel("x").on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: "code=eq.ABCD" }, () => {}).subscribe(s => { seen.push(s); if (seen.length >= 1) res(seen.join(",")); });
      setTimeout(() => res("timeout:" + seen.join(",")), 15000);
    }));
    console.log("real channel status:", r);
  }
  const q = await (await b.newContext({ serviceWorkers: "block" })).newPage(); q.on("pageerror", e => errs.push(e.message));
  await q.goto("http://localhost:8766/?salle=ABCD"); await q.click('[data-join="mayo"]');
  await q.waitForFunction(() => !/Connexion/.test(document.querySelector("#bzJoinMsg").textContent), null, { timeout: 20000 });
  console.log("buzzer msg:", await q.textContent("#bzJoinMsg"));
  console.log("errors:", errs.length ? errs : "none");
  await b.close(); server.close();
})();
