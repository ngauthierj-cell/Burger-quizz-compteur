window.__chans = [];
window.__push = function (row) { window.__chans.forEach(function (c) { if (c.cfg && c.cfg.filter === "code=eq." + row.code) c.cb({ eventType: "UPDATE", new: row }); }); };
window.__fail = function () { window.__chans.slice().forEach(function (c) { c.status("CHANNEL_ERROR"); }); };
window.supabase = { createClient: function () { return {
  rpc: function (name, args) { return window.__fake("rpc", name, args).then(function (d) { return { data: d, error: null }; }, function (e) { var m = /CODE:(\w+)/.exec(String(e)); return { data: null, error: { message: String(e), code: m ? m[1] : "" } }; }); },
  from: function () { return { select: function () { return { eq: function (c, v) { return { maybeSingle: function () {
    return window.__fake("get", v).then(function (d) { return { data: d, error: null }; }, function (e) { return { data: null, error: { message: String(e) } }; }); } }; } }; } }; },
  channel: function () { var ch = { on: function (ev, cfg, cb) { ch.cfg = cfg; ch.cb = cb; return ch; }, subscribe: function (cb) { ch.status = cb;
    window.__fake("sub").then(function () { window.__chans.push(ch); cb("SUBSCRIBED"); }, function () { cb("CHANNEL_ERROR"); }); return ch; } }; return ch; },
  removeChannel: function (ch) { window.__chans = window.__chans.filter(function (c) { return c !== ch; }); if (ch.status) ch.status("CLOSED"); }
}; } };
