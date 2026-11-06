const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, "..", "..");
const FAKE = fs.readFileSync(path.join(__dirname, "fake-supabase.js"), "utf8");
const SHOTS = process.argv[2];
let rooms = {}, seats = {}, down = false, refuse = false, buzzDown = false, pages = [], seq = 0;
const now = () => new Date(Date.now() + (seq++)).toISOString();
async function broadcast(row) { for (const p of pages) await p.evaluate((r) => window.__push && window.__push(r), row).catch(() => {}); }
async function fake(src, kind, a, b) {
  if (down) throw new Error("network");
  if (kind === "rpc" && a === "buzz" && refuse) throw new Error("CODE:PGRST202");
  if (kind === "rpc" && a === "buzz" && buzzDown) { buzzDown = false; down = true; setTimeout(() => { down = false; }, 1500); throw new Error("network"); }
  if (kind === "sub") return true;
  if (kind === "get") { const r = rooms[a]; return r && Date.parse(r.expires_at) > Date.now() ? r : null; }
  const name = a, args = b || {}; const r = rooms[(args.p_code || "").toUpperCase()];
  const host = r && !r.closed && args.p_token === r.token;
  const pub = (x) => { const c = Object.assign({}, x); delete c.token; return c; };
  let res;
  if (name === "claim_seats") {
    if (!r || r.closed) return "no_room";
    const key = (t) => r.code + ":" + t;
    if (args.p_teams.some((t) => seats[key(t)] && seats[key(t)] !== args.p_device)) return "taken";
    args.p_teams.forEach((t) => { seats[key(t)] = args.p_device; }); return "ok";
  }
  if (name === "host_seats" && process.env.NOSEATS) throw new Error("CODE:PGRST202");
  if (name === "host_seats") { if (!host) return null; return { ketchup: !!seats[r.code + ":ketchup"], mayo: !!seats[r.code + ":mayo"] }; }
  if (name === "release_seats") { Object.keys(seats).forEach((k) => { if (seats[k] === args.p_device) delete seats[k]; }); return true; }
  if (name === "create_room") { const code = "QRST"; seats = {}; rooms[code] = { code, token: "tok", buzzers_enabled: true, buzzed_team: null, question: 0, recap: {}, closed: false, updated_at: now(), expires_at: new Date(Date.now() + 12 * 3600e3).toISOString() }; return [{ code, host_token: "tok", expires_at: rooms[code].expires_at }]; }
  if (name === "buzz") { if (r && seats[r.code + ":" + args.p_team] === args.p_device && !r.buzzed_team && r.buzzers_enabled && !r.closed && (args.p_question == null || args.p_question === r.question)) { r.buzzed_team = args.p_team; r.updated_at = now(); res = true; } else return false; }
  else if (!host) return false;
  else if (name === "host_unlock") { r.buzzed_team = null; r.question++; r.updated_at = now(); res = true; }
  else if (name === "host_set_enabled") { r.buzzers_enabled = args.p_enabled; r.buzzed_team = null; r.question++; r.updated_at = now(); res = true; }
  else if (name === "host_publish") { r.recap = args.p_recap; r.updated_at = now(); res = true; }
  else if (name === "host_close") { r.closed = true; r.buzzers_enabled = false; r.updated_at = now(); res = true; }
  setTimeout(() => broadcast(pub(r)), 30);
  return res;
}
(async () => {
  const http = require("http");
  const server = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split("?")[0]); if (u === "/") u = "/index.html";
    if (u === "/config.js") { res.setHeader("content-type", "text/javascript"); return res.end(process.env.NOCONF ? "" : 'window.MIAMS_CONFIG={supabaseUrl:"https://fake.supabase.co",supabaseAnonKey:"anon-key-for-tests-0123456789"};'); }
    if (u === "/vendor/supabase.js") { res.setHeader("content-type", "text/javascript"); return res.end(FAKE); }
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    res.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : "application/octet-stream");
    fs.createReadStream(f).pipe(res);
  }).listen(8765);
  const browser = await chromium.launch();
  const errors = [];
  async function newPage(vp) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: true, serviceWorkers: "block" });
    await ctx.exposeBinding("__fake", fake);
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
    await p.addInitScript(() => { window.__sounds = []; const iv = setInterval(() => { if (window.Miams) { const o = window.Miams.buzzSound; window.Miams.buzzSound = (t) => { window.__sounds.push(t); o(t); }; clearInterval(iv); } }, 1); });
    pages.push(p); return p;
  }
  const check = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) process.exitCode = 1; };
  const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, n + ".png") });

  const host = await newPage({ width: 900, height: 700 });
  await host.goto("http://localhost:8765/");
  check(await host.isVisible("#roleScreen"), "role screen on launch");
  await shot(host, "01-role");
  await host.click("#roleHost");
  check(!(await host.isVisible("#roleScreen")), "host: role screen closed");
  await host.click('.team.ketchup [data-delta="2"]');
  check((await host.textContent("#score-ketchup")) === "2", "host: local scoring unchanged");
  await host.click("#buzzersBtn"); await host.click("#buzzStart");
  await host.waitForSelector("#buzzOn:not([hidden])");
  await host.waitForFunction(() => document.querySelector("#buzzNet").dataset.net === "online");
  check((await host.getAttribute("#buzzCode", "aria-label")) === "QRST", "host: room code shown");
  check(await host.$("#buzzQr svg") !== null, "host: QR code drawn");
  await host.waitForTimeout(500);
  check(rooms.QRST.recap.scores && rooms.QRST.recap.scores.ketchup === 2, "host: recap published");
  check(await host.isVisible("#buzzSeats") && /attente/.test(await host.textContent("#seatK")), "panel: team pills shown (waiting)");
  check(await host.isVisible("#buzzQr") && !(await host.isVisible("#buzzUnfold")), "panel: QR shown while teams missing");
  check((await host.textContent("#buzzAction")) === "Mettre en pause", "panel: no useless unlock button, action = pause");
  check((await host.textContent("#buzzBarTxt")) === "En attente" && (await host.textContent("#buzzBarBtn")) === "QR", "strip: waiting for teams + QR button");
  if (SHOTS) await (await host.$("#buzzBar")).screenshot({ path: path.join(SHOTS, "bar-wait.png") });
  await shot(host, "02-host-panel");
  await host.click("#buzzClose");

  const k1 = await newPage({ width: 390, height: 780 }), k2 = await newPage({ width: 390, height: 780 }), m1 = await newPage({ width: 390, height: 780 });
  for (const [p, t] of [[k1, "ketchup"], [m1, "mayo"]]) {
    await p.goto("http://localhost:8765/?salle=qrst");
    check(await p.isVisible("#bzJoin") && (await p.inputValue("#bzCode")) === "QRST", t + ": QR link opens join with code");
    await p.click(`[data-join="${t}"]`);
    await p.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "ready");
  }
  await k2.goto("http://localhost:8765/?salle=qrst"); await k2.click('[data-join="ketchup"]');
  await k2.waitForFunction(() => /déjà un buzzer/.test(document.querySelector("#bzJoinMsg").textContent));
  check(await k2.isVisible("#bzJoin"), "2nd ketchup device refused (one device per team)");
  await shot(k2, "03b-team-taken");
  await k1.click("#bzQuit"); await new Promise((r) => setTimeout(r, 300));
  await k2.click('[data-join="ketchup"]');
  await k2.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "ready");
  check(true, "Quitter frees the seat: another device can take Ketchup");
  await k2.click("#bzQuit"); await new Promise((r) => setTimeout(r, 300));
  await k1.click('[data-join="ketchup"]');
  await k1.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "ready");
  await host.waitForFunction(() => document.querySelector("#seatK").classList.contains("on") && document.querySelector("#seatM").classList.contains("on"), null, { timeout: 12000 });
  check(/Buzzers prêts/.test(await host.textContent("#buzzBarTxt")) && (await host.textContent("#buzzBarBtn")) === "Pause", "strip: both teams connected, ready + Pause");
  if (SHOTS) await (await host.$("#buzzBar")).screenshot({ path: path.join(SHOTS, "bar-ready.png") });
  await host.click("#buzzersBtn"); await host.waitForTimeout(400);
  check(await host.isVisible("#buzzUnfold") && !(await host.isVisible("#buzzQr")), "panel: QR folded once both teams connected");
  await shot(host, "02b-host-panel-folded");
  await host.click("#buzzUnfold");
  check(await host.isVisible("#buzzQr"), "panel: QR can be unfolded");
  await host.click("#buzzClose");
  await shot(host, "02c-host-strip");
  await shot(k1, "03-buzzer-ready");
  await m1.dispatchEvent("#bzButton", "pointerdown");
  await m1.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "mine");
  await k1.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "late");
  check(true, "mayo buzz: mayo 'À vous', ketchup phones 'Trop tard'");
  await k1.dispatchEvent("#bzButton", "pointerdown");
  check(rooms.QRST.buzzed_team === "mayo", "locked: late ketchup press ignored");
  await host.waitForSelector("#buzzHit:not([hidden])");
  check((await host.textContent("#hitTeam")) === "Mayo", "host: big 'Mayo a la main'");
  const snd = async (p) => (await p.evaluate(() => window.__sounds.join(",")));
  check(await snd(host) === "" && await snd(m1) === "mayo" && await snd(k1) === "", "sound only on the phone that buzzed, not on presenter");
  await shot(host, "04-host-hit"); await shot(m1, "05-buzzer-mine"); await shot(k1, "06-buzzer-late");
  check(/Mayo a la main/.test(await host.textContent("#buzzBarTxt")) && (await host.textContent("#buzzBarBtn")) === "Débloquer", "strip: hand shown with Débloquer");
  if (SHOTS) await (await host.$("#buzzBar")).screenshot({ path: path.join(SHOTS, "bar-hand.png") });
  await host.keyboard.press("Escape");
  await host.click("#buzzersBtn"); await host.waitForTimeout(400);
  check((await host.textContent("#buzzAction")) === "Débloquer les buzzers", "panel: action = Débloquer when a team has the hand");
  await shot(host, "02d-host-panel-hand");
  await host.click("#buzzAction");
  await host.click("#buzzClose");
  await k1.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "ready");
  check(!(await host.isVisible("#buzzHit")), "unlock: buzzers ready again");
  // regression: a buzz lost to the network must not leave the phone stuck "offline"
  buzzDown = true;
  await k1.dispatchEvent("#bzButton", "pointerdown");
  await k1.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "offline");
  await k1.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "ready" && document.querySelector("#bzNet").dataset.net === "online", null, { timeout: 15000 });
  check(true, "buzz lost to network: back online and ready after reconnect");
  // server refusal: clear message, not "offline"
  refuse = true;
  await k1.dispatchEvent("#bzButton", "pointerdown");
  await k1.waitForFunction(() => /refusé/.test(document.querySelector("#bzState").textContent));
  check((await k1.getAttribute("#bzPlay", "data-state")) === "ready", "server refusal: message shown, not stuck offline");
  refuse = false;
  // reload with rejoin hint (as after an app update): back in the same room/team
  await k1.evaluate(() => sessionStorage.setItem("compteur-miams-rejoindre", JSON.stringify({ code: "QRST", team: "ketchup" })));
  await k1.reload();
  await k1.waitForFunction(() => document.querySelector("#bzPlay") && document.querySelector("#bzPlay").dataset.state === "ready");
  check(/QRST/.test(await k1.textContent("#bzRoom")) && /Ketchup/.test(await k1.textContent("#bzRoom")), "after update reload: phone rejoins same room and team");
  await k1.evaluate(() => { const iv = setInterval(() => { if (window.Miams) { const o = window.Miams.buzzSound; window.Miams.buzzSound = (t) => { window.__sounds.push(t); o(t); }; clearInterval(iv); } }, 1); });
  // pause
  await host.click("#buzzBarBtn");
  await k1.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "paused");
  await host.waitForFunction(() => document.querySelector("#buzzBarBtn").textContent === "Reprendre");
  check(true, "pause from strip shown on buzzers; strip offers Reprendre");
  if (SHOTS) await (await host.$("#buzzBar")).screenshot({ path: path.join(SHOTS, "bar-pause.png") }); await host.click("#buzzBarBtn");
  await k1.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "ready");
  // recap tab
  await host.click('.team.mayo [data-delta="3"]'); await host.waitForTimeout(600);
  await k1.click("#bzTabRecap");
  await k1.waitForFunction(() => /Mayo/.test(document.querySelector("#bzRecap").textContent));
  const rec = await k1.textContent("#bzRecap");
  check(/Objectif/.test(rec) && /Nuggets/.test(rec), "recap tab shows round, goal, table");
  check((await k1.$$("#bzRecap input, #bzRecap [data-delta]")).length === 0, "recap is read-only");
  await shot(k1, "07-buzzer-recap"); await k1.click("#bzTabBuzz");
  // outage
  down = true; for (const p of pages) await p.evaluate(() => window.__fail && window.__fail());
  await host.waitForFunction(() => document.querySelector("#buzzBar").classList.contains("off"));
  if (SHOTS) await (await host.$("#buzzBar")).screenshot({ path: path.join(SHOTS, "bar-off.png") });
  await host.click('.team.ketchup [data-delta="1"]');
  check((await host.textContent("#score-ketchup")) === "3", "outage: host keeps scoring locally");
  await k1.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "offline");
  check(true, "outage: buzzer shows offline"); await shot(host, "08-host-offline"); await shot(k1, "09-buzzer-offline");
  down = false;
  await k1.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "ready", null, { timeout: 15000 });
  await host.waitForFunction(() => !document.querySelector("#buzzBar").classList.contains("off"), null, { timeout: 15000 });
  await host.waitForTimeout(800);
  check(rooms.QRST.recap.scores.ketchup === 3, "reconnect: pending recap republished");
  // reload host keeps room
  await host.reload(); await host.click("#roleHost");
  if (await host.isVisible("#welcome")) await host.click("#welcomeGo");
  await host.waitForFunction(() => document.querySelector("#buzzersBtn").classList.contains("on"));
  check(true, "host reload: room restored");
  // close
  await host.click("#buzzersBtn"); await host.click("#buzzStop");
  await k1.waitForSelector("#bzJoin:not([hidden])");
  check(/fermée/.test(await k1.textContent("#bzJoinMsg")), "close: buzzers told the room is closed");
  // shared screen
  check(await host.isVisible("#buzzStart"), "close: panel back to off view");
  check(await host.$("#sharedStart") === null, "presenter panel has no shared screen anymore");
  await host.click("#buzzClose");
  // shared screen, offline (no code)
  const ph = await newPage({ width: 390, height: 780 });
  await ph.goto("http://localhost:8765/"); await ph.click("#roleBuzzer");
  await ph.fill("#bzCode", ""); await ph.click("#bzShared");
  check(await ph.isVisible("#shared") && await ph.isVisible("#sharedUnlock"), "players: shared screen offline with unlock");
  await ph.dispatchEvent(".shared-half.m", "pointerdown"); await ph.dispatchEvent(".shared-half.k", "pointerdown");
  check((await ph.getAttribute("#shared", "data-hand")) === "mayo", "shared offline: first touch wins, then locked");
  await shot(ph, "10-shared-offline");
  await ph.click("#sharedUnlock");
  check((await ph.getAttribute("#shared", "data-hand")) === null, "shared offline: unlock");
  await ph.click("#sharedQuit");
  // shared screen, connected to a room
  await host.click("#buzzersBtn"); await host.click("#buzzStart");
  await host.waitForFunction(() => document.querySelector("#buzzNet").dataset.net === "online"); await host.click("#buzzClose");
  await ph.fill("#bzCode", "qrst"); await ph.click("#bzShared");
  await ph.waitForFunction(() => document.querySelector("#sharedNet").dataset.net === "online");
  check(!(await ph.isVisible("#sharedUnlock")) && (await ph.textContent("#sharedCode")) === "QRST", "shared online: no local unlock, room shown");
  const solo = await newPage({ width: 390, height: 780 });
  await solo.goto("http://localhost:8765/?salle=QRST"); await solo.click('[data-join="mayo"]');
  await solo.waitForFunction(() => /écran partagé|déjà un buzzer/.test(document.querySelector("#bzJoinMsg").textContent));
  check(await solo.isVisible("#bzJoin"), "shared screen holds both seats: extra phone refused");
  await ph.dispatchEvent(".shared-half.k", "pointerdown");
  await ph.waitForFunction(() => document.querySelector("#shared").dataset.hand === "ketchup");
  await host.waitForSelector("#buzzHit:not([hidden])");
  check((await host.textContent("#hitTeam")) === "Ketchup", "shared online: ketchup half wins, presenter sees it");
  await ph.dispatchEvent(".shared-half.m", "pointerdown");
  check(rooms.QRST.buzzed_team === "ketchup", "shared online: locked after first buzz");
  check(await snd(ph) === "mayo,ketchup" && await snd(host) === "", "shared: sound on shared phone only (offline + online)");
  await shot(ph, "11-shared-online");
  await host.click("#hitUnlock");
  await ph.waitForFunction(() => !document.querySelector("#shared").hasAttribute("data-hand"));
  check(true, "shared online: presenter unlock resets shared screen");
  await host.waitForFunction(() => document.querySelector("#buzzBarBtn").textContent === "Pause", null, { timeout: 12000 });
  check(true, "shared screen counts as both teams connected");
  await host.click("#buzzBarBtn");
  await ph.waitForFunction(() => document.querySelector("#shared").hasAttribute("data-off"));
  check(/pause/.test(await ph.textContent("#sharedMsgK")), "shared online: pause shown");
  await host.click("#buzzersBtn"); await host.waitForTimeout(400);
  await host.click("#buzzStop");
  await ph.waitForSelector("#shared", { state: "hidden" });
  check(/fermée/.test(await ph.textContent("#bzJoinMsg")), "shared online: room closed -> back to join");
  // nouvelle partie : la salle se ferme, les buzzers sont renvoyés à l'écran « Rejoindre »
  await host.click("#buzzStart");
  await host.waitForFunction(() => document.querySelector("#buzzNet").dataset.net === "online"); await host.click("#buzzClose"); await host.waitForTimeout(400);
  await k1.fill("#bzCode", "qrst"); await k1.click('[data-join="ketchup"]');
  await k1.waitForFunction(() => document.querySelector("#bzPlay").dataset.state === "ready");
  await host.waitForTimeout(400);
  await host.click("#newGame"); await host.waitForTimeout(300); await host.click("#confirmYes");
  await k1.waitForSelector("#bzJoin:not([hidden])");
  check(/fermée/.test(await k1.textContent("#bzJoinMsg")), "new game: buzzer phones disconnected");
  check(rooms.QRST.closed === true && !(await host.isVisible("#buzzBar")), "new game: room closed, strip gone, buzzer mode off");
  await host.click("#buzzersBtn"); await host.waitForTimeout(400);
  check(await host.isVisible("#buzzStart"), "new game: presenter can open a new room when he wants");
  // appli fermée plus de 10 min, partie pas commencée : la salle est fermée
  const age = () => host.evaluate(() => { const r = JSON.parse(localStorage.getItem("compteur-miams-salle")); r.seenAt = Date.now() - 11 * 60 * 1000; localStorage.setItem("compteur-miams-salle", JSON.stringify(r)); });
  await host.click("#buzzStart");
  await host.waitForFunction(() => document.querySelector("#buzzNet").dataset.net === "online"); await host.click("#buzzClose"); await host.waitForTimeout(400);
  await host.reload(); await age(); await host.click("#roleHost"); await host.waitForTimeout(800);
  check(!(await host.isVisible("#buzzBar")) && rooms.QRST.closed === true, "idle > 10 min, game not started: room closed on relaunch");
  // même chose avec une partie en cours : la salle est gardée
  await host.click("#buzzersBtn"); await host.waitForTimeout(400); await host.click("#buzzStart");
  await host.waitForFunction(() => document.querySelector("#buzzNet").dataset.net === "online"); await host.click("#buzzClose"); await host.waitForTimeout(400);
  await host.click('.team.ketchup [data-delta="1"]'); await host.waitForTimeout(400);
  await host.reload(); await age(); await host.click("#roleHost");
  if (await host.isVisible("#welcome")) await host.click("#welcomeGo");
  await host.waitForFunction(() => !document.querySelector("#buzzBar").hidden, null, { timeout: 8000 });
  check(rooms.QRST.closed === false, "idle > 10 min, game in progress: room kept");
  // court passage hors de l'appli, partie pas commencée : salle gardée
  await host.click("#newGame"); await host.waitForTimeout(300); await host.click("#confirmYes"); await host.waitForTimeout(300);
  await host.click("#buzzersBtn"); await host.waitForTimeout(400); await host.click("#buzzStart");
  await host.waitForFunction(() => document.querySelector("#buzzNet").dataset.net === "online"); await host.click("#buzzClose"); await host.waitForTimeout(400);
  await host.reload(); await host.click("#roleHost");
  await host.waitForFunction(() => !document.querySelector("#buzzBar").hidden, null, { timeout: 8000 });
  check(rooms.QRST.closed === false, "short absence, game not started: room kept");
  check(errors.length === 0, "no page errors " + errors.join(" | "));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
