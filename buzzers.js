// Mode « Buzzers » : facultatif, l'appli marche sans.
//  - Buzzers connectés (Supabase) : le présentateur crée une salle, les téléphones
//    des équipes la rejoignent avec un code. C'est le serveur qui décide du premier
//    buzz (fonction SQL « buzz », voir supabase/migrations).
//  - Buzzer écran partagé : sur l'appareil du présentateur, sans réseau.
// Le présentateur reste la seule source de vérité des scores : ils restent en
// local et sont seulement recopiés dans la salle pour le récap des joueurs.
(function () {
  "use strict";

  var M = window.Miams;
  if (!M) return;
  var $ = function (id) { return document.getElementById(id); };
  var TEAMS = M.teams;
  var CFG = window.MIAMS_CONFIG || {};
  var CONFIGURED = typeof CFG.supabaseUrl === "string" && /^https:\/\//.test(CFG.supabaseUrl) &&
    typeof CFG.supabaseAnonKey === "string" && CFG.supabaseAnonKey.length > 20;
  var HOST_KEY = "compteur-miams-salle";
  var BUZZER_KEY = "compteur-miams-buzzer";
  var TIMEOUT_MS = 8000;

  function readJson(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function writeJson(key, val) {
    try {
      if (val == null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* stockage indisponible : tant pis, on garde en mémoire */ }
  }
  function cleanCode(v) { return String(v || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4); }
  function int(v, min, max) {
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : Math.min(max, Math.max(min, n));
  }
  function team(v) { return v === "mayo" ? "mayo" : (v === "ketchup" ? "ketchup" : null); }
  function tiles(el, text, colors) {
    el.innerHTML = "";
    String(text).split("").forEach(function (ch, i) {
      var t = document.createElement("span");
      t.className = "tile " + colors[i % colors.length];
      t.textContent = ch;
      el.appendChild(t);
    });
    el.setAttribute("aria-label", text);
  }
  function setNet(el, net, text) {
    el.setAttribute("data-net", net);
    el.querySelector("span").textContent = text;
  }

  /* ================= Connexion à Supabase ================= */
  // La bibliothèque n'est chargée qu'au premier usage du mode buzzers connectés.
  var libPromise = null, client = null;
  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    if (!libPromise) {
      libPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "vendor/supabase.js";
        s.onload = function () { window.supabase ? resolve(window.supabase) : reject(new Error("lib")); };
        s.onerror = function () { libPromise = null; s.remove(); reject(new Error("lib")); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }
  function getClient() {
    if (!CONFIGURED) return Promise.reject(new Error("config"));
    return loadLib().then(function (lib) {
      if (!client) {
        client = lib.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
      }
      return client;
    });
  }
  function timeout(p) {
    return Promise.race([p, new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error("timeout")); }, TIMEOUT_MS);
    })]);
  }
  function rpc(name, args) {
    return getClient()
      .then(function (c) { return timeout(c.rpc(name, args || {})); })
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  // Erreur réseau (pas de réponse) ou refus du serveur (réponse avec un code) ?
  function isNetError(e) { return !(e && e.code); }
  var SERVER_REFUSED = "Le serveur a refusé. Fermez puis rouvrez l'appli pour la mettre à jour.";
  function fetchRoom(code) {
    return getClient()
      .then(function (c) { return timeout(c.from("rooms").select("*").eq("code", code).maybeSingle()); })
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  // Abonnement temps réel à une salle, avec reconnexion automatique.
  // onRow(row | null) : nouvel état de la salle (null = salle disparue)
  // onNet("online" | "offline")
  var linkSeq = 0;
  function RoomLink(code, onRow, onNet) {
    var channel = null, retry = 0, timer = null, stopped = false, net = "connecting";
    function setNetState(n) { if (n !== net) { net = n; onNet(n); } }
    function refresh() {
      return fetchRoom(code).then(function (row) {
        if (!stopped) onRow(row);
      }).catch(function () { if (!stopped) { setNetState("offline"); schedule(); } });
    }
    function schedule() {
      if (stopped || timer) return;
      var delay = Math.min(30000, 1000 * Math.pow(2, retry)) + Math.random() * 500;
      retry = Math.min(retry + 1, 5);
      timer = setTimeout(function () { timer = null; connect(); }, delay);
    }
    function connect() {
      if (stopped) return;
      clearTimeout(timer); timer = null;
      getClient().then(function (c) {
        if (stopped) return;
        if (channel) { var old = channel; channel = null; c.removeChannel(old); }
        var ch = c.channel("salle-" + code + "-" + (++linkSeq));
        channel = ch;
        ch.on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: "code=eq." + code }, function (p) {
          if (stopped || ch !== channel) return;
          if (p.eventType === "DELETE") onRow(null);
          else onRow(p.new);
        }).subscribe(function (status) {
          if (stopped || ch !== channel) return;
          if (status === "SUBSCRIBED") {
            retry = 0;
            setNetState("online");
            refresh(); // rattrape ce qui a pu changer pendant la coupure
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setNetState("offline");
            schedule();
          }
        });
      }).catch(function () { setNetState("offline"); schedule(); });
    }
    function kick() { if (!stopped) { retry = 0; connect(); } }
    // Une requête a échoué faute de réseau : on passe hors ligne et on se
    // reconnecte. L'état repasse « en ligne » tout seul à la reconnexion.
    function lost() { if (!stopped) { setNetState("offline"); kick(); } }
    function onOnline() { kick(); }
    function onVisible() {
      if (document.visibilityState !== "visible" || stopped) return;
      if (net === "online") refresh(); else kick();
    }
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    connect();
    return {
      refresh: refresh,
      kick: kick,
      lost: lost,
      net: function () { return net; },
      stop: function () {
        stopped = true;
        clearTimeout(timer);
        window.removeEventListener("online", onOnline);
        document.removeEventListener("visibilitychange", onVisible);
        if (channel && client) { var old = channel; channel = null; client.removeChannel(old); }
      }
    };
  }

  /* ================= Présentateur ================= */
  var host = { room: null, row: null, link: null, net: "off", lastHit: "", published: "", dirty: false, timer: null, expiry: null };
  var els = {
    btn: $("buzzersBtn"), overlay: $("buzzOverlay"), off: $("buzzOff"), on: $("buzzOn"), note: $("buzzNote"),
    net: $("buzzNet"), code: $("buzzCode"), qr: $("buzzQr"), state: $("buzzState"),
    unlock: $("buzzUnlock"), toggle: $("buzzToggle"), start: $("buzzStart"),
    hit: $("buzzHit"), hitTeam: $("hitTeam"), banner: $("netBanner")
  };

  function note(text, isErr) {
    els.note.textContent = text || "";
    els.note.classList.toggle("err", !!isErr);
  }
  function joinUrl(code) {
    return location.origin + location.pathname + "?salle=" + code;
  }
  function timeText(ms) {
    var d = new Date(ms);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function renderHost() {
    var room = host.room, row = host.row;
    els.off.hidden = !!room;
    els.on.hidden = !room;
    els.btn.classList.toggle("on", !!room && host.net === "online");
    els.btn.classList.toggle("warn", !!room && host.net === "offline");
    var hand = room && row && team(row.buzzed_team);
    els.btn.classList.toggle("hand-ketchup", hand === "ketchup");
    els.btn.classList.toggle("hand-mayo", hand === "mayo");
    els.banner.hidden = !(room && host.net === "offline" && M.mode() === "host");
    if (!room) return;
    setNet(els.net, host.net === "online" ? "online" : (host.net === "offline" ? "offline" : "connecting"),
      host.net === "online" ? "Connecté" : (host.net === "offline" ? "Hors ligne · reconnexion…" : "Connexion…"));
    if (els.code.getAttribute("aria-label") !== room.code) {
      tiles(els.code, room.code, ["t-r", "t-j", "t-c", "t-b"]);
      els.qr.innerHTML = window.MiamsQR ? window.MiamsQR.svg(joinUrl(room.code), "#141210", "#fbf0d9") : "";
      els.qr.setAttribute("aria-label", "QR code pour rejoindre la salle " + room.code);
      els.qr.setAttribute("role", "img");
    }
    var enabled = !row || row.buzzers_enabled;
    var who = row && team(row.buzzed_team);
    els.state.className = "buzz-state" + (who ? (who === "ketchup" ? " k" : " m") : "");
    els.state.textContent = !row ? "" : (!enabled ? "Buzzers en pause" : (who ? TEAMS[who] + " a la main !" : "Buzzers prêts, en attente d'un buzz…"));
    els.toggle.textContent = enabled ? "Mettre en pause" : "Réactiver les buzzers";
    els.unlock.disabled = !who;
    if (!els.note.classList.contains("err")) note("Salle valable jusqu'à " + timeText(room.expiresAt) + ". Les joueurs scannent le QR code ou tapent le code.");
  }

  function showHit(t) {
    els.hit.className = "hit " + t;
    els.hitTeam.textContent = TEAMS[t];
    els.hit.hidden = false; // sans son : c'est le téléphone qui a buzzé qui sonne
  }
  function hideHit() { els.hit.hidden = true; }

  function onHostRow(row) {
    if (!host.room) return;
    if (!row || row.closed) { roomGone("La salle n'existe plus (expirée ou fermée). Vous pouvez en ouvrir une nouvelle."); return; }
    host.row = row;
    var who = team(row.buzzed_team);
    if (who) {
      var key = row.question + ":" + who;
      if (key !== host.lastHit) {
        host.lastHit = key;
        host.room.lastHit = key;
        writeJson(HOST_KEY, host.room);
        if (M.mode() === "host") showHit(who);
      }
    } else {
      hideHit();
    }
    renderHost();
  }
  function onHostNet(net) {
    host.net = net;
    if (net === "online" && host.dirty) publishNow();
    renderHost();
  }

  function connectHost() {
    if (host.link) host.link.stop();
    host.net = "connecting";
    host.link = RoomLink(host.room.code, onHostRow, onHostNet);
    clearTimeout(host.expiry);
    host.expiry = setTimeout(function () {
      roomGone("La salle a expiré (12 h). Vous pouvez en ouvrir une nouvelle.");
    }, Math.max(0, host.room.expiresAt - Date.now()));
    renderHost();
  }

  function activate() {
    note("");
    if (!CONFIGURED) {
      note("Les buzzers connectés ne sont pas configurés sur cette appli (voir le README). Les joueurs peuvent quand même utiliser l'écran partagé, sans réseau.", true);
      return;
    }
    els.start.disabled = true;
    note("Ouverture de la salle…");
    rpc("create_room").then(function (data) {
      var r = Array.isArray(data) ? data[0] : data;
      if (!r || !r.code || !r.host_token) throw new Error("salle");
      host.room = { code: r.code, token: r.host_token, expiresAt: Date.parse(r.expires_at) || Date.now() + 12 * 3600 * 1000, lastHit: "" };
      host.lastHit = "";
      host.published = "";
      writeJson(HOST_KEY, host.room);
      note("");
      connectHost();
      publishNow();
    }).catch(function () {
      note("Impossible de joindre le serveur des buzzers. Vérifiez la connexion et réessayez. Le compteur continue en local, et le buzzer écran partagé marche sans réseau.", true);
    }).then(function () { els.start.disabled = false; renderHost(); });
  }

  // Actions du présentateur : en cas d'échec réseau, on prévient sans rien bloquer
  function hostAction(name, args, done) {
    if (!host.room) return;
    var room = host.room;
    rpc(name, Object.assign({ p_code: room.code, p_token: room.token }, args || {})).then(function (ok) {
      if (host.room !== room) return;
      if (ok === false) { roomGone("La salle n'existe plus (expirée ou fermée). Vous pouvez en ouvrir une nouvelle."); return; }
      if (done) done();
      host.link.refresh();
    }).catch(function () {
      if (host.room !== room) return;
      M.toast("Pas de réseau");
      host.link.kick();
    });
  }
  function unlock() {
    hideHit();
    hostAction("host_unlock");
  }
  function toggleEnabled() {
    var enabled = !host.row || host.row.buzzers_enabled;
    hostAction("host_set_enabled", { p_enabled: !enabled }, function () {
      M.toast(enabled ? "Buzzers en pause" : "Buzzers actifs");
    });
  }
  function stopHost() {
    if (!host.room) return;
    var room = host.room;
    rpc("host_close", { p_code: room.code, p_token: room.token }).catch(function () { /* elle expirera d'elle-même */ });
    clearRoom();
    note("");
    renderHost();
    M.toast("Buzzers coupés");
  }
  function clearRoom() {
    if (host.link) host.link.stop();
    clearTimeout(host.expiry);
    clearTimeout(host.timer);
    host.link = null;
    host.room = null;
    host.row = null;
    host.net = "off";
    host.dirty = false;
    writeJson(HOST_KEY, null);
    hideHit();
  }
  function roomGone(msg) {
    if (!host.room) return;
    clearRoom();
    note(msg, true);
    renderHost();
    if (M.mode() === "host") openPanel();
  }

  // Récap publié dans la salle à chaque changement de la partie
  function schedulePublish() {
    if (!host.room) return;
    clearTimeout(host.timer);
    host.timer = setTimeout(publishNow, 300);
  }
  function publishNow() {
    if (!host.room) return;
    var snap = M.snapshot();
    var json = JSON.stringify(snap);
    if (json === host.published && !host.dirty) return;
    var room = host.room;
    rpc("host_publish", { p_code: room.code, p_token: room.token, p_recap: snap }).then(function (ok) {
      if (host.room !== room) return;
      if (ok === false) { roomGone("La salle n'existe plus (expirée ou fermée). Vous pouvez en ouvrir une nouvelle."); return; }
      host.published = json;
      host.dirty = false;
    }).catch(function () {
      if (host.room !== room) return;
      host.dirty = true; // renvoyé dès que la connexion revient
      host.link.kick();
    });
  }
  document.addEventListener("miams:save", schedulePublish);

  function panelOpen() { return els.overlay.classList.contains("open"); }
  function openPanel() {
    renderHost();
    els.overlay.classList.add("open");
    setTimeout(function () { (host.room ? els.unlock.disabled ? $("buzzClose") : els.unlock : els.start).focus(); }, 50);
  }
  function closePanel() {
    els.overlay.classList.remove("open");
    if (!els.note.classList.contains("err")) return;
    note("");
  }

  els.btn.addEventListener("click", openPanel);
  $("buzzClose").addEventListener("click", closePanel);
  els.overlay.addEventListener("click", function (e) { if (e.target === els.overlay) closePanel(); });
  els.start.addEventListener("click", activate);
  els.unlock.addEventListener("click", unlock);
  els.toggle.addEventListener("click", toggleEnabled);
  $("buzzStop").addEventListener("click", stopHost);
  $("hitUnlock").addEventListener("click", unlock);

  // Reprise d'une salle encore valide après un rechargement de la page
  function restoreHost() {
    if (host.room) return;
    var saved = readJson(HOST_KEY);
    if (!saved || !/^[A-Z]{4}$/.test(saved.code) || !saved.token || !(saved.expiresAt > Date.now()) || !CONFIGURED) {
      writeJson(HOST_KEY, null);
      return;
    }
    host.room = saved;
    host.lastHit = saved.lastHit || "";
    connectHost();
    publishNow();
  }

  /* ================= Une place par équipe =================
     Chaque appareil buzzer réserve la place de son équipe dans la salle (les
     deux pour l'écran partagé) et la confirme toutes les 20 s. Le serveur
     refuse un 2e appareil sur une même équipe ; une place non confirmée depuis
     60 s (téléphone éteint, parti) se libère toute seule. */
  function newId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* ignore */ }
    var b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  // Identifiant aléatoire de cet appareil (aucune donnée personnelle)
  var DEVICE = (function () {
    var KEY = "compteur-miams-appareil", id = null;
    try { id = window.localStorage.getItem(KEY); } catch (e) { /* ignore */ }
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      id = newId();
      try { window.localStorage.setItem(KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  })();
  var seat = { code: "", teams: null, timer: null };
  function claimSeats(code, teams) {
    return rpc("claim_seats", { p_code: code, p_teams: teams, p_device: DEVICE });
  }
  function takenText(teams) {
    return teams.length > 1
      ? "Une équipe a déjà un buzzer dans cette salle : l'écran partagé a besoin des deux places. Un seul appareil par équipe."
      : TEAMS[teams[0]] + " a déjà un buzzer dans cette salle. Un seul appareil par équipe ! (Si c'était votre téléphone, réessayez dans une minute.)";
  }
  function holdSeats(code, teams) {
    clearInterval(seat.timer);
    seat = { code: code, teams: teams, timer: setInterval(beat, 20000) };
  }
  function beat() {
    if (!seat.code) return;
    var code = seat.code, teams = seat.teams;
    claimSeats(code, teams).then(function (res) {
      if (seat.code !== code) return;
      if (res === "taken") lostSeats(teams); // un autre appareil a pris la place pendant une coupure
      // "no_room" : le temps réel s'occupe d'annoncer la fermeture
    }).catch(function () { /* hors ligne : on réessaiera */ });
  }
  function releaseSeats() {
    clearInterval(seat.timer);
    if (!seat.code) return;
    var code = seat.code;
    seat = { code: "", teams: null, timer: null };
    rpc("release_seats", { p_code: code, p_device: DEVICE }).catch(function () { /* elle expirera seule */ });
  }
  function lostSeats(teams) {
    clearInterval(seat.timer);
    seat = { code: "", teams: null, timer: null };
    closeShared();
    showJoin(takenText(teams), true);
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") beat(); });

  /* ================= Buzzer écran partagé (côté joueurs) =================
     Un seul téléphone posé entre les deux équipes, écran coupé en deux.
     - Avec le code d'une salle : chaque moitié buzze dans la salle, le serveur
       tranche et c'est le présentateur qui débloque.
     - Sans code : tout se passe sur ce téléphone, aucun réseau requis. */
  var sh = { el: $("shared"), code: "", row: null, link: null, net: "connecting", pending: false, hand: null };
  function sharedOnline() { return !!sh.code; }
  function sharedState() {
    if (!sharedOnline()) return sh.hand ? "hand" : "ready";
    var row = sh.row;
    if (!row) return "wait";
    if (sh.net === "offline") return "offline";
    if (!row.buzzers_enabled) return "paused";
    if (team(row.buzzed_team)) return "hand";
    return sh.pending ? "pending" : "ready";
  }
  var sharedNotice = { text: "", timer: null };
  function showSharedNotice(text) {
    clearTimeout(sharedNotice.timer);
    sharedNotice.text = text;
    sharedNotice.timer = setTimeout(function () { sharedNotice.text = ""; renderShared(); }, 6000);
  }
  function renderShared() {
    var st = sharedState();
    var hand = !sharedOnline() ? sh.hand : (sh.row && team(sh.row.buzzed_team));
    if (st === "hand" && hand) sh.el.setAttribute("data-hand", hand); else sh.el.removeAttribute("data-hand");
    if (st === "wait" || st === "offline" || st === "paused") sh.el.setAttribute("data-off", ""); else sh.el.removeAttribute("data-off");
    ["ketchup", "mayo"].forEach(function (t) {
      $(t === "ketchup" ? "sharedMsgK" : "sharedMsgM").textContent = {
        wait: "Connexion…",
        offline: "Hors ligne · reconnexion…",
        paused: "Buzzers en pause",
        pending: "…",
        ready: "Touchez pour buzzer",
        hand: hand === t ? "À vous !" : "Trop tard"
      }[st];
      if (sharedNotice.text && st === "ready") $(t === "ketchup" ? "sharedMsgK" : "sharedMsgM").textContent = sharedNotice.text;
    });
    $("sharedUnlock").hidden = sharedOnline(); // en salle, c'est le présentateur qui débloque
    $("sharedInfo").hidden = !sharedOnline();
    if (sharedOnline()) {
      $("sharedCode").textContent = sh.code;
      setNet($("sharedNet"), sh.net === "online" ? "online" : (sh.net === "offline" ? "offline" : "connecting"),
        sh.net === "online" ? "En ligne" : (sh.net === "offline" ? "Hors ligne" : "Connexion…"));
    }
  }
  function openShared(code, row) {
    stopShared();
    sh.code = code || "";
    sh.row = null;
    sh.hand = null;
    sh.pending = false;
    sh.net = "connecting";
    sh.el.hidden = false;
    if (code) {
      onSharedRow(row);
      holdSeats(code, ["ketchup", "mayo"]);
      sh.link = RoomLink(code, onSharedRow, function (net) { sh.net = net; renderShared(); if (net === "online") beat(); });
    }
    renderShared();
  }
  function stopShared() {
    if (sh.link) { sh.link.stop(); releaseSeats(); }
    sh.link = null;
  }
  function closeShared() {
    stopShared();
    sh.el.hidden = true;
  }
  function onSharedRow(row) {
    if (sh.el.hidden || !sh.code) return;
    if (!row || row.closed) {
      closeShared();
      showJoin("La salle a été fermée par le présentateur, ou a expiré.", true);
      return;
    }
    if (sh.row && Date.parse(row.updated_at) < Date.parse(sh.row.updated_at)) return;
    if (!sh.row || sh.row.question !== row.question) sh.pending = false;
    sh.row = row;
    renderShared();
  }
  function sharedPress(t) {
    var st = sharedState();
    if (st !== "ready") return; // verrouillé jusqu'au déblocage
    if (!sharedOnline()) {
      sh.hand = t;
      renderShared();
      M.buzzSound(t);
      return;
    }
    var code = sh.code, q = sh.row.question;
    M.warmAudio();
    sh.pending = true;
    renderShared();
    rpc("buzz", { p_code: code, p_team: t, p_question: q, p_device: DEVICE }).then(function (won) {
      if (sh.code !== code) return;
      if (won && sh.row && sh.row.question === q) {
        sh.row = Object.assign({}, sh.row, { buzzed_team: t });
        M.buzzSound(t);
      } else if (!won) beat(); // place perdue ? on vérifie tout de suite
      sh.pending = false;
      renderShared();
      if (sh.link) sh.link.refresh();
    }).catch(function (e) {
      if (sh.code !== code) return;
      sh.pending = false;
      if (isNetError(e)) { if (sh.link) sh.link.lost(); }
      else showSharedNotice(SERVER_REFUSED);
      renderShared();
    });
  }
  Array.prototype.forEach.call(sh.el.querySelectorAll(".shared-half"), function (half) {
    half.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      sharedPress(half.getAttribute("data-hand"));
    });
  });
  $("sharedUnlock").addEventListener("click", function () { sh.hand = null; renderShared(); M.blip(); });
  $("sharedQuit").addEventListener("click", function () { closeShared(); showJoin(""); });

  // Clavier côté présentateur (B = buzzers ou débloquer, Échap = fermer)
  M.keyHook = function (e) {
    var k = e.key;
    if (!els.hit.hidden) {
      if (k === "Escape") hideHit();
      else if (k.toLowerCase() === "b") unlock();
      else return false; // les points restent au clavier
      return true;
    }
    if (panelOpen()) {
      if (k === "Escape") closePanel();
      return true;
    }
    if (k.toLowerCase() === "b" && !e.shiftKey && $("welcome").hidden) { openPanel(); return true; }
    return false;
  };

  /* ================= Appareil buzzer ================= */
  var bz = { code: "", team: null, row: null, link: null, net: "connecting", pending: false, question: null, tab: "buzz", expiry: null };
  var B = {
    app: $("bzApp"), join: $("bzJoin"), play: $("bzPlay"), input: $("bzCode"), msg: $("bzJoinMsg"),
    room: $("bzRoom"), net: $("bzNet"), button: $("bzButton"), state: $("bzState"),
    tabBuzz: $("bzTabBuzz"), tabRecap: $("bzTabRecap"), main: $("bzMain"), recap: $("bzRecap")
  };

  function showJoin(message, isErr) {
    stopBuzzer();
    B.app.className = "bz";
    B.app.hidden = false;
    B.play.hidden = true;
    B.join.hidden = false;
    B.msg.textContent = message || "";
    B.msg.style.color = isErr ? "" : "var(--creme)";
    var saved = readJson(BUZZER_KEY) || {};
    if (!B.input.value && saved.code) B.input.value = cleanCode(saved.code);
  }
  function stopBuzzer() {
    if (bz.link) { bz.link.stop(); releaseSeats(); }
    bz.link = null;
    clearTimeout(bz.expiry);
  }

  // t = "ketchup" | "mayo", ou "both" pour l'écran partagé
  function join(t) {
    var code = cleanCode(B.input.value);
    B.input.value = code;
    if (t === "both" && !code) { openShared("", null); return; } // sans code : sans réseau
    if (code.length !== 4) { B.msg.textContent = "Le code de la salle fait 4 lettres."; B.msg.style.color = ""; B.input.focus(); return; }
    if (!CONFIGURED) {
      B.msg.textContent = t === "both"
        ? "Buzzers connectés non configurés : effacez le code pour jouer sans réseau."
        : "Les buzzers connectés ne sont pas configurés sur cette appli.";
      B.msg.style.color = "";
      return;
    }
    B.input.blur();
    B.msg.textContent = "Connexion…";
    B.msg.style.color = "var(--creme)";
    setJoinBusy(true);
    fetchRoom(code).then(function (row) {
      if (!row || row.closed) {
        B.msg.textContent = "Salle introuvable ou expirée. Vérifiez le code auprès du présentateur.";
        B.msg.style.color = "";
        return;
      }
      var teams = t === "both" ? ["ketchup", "mayo"] : [t];
      return claimSeats(code, teams).then(function (res) {
        if (res === "taken") { B.msg.textContent = takenText(teams); B.msg.style.color = ""; return; }
        if (res !== "ok") { B.msg.textContent = "Salle introuvable ou expirée. Vérifiez le code auprès du présentateur."; B.msg.style.color = ""; return; }
        writeJson(BUZZER_KEY, { code: code, team: t });
        if (t === "both") openShared(code, row);
        else startPlay(code, t, row);
      });
    }).catch(function (e) {
      B.msg.textContent = !isNetError(e) ? "Le serveur des buzzers a refusé la connexion. Fermez puis rouvrez l'appli ; si ça continue, vérifiez que les 2 scripts Supabase ont été lancés."
        : t === "both"
        ? "Serveur injoignable. Pour jouer sans réseau, effacez le code puis touchez « Les deux équipes »."
        : "Serveur injoignable. Vérifiez votre connexion et réessayez.";
      B.msg.style.color = "";
    }).then(function () { setJoinBusy(false); });
  }
  function setJoinBusy(busy) {
    Array.prototype.forEach.call(B.join.querySelectorAll("[data-join]"), function (b) { b.disabled = busy; });
    $("bzShared").disabled = busy;
  }

  function startPlay(code, t, row) {
    bz.code = code;
    bz.team = t;
    bz.row = null;
    bz.pending = false;
    bz.question = null;
    bz.net = "connecting";
    B.app.className = "bz team-" + t;
    B.join.hidden = true;
    B.play.hidden = false;
    B.room.innerHTML = "";
    var b = document.createElement("b");
    b.textContent = code;
    B.room.appendChild(b);
    B.room.appendChild(document.createTextNode(" · " + TEAMS[t]));
    setTab("buzz");
    onBuzzerRow(row);
    holdSeats(code, [t]);
    bz.link = RoomLink(code, onBuzzerRow, function (net) { bz.net = net; renderBuzzer(); if (net === "online") beat(); });
  }

  function onBuzzerRow(row) {
    if (!row || row.closed) {
      showJoin("La salle a été fermée par le présentateur, ou a expiré.", true);
      return;
    }
    // Une réponse plus ancienne que ce qu'on sait déjà (réseau lent) est ignorée
    if (bz.row && Date.parse(row.updated_at) < Date.parse(bz.row.updated_at)) return;
    if (!bz.row || bz.row.question !== row.question) bz.pending = false;
    bz.row = row;
    clearTimeout(bz.expiry);
    var left = Date.parse(row.expires_at) - Date.now();
    if (left > 0) bz.expiry = setTimeout(function () { if (bz.link) bz.link.refresh(); }, Math.min(left + 2000, 2147483000));
    renderBuzzer();
    renderRecap();
  }

  function buzzerState() {
    var row = bz.row;
    if (!row) return "wait";
    if (bz.net === "offline") return "offline";
    if (!row.buzzers_enabled) return "paused";
    var who = team(row.buzzed_team);
    if (who) return who === bz.team ? "mine" : "late";
    return bz.pending ? "pending" : "ready";
  }
  var BUTTON_TEXT = { wait: "…", offline: "Hors ligne", paused: "En pause", mine: "À vous !", late: "Trop tard", pending: "Buzz !", ready: "Buzz !" };
  var buzzerNotice = { text: "", timer: null };
  function showBuzzerNotice(text) {
    clearTimeout(buzzerNotice.timer);
    buzzerNotice.text = text;
    buzzerNotice.timer = setTimeout(function () { buzzerNotice.text = ""; renderBuzzer(); }, 6000);
  }
  function renderBuzzer() {
    if (B.play.hidden) return;
    var st = buzzerState();
    B.play.setAttribute("data-state", st);
    B.button.textContent = BUTTON_TEXT[st];
    B.button.disabled = st !== "ready";
    var who = bz.row && team(bz.row.buzzed_team);
    B.state.textContent = {
      wait: "Connexion à la salle…",
      offline: "Connexion perdue. Reconnexion automatique…",
      paused: "Buzzers en pause pour le moment.",
      mine: "Votre équipe a la main !",
      late: who ? TEAMS[who] + " a buzzé avant vous." : "",
      pending: "…",
      ready: "Au premier qui buzze !"
    }[st];
    if (buzzerNotice.text && st === "ready") B.state.textContent = buzzerNotice.text;
    setNet(B.net, bz.net === "online" ? "online" : (bz.net === "offline" ? "offline" : "connecting"),
      bz.net === "online" ? "En ligne" : (bz.net === "offline" ? "Hors ligne" : "Connexion…"));
  }

  function press() {
    if (buzzerState() !== "ready") return;
    var row = bz.row, code = bz.code, t = bz.team;
    M.warmAudio();
    bz.pending = true;
    renderBuzzer();
    rpc("buzz", { p_code: code, p_team: t, p_question: row.question, p_device: DEVICE }).then(function (won) {
      if (!won) beat(); // place perdue ? on vérifie tout de suite
      if (bz.code !== code) return;
      if (won && bz.row && bz.row.question === row.question) {
        // Le serveur a donné la main à ce buzzer : on l'affiche sans attendre le temps réel
        bz.row = Object.assign({}, bz.row, { buzzed_team: t });
        M.buzzSound(t);
      }
      bz.pending = false;
      renderBuzzer();
      if (bz.link) bz.link.refresh();
    }).catch(function (e) {
      if (bz.code !== code) return;
      bz.pending = false;
      if (isNetError(e)) { if (bz.link) bz.link.lost(); }
      else showBuzzerNotice(SERVER_REFUSED);
      renderBuzzer();
    });
  }

  // Récap en lecture seule : on ne fait confiance à rien de ce qui arrive du réseau
  function cleanRecap(r) {
    if (!r || typeof r !== "object" || !r.scores) return null;
    var n = M.rounds.length;
    var g = {
      scores: { ketchup: int(r.scores.ketchup, 0, 9999), mayo: int(r.scores.mayo, 0, 9999) },
      goal: int(r.goal, 1, 999) || 25,
      round: int(r.round, 0, n - 1),
      bdm: { team: team(r.bdm && r.bdm.team) || "ketchup", count: int(r.bdm && r.bdm.count, 0, 10), best: { ketchup: 0, mayo: 0 } },
      perRound: { ketchup: [], mayo: [] }
    };
    ["ketchup", "mayo"].forEach(function (t) {
      var arr = (r.perRound && Array.isArray(r.perRound[t])) ? r.perRound[t] : [];
      for (var i = 0; i < n; i++) g.perRound[t].push(int(arr[i], -9999, 9999));
      g.bdm.best[t] = int(r.bdm && r.bdm.best && r.bdm.best[t], 0, 10);
    });
    return g;
  }
  function renderRecap() {
    if (bz.tab !== "recap") return;
    var g = cleanRecap(bz.row && bz.row.recap);
    B.recap.innerHTML = "";
    if (!g) {
      var p = document.createElement("p");
      p.className = "bz-empty";
      p.textContent = "Le présentateur n'a encore rien publié.";
      B.recap.appendChild(p);
      return;
    }
    var sum = document.createElement("div");
    sum.className = "bz-sum";
    sum.innerHTML = '<div class="welcome-team k"><div class="welcome-name">Ketchup</div><div class="tiles welcome-score"></div></div>' +
      '<div class="welcome-dash" aria-hidden="true">–</div>' +
      '<div class="welcome-team m"><div class="welcome-name">Mayo</div><div class="tiles welcome-score"></div></div>';
    var scores = sum.querySelectorAll(".welcome-score");
    M.scoreTiles(scores[0], g.scores.ketchup, ["t-r", "t-c"]);
    M.scoreTiles(scores[1], g.scores.mayo, ["t-j", "t-b"]);
    B.recap.appendChild(sum);

    var facts = document.createElement("ul");
    facts.className = "bz-facts";
    var add = function (label, value) {
      var li = document.createElement("li");
      li.appendChild(document.createTextNode(label + " "));
      var s = document.createElement("span");
      s.textContent = value;
      li.appendChild(s);
      facts.appendChild(li);
    };
    add("Manche " + (g.round + 1) + " / " + M.rounds.length + " ·", M.rounds[g.round].name);
    add("Objectif", g.goal + " Miams");
    if (g.round === M.bdmIndex) {
      add("Burger de la Mort ·", TEAMS[g.bdm.team] + " " + g.bdm.count + " / 10");
    }
    B.recap.appendChild(facts);

    var card = document.createElement("div");
    card.className = "card recap-card";
    card.innerHTML = M.recapHtml(g); // nombres bornés et noms tirés de la liste des manches
    B.recap.appendChild(card);
  }
  function setTab(tab) {
    bz.tab = tab;
    B.tabBuzz.setAttribute("aria-selected", String(tab === "buzz"));
    B.tabRecap.setAttribute("aria-selected", String(tab === "recap"));
    B.main.hidden = tab !== "buzz";
    B.recap.hidden = tab !== "recap";
    renderRecap();
  }

  B.input.addEventListener("input", function () {
    var v = cleanCode(B.input.value);
    if (v !== B.input.value) B.input.value = v;
  });
  Array.prototype.forEach.call(B.join.querySelectorAll("[data-join]"), function (b) {
    b.addEventListener("click", function () { join(b.getAttribute("data-join")); });
  });
  $("bzShared").addEventListener("click", function () { join("both"); });
  $("bzBack").addEventListener("click", function () {
    stopBuzzer();
    B.app.hidden = true;
    M.showRoleScreen();
  });
  $("bzQuit").addEventListener("click", function () { showJoin(""); });
  // pointerdown : réagit dès le contact, sans attendre que le doigt se lève
  B.button.addEventListener("pointerdown", function (e) { e.preventDefault(); press(); });
  B.button.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); press(); } });
  B.tabBuzz.addEventListener("click", function () { setTab("buzz"); });
  B.tabRecap.addEventListener("click", function () { setTab("recap"); });

  /* ================= Choix du rôle ================= */
  document.addEventListener("miams:role", function (e) {
    if (e.detail === "host") {
      restoreHost();
      renderHost();
    } else if (e.detail === "buzzer") {
      showJoin("");
      if (!CONFIGURED) B.msg.textContent = "Buzzers connectés non configurés : utilisez « Les deux équipes sur ce téléphone », sans code.";
    }
  });

  // Arrivée par le QR code (?salle=ABCD) : directement sur l'écran buzzer, code prérempli
  var fromUrl = cleanCode(new URLSearchParams(location.search).get("salle"));
  if (fromUrl.length === 4) {
    B.input.value = fromUrl;
    M.chooseRole("buzzer");
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
    var savedBz = readJson(BUZZER_KEY);
    B.msg.textContent = savedBz && savedBz.code === fromUrl ? "Touchez votre équipe pour revenir dans la salle." : "Choisissez votre équipe.";
    B.msg.style.color = "var(--creme)";
  }

  /* ================= Mise à jour de l'appli =================
     Une nouvelle version arrive en arrière-plan. Sur un téléphone buzzer, on
     recharge tout de suite (une ancienne version pourrait ne plus savoir buzzer)
     et on revient dans la même salle, avec la même équipe. Le présentateur,
     lui, n'est jamais rechargé en pleine partie : il aura la mise à jour au
     prochain lancement. */
  var REJOIN_KEY = "compteur-miams-rejoindre";
  if ("serviceWorker" in navigator) {
    var hadController = !!navigator.serviceWorker.controller, reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController || reloading || M.mode() === "host") return;
      reloading = true;
      var again = null;
      if (!sh.el.hidden && sh.code) again = { code: sh.code, team: "both" };
      else if (!B.play.hidden && bz.code) again = { code: bz.code, team: bz.team };
      try { if (again) window.sessionStorage.setItem(REJOIN_KEY, JSON.stringify(again)); } catch (e) { /* ignore */ }
      location.reload();
    });
  }
  var again = null;
  try {
    again = JSON.parse(window.sessionStorage.getItem(REJOIN_KEY) || "null");
    window.sessionStorage.removeItem(REJOIN_KEY);
  } catch (e) { again = null; }
  if (again && /^[A-Z]{4}$/.test(again.code) && /^(ketchup|mayo|both)$/.test(again.team)) {
    M.chooseRole("buzzer");
    B.input.value = again.code;
    join(again.team); // même appareil : il retrouve sa place
  }
})();
