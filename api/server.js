"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");

const ROOT = __dirname;
const SITE = path.dirname(ROOT);
const DATA = path.join(ROOT, "data");

const FILES = {
  phrases: path.join(DATA, "phrases.json"),
  words: path.join(DATA, "words.json"),
  board: path.join(DATA, "leaderboard.json"),
  settings: path.join(DATA, "settings.json"),
  visits: path.join(DATA, "visits.json"),
  ignore: path.join(DATA, "ignore.json"),
  skipped: path.join(DATA, "skipped.json"),
};

const PASS = process.env.SHPATEIL_ADMIN_PASSWORD;
if (!PASS || PASS.length < 16) throw new Error("задай SHPATEIL_ADMIN_PASSWORD длиной от 16 символов");

const TOKENS = new Set();
const TTL = 8 * 60 * 60 * 1000;
const TIMES = new Map();

function read(f, d) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } }
function write(f, d) {
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, f);
}
function ensure() {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  const defs = {
    [FILES.phrases]: { phrases: [], fallback: "root@shpateil:~# _" },
    [FILES.words]: { words: [] },
    [FILES.board]: { entries: [], banned: [] },
    [FILES.settings]: {
      contacts: {
        telegram: "https://t.me/shpateil",
        github: "https://github.com/shpateil",
        tiktok: "https://tiktok.com/@shpateil",
        email: "mailto:isenkootap85@gmail.com",
      },
      tagline_fallback: "root@shpateil:~# _",
      foot: "press [g] game / [a] admin / [t] theme",
    },
    [FILES.visits]: { entries: [] },
    [FILES.ignore]: { ips: [], ua: [] },
    [FILES.skipped]: { total: 0, reasons: {}, last: null },
  };
  for (const [f, d] of Object.entries(defs)) if (!fs.existsSync(f)) write(f, d);
}
ensure();

function newToken() { return crypto.randomBytes(32).toString("hex"); }
function prune() {
  const now = Date.now();
  for (const [t, ts] of TIMES) {
    if (now - ts > TTL) { TOKENS.delete(t); TIMES.delete(t); }
  }
}
function authed(req) {
  const t = req.header("x-admin-token");
  if (!t || !TOKENS.has(t)) return false;
  const ts = TIMES.get(t);
  if (!ts || Date.now() - ts > TTL) { TOKENS.delete(t); TIMES.delete(t); return false; }
  return true;
}
const needAuth = (req, res) => {
  if (authed(req)) return true;
  res.status(401).json({ error: "unauthorized" });
  return false;
};

function pubSettings() {
  const s = read(FILES.settings, {});
  return {
    contacts: s.contacts || {},
    tagline_fallback: s.tagline_fallback || "root@shpateil:~# _",
    foot: s.foot || "press [g] game / [a] admin / [t] theme",
  };
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? "loopback" : false);
app.use(express.json({ limit: "100kb" }));

const rl = new Map();
function rate(key, max, win) {
  const now = Date.now();
  const arr = (rl.get(key) || []).filter((t) => now - t < win);
  arr.push(now);
  rl.set(key, arr);
  return arr.length <= max;
}

app.use((req, res, next) => {
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  next();
});

app.get("/api/phrases", (req, res) => {
  const d = read(FILES.phrases, { phrases: [], fallback: "root@shpateil:~# _" });
  res.json({ phrases: d.phrases || [], fallback: d.fallback || "root@shpateil:~# _" });
});

app.get("/api/words", (req, res) => {
  const d = read(FILES.words, { words: [] });
  res.json({ words: d.words || [] });
});

app.get("/api/settings", (req, res) => res.json(pubSettings()));

app.get("/api/leaderboard", (req, res) => {
  const d = read(FILES.board, { entries: [], banned: [] });
  const entries = (d.entries || [])
    .filter((e) => e && typeof e.nick === "string" && typeof e.score === "number")
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
  res.json({ entries });
});

app.get("/api/leaderboard/banned", (req, res) => {
  const d = read(FILES.board, { entries: [], banned: [] });
  res.json({ banned: d.banned || [] });
});

function parseUA(ua) {
  ua = ua || "";
  let b = "other";
  if (/firefox/i.test(ua)) b = "firefox";
  else if (/edg/i.test(ua)) b = "edge";
  else if (/chrome/i.test(ua)) b = "chrome";
  else if (/safari/i.test(ua)) b = "safari";
  let os = "other";
  if (/windows/i.test(ua)) os = "windows";
  else if (/android/i.test(ua)) os = "android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "ios";
  else if (/mac/i.test(ua)) os = "mac";
  else if (/linux/i.test(ua)) os = "linux";
  let dev = "desktop";
  if (/ipad/i.test(ua)) dev = "tablet";
  else if (/mobile|android|iphone/i.test(ua)) dev = "mobile";
  else if (/tablet/i.test(ua)) dev = "tablet";
  return `${b}/${os}/${dev}`;
}

/* --- фильтр: не пишем в visits.json свои ip и ботов --- */
const SELF_IPS = ["127.0.0.1", "::1"];
const BOT_RE = new RegExp(
  [
    "bot", "crawl", "spider", "slurp", "yandex", "baidu", "duckduck", "bingpreview",
    "semrush", "ahrefs", "mj12", "dotbot", "petal", "applebot", "dataprovider", "zgrab",
    "masscan", "nmap", "nikto", "curl/", "wget", "python", "aiohttp", "httpx", "scrapy",
    "go-http-client", "okhttp", "java/", "libwww", "headless", "phantomjs", "puppeteer",
    "playwright", "lighthouse", "monitor", "uptime", "pingdom", "statuscake", "site24x7",
    "newrelic", "checkly", "facebookexternalhit", "embedly", "whatsapp", "telegrambot",
  ].join("|"),
  "i"
);

function normIp(ip) {
  return String(ip || "").replace(/^::ffff:/, "").toLowerCase();
}

function ignoreList() {
  const d = read(FILES.ignore, { ips: [], ua: [] });
  return {
    ips: new Set(SELF_IPS.concat(d.ips || []).map(normIp)),
    ua: (d.ua || []).map((s) => String(s).toLowerCase()),
  };
}

function filterReason(ip, ua) {
  const L = ignoreList();
  if (L.ips.has(normIp(ip))) return "self ip";
  const u = String(ua || "").toLowerCase();
  if (!u) return "empty ua";
  if (BOT_RE.test(u)) return "bot ua";
  for (const s of L.ua) if (s && u.includes(s)) return "ignore ua";
  return "";
}

/* счётчик отфильтрованного: пишем пачками, не чаще раза в 10с + флаш раз в 30с */
const SKIPS = { data: read(FILES.skipped, { total: 0, reasons: {}, last: null }), at: 0, dirty: false };
function flushSkips() {
  if (!SKIPS.dirty) return;
  try {
    write(FILES.skipped, SKIPS.data);
    SKIPS.dirty = false;
    SKIPS.at = Date.now();
  } catch (_) {}
}
setInterval(flushSkips, 30000).unref();
function noteSkip(reason, ip, ua) {
  SKIPS.data.total = (SKIPS.data.total || 0) + 1;
  SKIPS.data.reasons = SKIPS.data.reasons || {};
  SKIPS.data.reasons[reason] = (SKIPS.data.reasons[reason] || 0) + 1;
  SKIPS.data.last = { at: new Date().toISOString(), reason, ip, ua: String(ua || "").slice(0, 120) };
  SKIPS.dirty = true;
  if (Date.now() - SKIPS.at > 10000) flushSkips();
}

app.post("/api/visit", (req, res) => {
  if (process.env.ENABLE_ANALYTICS !== "1") return res.json({ ok: true });
  const ip = (req.ip || req.socket.remoteAddress || "anon")
    .split(",")[0].trim().replace(/^::ffff:/, "");
  const ua = (req.header("user-agent") || "").slice(0, 300);
  const skip = filterReason(ip, ua);
  if (skip) { noteSkip(skip, ip, ua); return res.json({ ok: true, skipped: skip }); }
  if (!rate("visit:" + ip, 30, 60000)) return res.status(429).json({ error: "too many" });
  const { path: p, ref, lang, screen, tz } = req.body || {};
  const e = {
    at: new Date().toISOString(),
    ip,
    ua,
    device: parseUA(ua),
    path: typeof p === "string" ? p.slice(0, 100) : "/",
    ref: typeof ref === "string" ? ref.slice(0, 200) : "",
    lang: typeof lang === "string" ? lang.slice(0, 20) : "",
    screen: typeof screen === "string" ? screen.slice(0, 30) : "",
    tz: typeof tz === "string" ? tz.slice(0, 40) : "",
  };
  const d = read(FILES.visits, { entries: [] });
  d.entries = d.entries || [];
  d.entries.unshift(e);
  if (d.entries.length > 500) d.entries = d.entries.slice(0, 500);
  write(FILES.visits, d);
  res.json({ ok: true });
});

app.get("/api/admin/ignore", (req, res) => {
  if (!needAuth(req, res)) return;
  res.json({
    self_ips: SELF_IPS,
    ignore: read(FILES.ignore, { ips: [], ua: [] }),
    skipped: SKIPS.data,
  });
});

app.post("/api/admin/ignore", (req, res) => {
  if (!needAuth(req, res)) return;
  const b = req.body || {};
  const d = read(FILES.ignore, { ips: [], ua: [] });
  if (b.op === "reset_skips") {
    SKIPS.data = { total: 0, reasons: {}, last: null };
    write(FILES.skipped, SKIPS.data);
    return res.json({ ok: true, skipped: SKIPS.data });
  }
  if (b.op === "add") {
    if (typeof b.ip === "string" && b.ip.trim()) d.ips = Array.from(new Set((d.ips || []).concat(b.ip.trim())));
    if (typeof b.ua === "string" && b.ua.trim()) d.ua = Array.from(new Set((d.ua || []).concat(b.ua.trim())));
  } else if (b.op === "remove") {
    if (typeof b.ip === "string") d.ips = (d.ips || []).filter((x) => x !== b.ip.trim());
    if (typeof b.ua === "string") d.ua = (d.ua || []).filter((x) => x !== b.ua.trim());
  } else if (b.op === "reset") {
    d.ips = []; d.ua = [];
  } else {
    return res.status(400).json({ error: "bad op" });
  }
  write(FILES.ignore, d);
  res.json({ ok: true, ignore: d });
});

app.get("/api/admin/logs", (req, res) => {
  if (!needAuth(req, res)) return;
  const d = read(FILES.visits, { entries: [] });
  res.json({ entries: (d.entries || []).slice(0, 200) });
});

app.post("/api/admin/logs", (req, res) => {
  if (!needAuth(req, res)) return;
  if (req.body && req.body.op === "clear") {
    write(FILES.visits, { entries: [] });
    return res.json({ ok: true });
  }
  res.status(400).json({ error: "bad op" });
});

app.post("/api/leaderboard/submit", (req, res) => {
  const ip = (req.ip || req.socket.remoteAddress || "anon").replace(/^::ffff:/, "");
  if (!rate("submit:" + ip, 20, 60000)) return res.status(429).json({ error: "too many" });
  const { nick, score, words, combo } = req.body || {};
  if (typeof nick !== "string" || typeof score !== "number") return res.status(400).json({ error: "bad payload" });
  const n = nick.trim().slice(0, 20);
  if (!n) return res.status(400).json({ error: "empty nick" });
  if (score < 0 || score > 100000) return res.status(400).json({ error: "bad score" });
  const d = read(FILES.board, { entries: [], banned: [] });
  if ((d.banned || []).some((x) => x.toLowerCase() === n.toLowerCase())) return res.json({ ok: true, banned: true });
  d.entries = d.entries || [];
  const ex = d.entries.find((e) => e.nick.toLowerCase() === n.toLowerCase());
  if (ex) {
    if (score > ex.score) { ex.score = score; ex.words = words; ex.combo = combo; ex.at = new Date().toISOString(); }
  } else {
    d.entries.push({ nick: n, score, words, combo, at: new Date().toISOString() });
    if (d.entries.length > 200) { d.entries.sort((a, b) => b.score - a.score); d.entries = d.entries.slice(0, 200); }
  }
  write(FILES.board, d);
  res.json({ ok: true });
});

app.post("/api/admin/login", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "anon";
  if (!rate("login:" + ip, 10, 60000)) return res.status(429).json({ error: "too many" });
  if (typeof (req.body || {}).password !== "string") return res.status(400).json({ error: "bad payload" });
  prune();
  if (req.body.password === PASS) {
    const t = newToken();
    TOKENS.add(t);
    TIMES.set(t, Date.now());
    return res.json({ token: t });
  }
  setTimeout(() => res.status(401).json({ error: "wrong password" }), 350);
});

app.post("/api/admin/phrases", (req, res) => {
  if (!needAuth(req, res)) return;
  const { op, value, index, values } = req.body || {};
  const d = read(FILES.phrases, { phrases: [], fallback: "root@shpateil:~# _" });
  d.phrases = d.phrases || [];
  if (op === "add") {
    if (typeof value !== "string" || !value.trim()) return res.status(400).json({ error: "bad value" });
    d.phrases.push(value.trim().slice(0, 200));
  } else if (op === "addMany") {
    if (!Array.isArray(values)) return res.status(400).json({ error: "bad values" });
    values.forEach((v) => { if (typeof v === "string" && v.trim()) d.phrases.push(v.trim().slice(0, 200)); });
  } else if (op === "edit") {
    if (typeof index !== "number" || index < 0 || index >= d.phrases.length) return res.status(400).json({ error: "bad index" });
    if (typeof value !== "string" || !value.trim()) return res.status(400).json({ error: "bad value" });
    d.phrases[index] = value.trim().slice(0, 200);
  } else if (op === "delete") {
    if (typeof index !== "number" || index < 0 || index >= d.phrases.length) return res.status(400).json({ error: "bad index" });
    d.phrases.splice(index, 1);
  } else return res.status(400).json({ error: "bad op" });
  write(FILES.phrases, d);
  res.json({ ok: true, phrases: d.phrases });
});

app.post("/api/admin/words", (req, res) => {
  if (!needAuth(req, res)) return;
  const { op, value, index, values } = req.body || {};
  const d = read(FILES.words, { words: [] });
  d.words = d.words || [];
  const norm = (v) => v.trim().toLowerCase().slice(0, 40);
  if (op === "add") {
    if (typeof value !== "string" || !value.trim()) return res.status(400).json({ error: "bad value" });
    const w = norm(value);
    if (!d.words.includes(w)) d.words.push(w);
  } else if (op === "addMany") {
    if (!Array.isArray(values)) return res.status(400).json({ error: "bad values" });
    values.forEach((v) => { if (typeof v === "string" && v.trim()) { const w = norm(v); if (!d.words.includes(w)) d.words.push(w); } });
  } else if (op === "edit") {
    if (typeof index !== "number" || index < 0 || index >= d.words.length) return res.status(400).json({ error: "bad index" });
    if (typeof value !== "string" || !value.trim()) return res.status(400).json({ error: "bad value" });
    d.words[index] = norm(value);
  } else if (op === "delete") {
    if (typeof index !== "number" || index < 0 || index >= d.words.length) return res.status(400).json({ error: "bad index" });
    d.words.splice(index, 1);
  } else return res.status(400).json({ error: "bad op" });
  write(FILES.words, d);
  res.json({ ok: true, words: d.words });
});

app.post("/api/admin/leaderboard", (req, res) => {
  if (!needAuth(req, res)) return;
  const { op, index, nick } = req.body || {};
  const d = read(FILES.board, { entries: [], banned: [] });
  d.entries = d.entries || [];
  d.banned = d.banned || [];
  if (op === "delete") {
    if (typeof index !== "number" || index < 0 || index >= d.entries.length) return res.status(400).json({ error: "bad index" });
    d.entries.splice(index, 1);
  } else if (op === "clear") {
    d.entries = [];
  } else if (op === "ban") {
    if (typeof nick !== "string" || !nick.trim()) return res.status(400).json({ error: "bad nick" });
    const n = nick.trim().slice(0, 20);
    if (!d.banned.some((x) => x.toLowerCase() === n.toLowerCase())) d.banned.push(n);
    d.entries = d.entries.filter((e) => e.nick.toLowerCase() !== n.toLowerCase());
  } else if (op === "unban") {
    if (typeof nick !== "string") return res.status(400).json({ error: "bad nick" });
    d.banned = d.banned.filter((x) => x.toLowerCase() !== nick.trim().toLowerCase());
  } else return res.status(400).json({ error: "bad op" });
  write(FILES.board, d);
  res.json({ ok: true, entries: d.entries.slice(0, 50).sort((a, b) => b.score - a.score), banned: d.banned });
});

app.post("/api/admin/settings", (req, res) => {
  if (!needAuth(req, res)) return;
  const d = read(FILES.settings, {});
  const b = req.body || {};
  if (b.contacts && typeof b.contacts === "object") {
    const c = b.contacts;
    const o = d.contacts || {};
    d.contacts = {
      telegram: typeof c.telegram === "string" ? c.telegram.slice(0, 200) : o.telegram || "",
      github:   typeof c.github === "string" ? c.github.slice(0, 200) : o.github || "",
      tiktok:   typeof c.tiktok === "string" ? c.tiktok.slice(0, 200) : o.tiktok || "",
      email:    typeof c.email === "string" ? c.email.slice(0, 200) : o.email || "",
    };
  }
  if (typeof b.tagline_fallback === "string") d.tagline_fallback = b.tagline_fallback.slice(0, 200);
  if (typeof b.foot === "string") d.foot = b.foot.slice(0, 300);
  write(FILES.settings, d);
  res.json({ ok: true, settings: pubSettings() });
});



/* export всё одним текстом (готов для анализа) */
app.get("/api/admin/export", (req, res) => {
  if (!needAuth(req, res)) return;
  const d = read(FILES.visits, { entries: [] });
  const es = d.entries || [];
  const now = Date.now(); const day = 24*60*60*1000;
  const total = es.length;
  const dayN = es.filter(e => { const at = new Date(e.at||0).getTime(); return !isNaN(at) && now-at < day; }).length;
  const ips = {};
  const paths = {}; const refs = {}; const bro = {};
  es.forEach(e => {
    const ip=e.ip||""; ips[ip] = (ips[ip]||0)+1;
    const pp=(e.path||"/"); paths[pp]=(paths[pp]||0)+1;
    let dom=""; try { const u=new URL(e.ref||""); dom=u.hostname.replace(/^www./,""); } catch(_) { dom=(e.ref||"").slice(0,40); }
    if (dom) refs[dom]=(refs[dom]||0)+1;
    const b=(e.device||"").split("/")[0]||"other"; bro[b]=(bro[b]||0)+1;
  });
  const top=(o,n)=>Object.keys(o).map(k=>({k,v:o[k]})).sort((a,b)=>b.v-a.v).slice(0,n);
  let out=[];
  out.push("shpateil.fun | analytics export");
  out.push("exported: "+new Date().toISOString());
  out.push("total: "+total+" | last24h: "+dayN+" | unique_ips: "+Object.keys(ips).length);
  out.push("");
  const blk=(name,arr)=>{ out.push("# "+name); arr.forEach(x=>out.push(String(x.v)+" | "+String(x.k).slice(0,60))); out.push(""); };
  blk("top paths", top(paths,8)); blk("top referrers", top(refs,8)); blk("browsers", top(bro,6));
  const sk = SKIPS.data || {};
  const skr = sk.reasons || {};
  if (sk.total) blk("filtered (не в логе)", Object.keys(skr).map(k=>({k,v:skr[k]})).sort((a,b)=>b.v-a.v));
  out.push("# visits"); out.push("time | ip | device | path | screen");
  es.slice(0,400).forEach(e=>out.push([String(e.at||"").slice(0,19), e.ip||"", e.device||"", e.path||"/", e.screen||""].join(" | ")));
  res.set("content-type","text/plain; charset=utf-8");
  res.send(out.join(String.fromCharCode(10)) + String.fromCharCode(10));
});
app.get("/api/admin/stats", (req, res) => {
  if (!needAuth(req, res)) return;
  const d = read(FILES.visits, { entries: [] });
  const es = d.entries || [];
  const now = Date.now();
  const day = 24*60*60*1000;
  const today = es.filter(e => { const at = new Date(e.at).getTime(); return !isNaN(at) && now - at < day; });
  const uni = {}; const paths = {}; const refs = {}; const browsers = {}; const days = {};
  const dayFmt = (at) => { const d = new Date(at); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
  es.forEach(e => {
    const ip = e.ip || "";
    if (!(ip in uni)) uni[ip] = 0; uni[ip]++;
    const _p = e.path || "/"; paths[_p] = (paths[_p]||0)+1;
    const r = (e.ref || ""); const dom = (function(){ try { var u=new URL(r); return u.hostname.replace(/^www\./,"") } catch(_) { return r && r.length>30 ? r.slice(0,30) : (r||""); } })();
    if (dom) { refs[dom] = (refs[dom]||0)+1; }
    const b = (e.device || "").split("/")[0] || "other"; browsers[b] = (browsers[b]||0)+1;
    const df = dayFmt(e.at); days[df] = (days[df]||0)+1;
  });
  const top = (o, n) => Object.keys(o).map(k => ({ k, v: o[k] })).sort((a,b)=>b.v-a.v).slice(0,n);
  res.json({
    total: es.length,
    unique_ips_24h: Object.keys(uni).filter(ip => { return es.some(e2 => { const at=new Date(e2.at).getTime(); return e2.ip===ip && !isNaN(at) && now-at<day; }); }).length,
    visits_24h: today.length,
    last_day: top(days, 7),
    top_paths: top(paths, 6),
    top_refs: top(refs, 6),
    browsers: top(browsers, 6),
    last_seen: es.length ? es[0].at : null,
  });
});

app.use((req, res, next) => {
  const allowed = /^\/(?:$|index\.html$|404\.html$|favicon\.svg$|og\.png$|(?:css|js|img|static)\/)/;
  if (!allowed.test(req.path)) return res.status(404).json({ error: "not found" });
  next();
});

app.use(express.static(SITE, {
  extensions: ["html"],
  index: "index.html",
  setHeaders: (res, p) => {
    if (p.endsWith(".html") || p.endsWith(".json")) res.setHeader("cache-control", "no-cache");
    else if (p.endsWith(".js") || p.endsWith(".css")) res.setHeader("cache-control", "public, max-age=31536000, immutable");
  },
}));

app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    const idx = path.join(SITE, "index.html");
    if (fs.existsSync(idx)) return res.sendFile(idx);
  }
  next();
});

app.use((req, res) => res.status(404).json({ error: "not found" }));
app.use((err, req, res, next) => { console.error("[err]", err.message); res.status(500).json({ error: "internal" }); });

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`[shpateil.fun] http://${HOST}:${PORT}`);
  console.log(`[shpateil.fun] root: ${SITE}`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
