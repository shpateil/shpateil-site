(() => {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...(c || document).querySelectorAll(s)];
  const ls = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const API = window.SH_API;
  const overlay = $("#game-overlay");
  const field = $("#game-field");
  const stages = {
    nick: $("#game-stage-nick"),
    play: $("#game-stage-play"),
    result: $("#game-stage-result"),
    board: $("#game-stage-board"),
  };
  const nickInput = $("#game-nick-input");
  const typeInput = $("#game-type-input");
  const hudTime = $("#hud-time");
  const hudScore = $("#hud-score");
  const hudCombo = $("#hud-combo");

  const GAME_TIME = 60;
  const MAX_WORDS = 3;
  const SPAWN_BASE = 2000, SPAWN_MIN = 1100;
  const FALL_BASE = 7000, FALL_MIN = 4000;

  let words = [], banned = [], running = false;
  let elapsed = 0, score = 0, typed = 0, combo = 0, maxCombo = 0;
  let timerId = null, spawnId = null, rafId = null;
  let falling = [], fieldH = 0;
  let used = new Set();

  const showStage = (n) => {
    Object.keys(stages).forEach((k) => { stages[k].hidden = k !== n; });
  };

  function open() {
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    const saved = ls.get("nick", "");
    if (saved) nickInput.value = saved;
    showStage("nick");
    setTimeout(() => nickInput.focus(), 30);
    loadWords();
  }
  function close() {
    overlay.hidden = true;
    document.body.style.overflow = "";
    stop();
    showStage("nick");
  }

  async function loadWords() {
    if (words.length) return;
    try {
      const d = await API.get("/api/words");
      words = Array.isArray(d.words) ? d.words : [];
    } catch { words = ["exploit", "root", "shell", "kernel"]; }
  }

  async function loadBanned() {
    try {
      const d = await API.get("/api/leaderboard/banned");
      banned = Array.isArray(d.banned) ? d.banned : [];
    } catch { banned = []; }
  }

  async function start() {
    const nick = (nickInput.value || "").trim().slice(0, 20);
    if (!nick) { nickInput.focus(); return; }
    ls.set("nick", nick);
    await loadWords();
    await loadBanned();
    if (!words.length) words = ["root", "shell", "kernel", "exploit"];

    field.innerHTML = "";
    falling = [];
    used = new Set();
    elapsed = 0; score = 0; typed = 0; combo = 0; maxCombo = 0;
    hudTime.textContent = GAME_TIME;
    hudScore.textContent = "0";
    hudCombo.textContent = "0";

    showStage("play");
    setTimeout(() => typeInput.focus(), 30);
    fieldH = field.clientHeight;
    running = true;

    scheduleSpawn();
    timerId = setInterval(tick, 1000);
    rafId = requestAnimationFrame(loop);

    typeInput.value = "";
    typeInput.oninput = onType;
    typeInput.onkeydown = onKey;
  }

  function scheduleSpawn() {
    if (!running) return;
    const p = elapsed / GAME_TIME;
    const interval = SPAWN_BASE - (SPAWN_BASE - SPAWN_MIN) * p;
    spawnId = setTimeout(() => { spawn(p); scheduleSpawn(); }, interval + Math.random() * 400);
  }

  function spawn(progress) {
    if (!words.length) return;
    const active = falling.filter((p) => !p.matched);
    if (active.length >= MAX_WORDS) return;
    const onScreen = new Set(active.map((p) => p.word));
    let avail = words.filter((w) => !onScreen.has(w) && !used.has(w));
    if (!avail.length) {
      used = new Set(onScreen);
      avail = words.filter((w) => !onScreen.has(w));
    }
    if (!avail.length) return;
    const w = avail[Math.floor(Math.random() * avail.length)];
    used.add(w);

    const el = document.createElement("div");
    el.className = "fall-word";
    el.textContent = w;
    el.setAttribute("data-word", w);
    field.appendChild(el);
    const ww = el.offsetWidth;
    const fw = field.clientWidth;
    el.style.left = Math.max(4, Math.random() * Math.max(1, fw - ww - 8)) + "px";
    el.style.top = "-30px";
    const fallMs = FALL_BASE - (FALL_BASE - FALL_MIN) * progress + Math.random() * 600;
    falling.push({ el, word: w, top: -30, fallMs, startedAt: performance.now(), matched: false });
  }

  function loop(now) {
    if (!running) return;
    for (let i = falling.length - 1; i >= 0; i--) {
      const p = falling[i];
      if (p.matched) continue;
      const t = (now - p.startedAt) / p.fallMs;
      const top = -30 + t * (fieldH + 30);
      p.top = top;
      p.el.style.top = top + "px";
      if (top > fieldH) {
        p.el.remove();
        falling.splice(i, 1);
        combo = 0;
        hudCombo.textContent = "0";
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  function tick() {
    if (!running) return;
    elapsed++;
    hudTime.textContent = Math.max(0, GAME_TIME - elapsed);
    if (elapsed >= GAME_TIME) { stop(); finish(); }
  }

  function onType() {
    const v = typeInput.value.trim().toLowerCase();
    $$(".fall-word", field).forEach((el) => el.classList.remove("match"));
    if (!v) return;
    for (const p of falling) {
      if (p.matched) continue;
      if (p.word.startsWith(v)) p.el.classList.add("match");
    }
  }

  function onKey(e) {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); submit(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stop(); finish(); }
  }

  function submit() {
    const v = typeInput.value.trim().toLowerCase();
    if (!v) return;
    let target = null;
    for (const p of falling) {
      if (p.matched) continue;
      if (p.word === v && p.top < fieldH) { target = p; break; }
    }
    if (target) {
      target.matched = true;
      target.el.classList.remove("match");
      target.el.classList.add("boom");
      const pts = target.word.length + combo * 2;
      score += pts;
      typed++;
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      hudScore.textContent = score;
      hudCombo.textContent = combo;
      setTimeout(() => {
        target.el.remove();
        const i = falling.indexOf(target);
        if (i >= 0) falling.splice(i, 1);
      }, 280);
      typeInput.value = "";
      onType();
    } else {
      typeInput.classList.add("error");
      setTimeout(() => typeInput.classList.remove("error"), 250);
    }
  }

  function stop() {
    running = false;
    if (timerId) clearInterval(timerId);
    if (spawnId) clearTimeout(spawnId);
    if (rafId) cancelAnimationFrame(rafId);
    timerId = spawnId = rafId = null;
  }

  async function finish() {
    showStage("result");
    $("#result-words").textContent = typed;
    $("#result-score").textContent = score;
    $("#result-banned").hidden = true;
    $("#result-saved").hidden = true;
    const nick = (nickInput.value || "").trim().slice(0, 20);
    if (!nick) return;
    if (banned.some((n) => n.toLowerCase() === nick.toLowerCase())) {
      $("#result-banned").hidden = false;
      return;
    }
    if (score <= 0) return;
    try {
      await API.post("/api/leaderboard/submit", { nick, score, words: typed, combo: maxCombo });
      $("#result-saved").hidden = false;
    } catch {}
  }

  async function showBoard() {
    showStage("board");
    const box = $("#leaderboard-list");
    box.innerHTML = '<div class="lb-empty">загрузка...</div>';
    try {
      const d = await API.get("/api/leaderboard");
      const rows = Array.isArray(d.entries) ? d.entries : [];
      if (!rows.length) {
        box.innerHTML = '<div class="lb-empty">пока пусто. будь первым.</div>';
        return;
      }
      box.innerHTML = "";
      rows.slice(0, 15).forEach((r, i) => {
        const row = document.createElement("div");
        row.className = "lb-row";
        row.innerHTML = `<span class="lb-rank">${i + 1}</span><span class="lb-name">${esc(r.nick)}</span><span class="lb-score">${Number(r.score) || 0}</span>`;
        box.appendChild(row);
      });
    } catch { box.innerHTML = '<div class="lb-empty">не удалось загрузить топ</div>'; }
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  $("#game-close").addEventListener("click", close);
  $("#game-start-btn").addEventListener("click", start);
  $("#game-again").addEventListener("click", start);
  $("#game-top").addEventListener("click", showBoard);
  $("#game-exit").addEventListener("click", close);
  $("#board-back").addEventListener("click", close);
  nickInput.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });

  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden && !(e.target instanceof HTMLInputElement)) {
      if (!stages.nick.hidden) close();
      else if (!stages.board.hidden) showStage("result");
      else if (!stages.result.hidden) close();
      else { stop(); finish(); }
    }
  });

  window.SH_GAME = { open, close };
})();
