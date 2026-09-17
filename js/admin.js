(() => {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...(c || document).querySelectorAll(s)];
  const API = window.SH_API;
  const overlay = $("#admin-overlay");
  const auth = $("#admin-stage-auth");
  const panel = $("#admin-stage-panel");
  const pass = $("#admin-pass-input");
  const err = $("#admin-err");
  const ss = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
    del: (k) => { try { sessionStorage.removeItem(k); } catch {} },
  };
  const T = "shpateil.admin.token";

  function open() {
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    if (ss.get(T)) showPanel();
    else showAuth();
  }
  function close() {
    overlay.hidden = true;
    document.body.style.overflow = "";
  }
  function showAuth() {
    auth.hidden = false;
    panel.hidden = true;
    err.hidden = true;
    setTimeout(() => pass.focus(), 30);
  }
  async function login() {
    if (!pass.value) return;
    try {
      const r = await API.post("/api/admin/login", { password: pass.value });
      if (r && r.token) { ss.set(T, r.token); showPanel(); }
      else err.hidden = false;
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message || "доступ запрещён";
    }
  }
  async function showPanel() {
    auth.hidden = true;
    panel.hidden = false;
    switchTab("phrases");
    await Promise.all([loadPhrases(), loadWords(), loadBoard(), loadLogs(), loadContacts(), loadTexts()]);
  }

  const switchTab = (n) => {
    $$(".tab", panel).forEach((b) => b.classList.toggle("active", b.dataset.tab === n));
    $$(".admin-panel", panel).forEach((p) => { p.hidden = p.dataset.panel !== n; });
  };
  $$(".tab", panel).forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  async function loadPhrases() {
    try {
      const d = await API.get("/api/phrases");
      const list = Array.isArray(d.phrases) ? d.phrases : [];
      const ul = $("#list-phrases");
      ul.innerHTML = "";
      list.forEach((p, i) => ul.appendChild(item(p, i,
        async (v) => await API.post("/api/admin/phrases", { op: "edit", index: i, value: v }, ss.get(T)),
        async () => { await API.post("/api/admin/phrases", { op: "delete", index: i }, ss.get(T)); loadPhrases(); }
      )));
    } catch {}
  }
  $("#add-phrase-btn").addEventListener("click", async () => {
    const v = $("#add-phrase-input").value.trim();
    if (!v) return;
    try {
      await API.post("/api/admin/phrases", { op: "add", value: v }, ss.get(T));
      $("#add-phrase-input").value = "";
      loadPhrases();
    } catch (e) { alert(e); }
  });

  async function loadWords() {
    try {
      const d = await API.get("/api/words");
      const list = Array.isArray(d.words) ? d.words : [];
      const ul = $("#list-words");
      ul.innerHTML = "";
      list.forEach((w, i) => ul.appendChild(item(w, i,
        async (v) => await API.post("/api/admin/words", { op: "edit", index: i, value: v }, ss.get(T)),
        async () => { await API.post("/api/admin/words", { op: "delete", index: i }, ss.get(T)); loadWords(); }
      )));
    } catch {}
  }
  $("#add-word-btn").addEventListener("click", async () => {
    const v = $("#add-word-input").value.trim();
    if (!v) return;
    const arr = v.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      await API.post("/api/admin/words", { op: "addMany", values: arr }, ss.get(T));
      $("#add-word-input").value = "";
      loadWords();
    } catch (e) { alert(e); }
  });

  async function loadBoard() {
    try {
      const d = await API.get("/api/leaderboard");
      const rows = Array.isArray(d.entries) ? d.entries : [];
      const box = $("#admin-leaderboard");
      box.innerHTML = "";
      if (!rows.length) { box.innerHTML = '<div class="lb-empty">пусто</div>'; return; }
      rows.slice(0, 50).forEach((r, i) => {
        const row = document.createElement("div");
        row.className = "lb-row";
        row.innerHTML = `<span class="lb-rank">${i + 1}</span><span class="lb-name">${esc(r.nick)}</span><span class="lb-score">${Number(r.score) || 0}</span><button class="lb-del" data-i="${i}">[x]</button>`;
        box.appendChild(row);
      });
      $$(".lb-del", box).forEach((b) => b.addEventListener("click", async () => {
        const i = parseInt(b.dataset.i, 10);
        try { await API.post("/api/admin/leaderboard", { op: "delete", index: i }, ss.get(T)); loadBoard(); }
        catch (e) { alert(e); }
      }));
    } catch {}
  }
  $("#ban-btn").addEventListener("click", async () => {
    const v = $("#ban-input").value.trim();
    if (!v) return;
    try { await API.post("/api/admin/leaderboard", { op: "ban", nick: v }, ss.get(T)); $("#ban-input").value = ""; loadBoard(); }
    catch (e) { alert(e); }
  });
  $("#clear-board-btn").addEventListener("click", async () => {
    if (!confirm("очистить весь топ?")) return;
    try { await API.post("/api/admin/leaderboard", { op: "clear" }, ss.get(T)); loadBoard(); }
    catch (e) { alert(e); }
  });

  // logs
  async function loadLogs() {
    const box = $("#admin-logs");
    const cnt = $("#logs-count");
    try {
      const r = await fetch("/api/admin/logs", { headers: { accept: "application/json", "x-admin-token": ss.get(T) || "" } });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      const rows = Array.isArray(d.entries) ? d.entries : [];
      if (!rows.length) { box.innerHTML = '<div class="log-empty">пока никто не заходил</div>'; cnt.textContent = "0 записей"; return; }
      cnt.textContent = `${rows.length} ${plural(rows.length, "запись", "записи", "записей")}`;
      box.innerHTML = "";
      rows.forEach((row) => {
        const el = document.createElement("div");
        el.className = "log-row";
        const t = row.at ? new Date(row.at).toLocaleString("ru-RU", { hour12: false }) : "?";
        const ua = row.ua ? uaShort(row.ua) : "?";
        const dev = row.device || "?";
        const ip = row.ip || "?";
        const path = row.path || "/";
        const ref = row.ref ? ` · from ${esc(row.ref)}` : "";
        el.innerHTML = `<span class="log-time">${esc(t)}</span><span class="log-meta">${esc(dev)} · <span class="log-ip">${esc(ip)}</span> · ${esc(path)}${ref}<span class="log-ua">${esc(ua)}</span></span>`;
        box.appendChild(el);
      });
    } catch (e) { box.innerHTML = '<div class="log-empty">ошибка: ' + esc(e.message) + '</div>'; }
  }
  function uaShort(ua) {
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
    let d = "desktop";
    if (/mobile|android|iphone/i.test(ua)) d = "mobile";
    else if (/ipad|tablet/i.test(ua)) d = "tablet";
    return `${b}/${os}/${d}`;
  }
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };
  $("#logs-refresh").addEventListener("click", loadLogs);
  $("#logs-clear").addEventListener("click", async () => {
    if (!confirm("очистить все логи?")) return;
    try { await API.post("/api/admin/logs", { op: "clear" }, ss.get(T)); loadLogs(); }
    catch (e) { alert(e); }
  });

  async function loadContacts() {
    try {
      const s = await API.get("/api/settings");
      const c = s.contacts || {};
      $("#ct-tg").value = c.telegram || "";
      $("#ct-gh").value = c.github || "";
      $("#ct-tt").value = c.tiktok || "";
      $("#ct-em").value = c.email || "";
    } catch {}
  }
  $("#ct-save-btn").addEventListener("click", async () => {
    const contacts = {
      telegram: $("#ct-tg").value.trim(),
      github: $("#ct-gh").value.trim(),
      tiktok: $("#ct-tt").value.trim(),
      email: $("#ct-em").value.trim(),
    };
    try { await API.post("/api/admin/settings", { contacts }, ss.get(T)); flash($("#ct-save-btn")); }
    catch (e) { alert(e); }
  });

  async function loadTexts() {
    try {
      const s = await API.get("/api/settings");
      $("#tx-tagline").value = s.tagline_fallback || "";
      $("#tx-foot").value = s.foot || "";
    } catch {}
  }
  $("#tx-save-btn").addEventListener("click", async () => {
    try { await API.post("/api/admin/settings", { tagline_fallback: $("#tx-tagline").value.trim(), foot: $("#tx-foot").value.trim() }, ss.get(T)); flash($("#tx-save-btn")); }
    catch (e) { alert(e); }
  });

  function item(value, i, onEdit, onDelete) {
    const li = document.createElement("li");
    li.className = "edit-item";
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    input.addEventListener("change", async () => {
      const v = input.value.trim();
      if (v && v !== value) try { await onEdit(v); } catch (e) { alert(e); }
    });
    const bEdit = document.createElement("button");
    bEdit.className = "btn-edit";
    bEdit.textContent = "[v]";
    bEdit.title = "сохранить";
    bEdit.addEventListener("click", () => input.blur());
    const bDel = document.createElement("button");
    bDel.className = "btn-del";
    bDel.textContent = "[x]";
    bDel.title = "удалить";
    bDel.addEventListener("click", onDelete);
    li.appendChild(input);
    li.appendChild(bEdit);
    li.appendChild(bDel);
    return li;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const alert = (e) => window.alert("ошибка: " + (e.message || e));
  function flash(btn) {
    const o = btn.textContent;
    btn.textContent = "[ok]";
    btn.disabled = true;
    setTimeout(() => { btn.textContent = o; btn.disabled = false; }, 900);
  }

  $("#admin-close").addEventListener("click", close);
  $("#admin-login-btn").addEventListener("click", login);
  pass.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) close(); });

  window.SH_ADMIN = { open, close };
})();
