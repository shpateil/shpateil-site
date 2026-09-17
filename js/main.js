(() => {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const ls = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = matchMedia("(pointer: coarse)").matches;

  // api
  const API = {
    async get(p) {
      const r = await fetch(p, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(r.status);
      return r.json();
    },
    async post(p, b, t) {
      const h = { "content-type": "application/json", accept: "application/json" };
      if (t) h["x-admin-token"] = t;
      const r = await fetch(p, { method: "POST", body: JSON.stringify(b || {}), headers: h });
      if (!r.ok) throw new Error(r.status);
      return r.json();
    },
  };
  window.SH_API = API;

  // theme
  const applyTheme = (t) => {
    if (t !== "green" && t !== "pink") t = "green";
    document.documentElement.setAttribute("data-theme", t);
    ls.set("theme", t);
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: t } }));
  };
  const toggleTheme = () => {
    const cur = document.documentElement.getAttribute("data-theme") || "green";
    applyTheme(cur === "green" ? "pink" : "green");
  };
  applyTheme(ls.get("theme", "green"));

  // boot
  const boot = $("#boot");
  const bootLines = $("#boot-lines");
  const app = $("#app");
  const bootSeq = [
    "root@server:~$ ssh visitor@shpateil.fun",
    "connecting to 82.25.60.73:22...",
    "key fingerprint verified",
    "authentication successful",
    "loading profile... done",
    "mounting /home/visitor... ok",
    "starting shell...",
    "ready.",
  ];

  function typeLine(text, delay) {
    return new Promise((res) => {
      let i = 0;
      const tick = () => {
        if (i >= text.length) return res();
        bootLines.textContent += text[i++];
        setTimeout(tick, delay + Math.random() * 25);
      };
      tick();
    });
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function runBoot() {
    const KEY = "shpateil.boot.ts";
    const now = Date.now();
    const last = ls.get(KEY, 0);
    const FIVE_MIN = 5 * 60 * 1000;
    if (reduced || (last && now - last < FIVE_MIN)) {
      boot.style.display = "none";
      app.hidden = false;
      requestAnimationFrame(() => app.classList.add("shown"));
      ls.set(KEY, now);
      return;
    }
    boot.style.display = "flex";
    app.hidden = true;
    bootLines.textContent = "";
    const m = innerWidth < 768;
    const delay = m ? 8 : 12;
    const gap = m ? 35 : 50;
    for (const line of bootSeq) {
      await typeLine(line, delay);
      bootLines.textContent += "\n";
      await wait(gap);
    }
    await wait(150);
    boot.classList.add("fade-out");
    await wait(380);
    boot.style.display = "none";
    app.hidden = false;
    requestAnimationFrame(() => app.classList.add("shown"));
    ls.set(KEY, now);
  }

  // glitch on nick
  const nick = $(".nick");
  function glitch() {
    if (reduced) return;
    nick.classList.add("glitching");
    setTimeout(() => nick.classList.remove("glitching"), 340);
  }
  function startGlitch() {
    if (reduced) return;
    const tick = () => {
      setTimeout(() => { glitch(); tick(); }, 4000 + Math.random() * 5000);
    };
    tick();
  }
  if (!touch && !reduced) {
    let hov = null;
    nick.addEventListener("mouseenter", () => {
      glitch();
      hov = setInterval(glitch, 15000);
    });
    nick.addEventListener("mouseleave", () => { if (hov) clearInterval(hov); });
  }

  // tagline - sequential cycling
  const taglineEl = $("#tagline");
  let phrases = [];
  let fallback = "root@shpateil:~# _";
  let phraseIndex = 0;
  let taglineInterval = null;

  function showNextPhrase() {
    if (!phrases.length) { taglineEl.textContent = fallback; return; }
    taglineEl.textContent = phrases[phraseIndex];
    phraseIndex = (phraseIndex + 1) % phrases.length;
    ls.set("shpateil.tagline.idx", phraseIndex);
  }

  function startTaglineCycle() {
    if (taglineInterval) clearInterval(taglineInterval);
    // restore index from localStorage
    phraseIndex = ls.get("shpateil.tagline.idx", 0);
    showNextPhrase(); // show first immediately
    // then every 5 seconds
    taglineInterval = setInterval(showNextPhrase, 5000);
  }

  async function loadPhrases() {
    try {
      const d = await API.get("/api/phrases");
      phrases = Array.isArray(d.phrases) ? d.phrases : [];
      if (d.fallback) fallback = d.fallback;
    } catch { phrases = ["root@shpateil:~# _"]; }
    startTaglineCycle();
  }

  // contacts
  function initContacts() {
    $$(".contact").forEach((a) => {
      a.addEventListener("click", async (e) => {
        const href = a.getAttribute("href");
        if (!href) return;
        e.preventDefault();
        const n = $(".contact-name", a);
        const orig = n.getAttribute("data-text");
        n.textContent = "connecting...";
        a.classList.add("connecting");
        await wait(280);
        a.classList.remove("connecting");
        n.textContent = orig;
        window.open(href, "_blank", "noopener,noreferrer");
      });
    });
  }

  // cursor trail
  function colors() {
    const cs = getComputedStyle(document.documentElement);
    const p = (v) => {
      const m = v.trim().match(/^#([0-9a-f]{6})$/i);
      if (!m) return [0, 255, 65];
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    return { fg: p(cs.getPropertyValue("--fg")), accent: p(cs.getPropertyValue("--accent")) };
  }

  function initTrail() {
    if (touch || reduced) { const c = $("#trail"); if (c) c.style.display = "none"; return; }
    const cv = $("#trail");
    const ctx = cv.getContext("2d");
    let dpr = Math.min(devicePixelRatio || 1, 2);
    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
      cv.style.width = innerWidth + "px";
      cv.style.height = innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener("resize", resize);

    const g = "01ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ$#%&=+-*/<>:;".split("");
    const parts = [];
    let last = { x: innerWidth / 2, y: innerHeight / 2 };

    addEventListener("pointermove", (e) => {
      const dist = Math.hypot(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
      const n = Math.min(2, Math.floor(dist / 10) + 1);
      for (let i = 0; i < n; i++) {
        if (parts.length >= 60) parts.shift();
        parts.push({
          x: e.clientX,
          y: e.clientY,
          vx: (Math.random() - .5) * .3,
          vy: -0.5 - Math.random() * 1.2,
          life: 1,
          decay: 0.02 + Math.random() * 0.02,
          size: 10 + Math.random() * 6,
          ch: g[Math.floor(Math.random() * g.length)],
        });
      }
    });

    let tc = colors();
    document.addEventListener("themechange", () => { tc = colors(); });

    const loop = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        const a = Math.max(0, p.life);
        const c = p.life > 0.5 ? tc.fg : tc.accent;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
        ctx.font = `${p.size}px "Space Mono", monospace`;
        ctx.fillText(p.ch, p.x, p.y);
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  // matrix rain
  let rainOn = false;
  function initRain() {
    if (touch || reduced) { const c = $("#matrix"); if (c) c.style.display = "none"; return; }
    const cv = $("#matrix");
    const ctx = cv.getContext("2d");
    const fs = 14;
    let cols = [], drops = [];
    const setup = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
      cv.style.width = innerWidth + "px";
      cv.style.height = innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.floor(innerWidth / fs);
      const g = "01ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ".split("");
      cols = new Array(n).fill(0).map(() => Math.random() * -50);
      drops = new Array(n).fill(0).map(() => g[Math.floor(Math.random() * g.length)]);
    };
    setup();
    addEventListener("resize", setup);

    const g = "01ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅｶﾇﾈﾉﾊﾋﾌﾍﾎ$#%&=+-*/<>:;".split("");
    let tc = colors();
    document.addEventListener("themechange", () => { tc = colors(); });

    const draw = () => {
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.font = `${fs}px "Space Mono", monospace`;
      ctx.textBaseline = "top";
      for (let i = 0; i < cols.length; i++) {
        const x = i * fs;
        const y = cols[i] * fs;
        if (Math.random() > 0.96) drops[i] = g[Math.floor(Math.random() * g.length)];
        ctx.fillStyle = `rgba(${tc.accent[0]},${tc.accent[1]},${tc.accent[2]},0.9)`;
        ctx.fillText(drops[i], x, y);
        ctx.fillStyle = `rgba(${tc.fg[0]},${tc.fg[1]},${tc.fg[2]},0.4)`;
        ctx.fillText(drops[i], x, y - fs);
        cols[i]++;
        if (y > innerHeight && Math.random() > 0.975) cols[i] = Math.random() * -20;
      }
      requestAnimationFrame(draw);
    };
    draw();
    if (ls.get("rain", false)) toggleRain(true);
  }
  function toggleRain(force) {
    const c = $("#matrix");
    if (!c) return;
    rainOn = typeof force === "boolean" ? force : !rainOn;
    c.classList.toggle("on", rainOn);
    ls.set("rain", rainOn);
    const btn = $("#btn-rain");
    if (btn) btn.textContent = rainOn ? "[rain:on]" : "[rain]";
  }

  // cursor crosshair
  function initCursor() {
    if (!matchMedia("(pointer: fine)").matches || touch || reduced) return;
    document.body.classList.add("cursor-custom");
    const d = document.createElement("div");
    d.id = "cursor-dot";
    document.body.appendChild(d);
    addEventListener("pointermove", (e) => {
      d.style.left = e.clientX + "px";
      d.style.top = e.clientY + "px";
      d.style.opacity = "1";
    }, { passive: true });
    addEventListener("pointerleave", () => { d.style.opacity = "0"; });
    addEventListener("pointerenter", () => { d.style.opacity = "1"; });
    const sel = "a,button,input,.nick,.contact,.tb,.tab,.game-btn,.overlay-close";
    document.addEventListener("pointerover", (e) => {
      if (e.target.closest(sel)) d.classList.add("hover");
    });
    document.addEventListener("pointerout", (e) => {
      if (e.target.closest(sel)) d.classList.remove("hover");
    });
  }

  // visit log
  async function logVisit() {
    const KEY = "shpateil.lastvisit";
    const now = Date.now();
    const last = ls.get(KEY, 0);
    if (now - last < 5 * 60 * 1000) return;
    ls.set(KEY, now);
    try {
      await API.post("/api/visit", {
        path: location.pathname,
        ref: document.referrer || "",
        lang: navigator.language || "",
        screen: `${innerWidth}x${innerHeight}`,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      });
    } catch {}
  }

  // hotkeys
  addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "t") { e.preventDefault(); toggleTheme(); }
    else if (k === "g") { e.preventDefault(); $("#btn-game").click(); }
    else if (k === "a") { e.preventDefault(); $("#btn-admin").click(); }
    else if (k === "r") { e.preventDefault(); toggleRain(); }
  });

  // topbar
  $("#btn-theme").addEventListener("click", toggleTheme);
  $("#btn-rain").addEventListener("click", () => toggleRain());
  $("#btn-game").addEventListener("click", () => window.SH_GAME && window.SH_GAME.open());
  $("#btn-admin").addEventListener("click", () => window.SH_ADMIN && window.SH_ADMIN.open());

  // settings
  async function loadSettings() {
    try {
      const s = await API.get("/api/settings");
      if (s && s.contacts) {
        const m = { telegram: s.contacts.telegram, github: s.contacts.github, tiktok: s.contacts.tiktok, email: s.contacts.email };
        $$(".contact").forEach((a) => {
          const k = a.getAttribute("data-key");
          if (m[k]) a.setAttribute("href", m[k]);
        });
      }
      if (s && typeof s.foot === "string") $(".foot-hint").textContent = s.foot;
      if (s && typeof s.tagline_fallback === "string") fallback = s.tagline_fallback;
    } catch {}
  }

  async function init() {
    initContacts();
    initRain();
    initTrail();
    initCursor();
    startGlitch();
    await Promise.all([loadPhrases(), loadSettings(), logVisit()]);
    await runBoot();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();