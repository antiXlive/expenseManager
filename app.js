/* ===========================================================================
   Expense Manager - app.js
   Refactor Level: A3 (Full premium refactor)
   + Integrated WebAuthn passkey (platform authenticator)
   =========================================================================== */

"use strict";

/* ===========================================================================
   SECTION 0 — CONSTANTS, GLOBAL STATE & SHORTHANDS
   =========================================================================== */

const KEY = "expMgrMobileDarkV1";

/* Backup constants */
const BACKUP_DB = "expenseBackupDB";
const BACKUP_STORE = "meta";
const BACKUP_KEY = "backupFile";

/* WebAuthn passkey storage key */
const PASSKEY_ID = "expMgr_biometric_passkey";

/* App state */
let state = {
  tx: [],
  cats: {},
  settings: {
    pinHash: null,
    bio: false,
    lastBackupTS: null
  }
};

/* transient control vars */
let editId = null;
let editCatId = null;
let periodMode = "month"; // "month" | "year"
let periodOffset = 0;
let chart = null;

let selectedCatId = null;
let selectedSubId = null;
let lastCatClick = 0;


/* backup handle + helper state */
let backupHandle = null;
let backupBusy = false;
let tempSubcats = [];
let prevSubIds = [];
let currentCatIdForSheet = null;

/* shorthand DOM helpers (safe) */
const $ = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const exists = (el) => !!el;
const safeText = (sel, txt) => { const e = $(sel); if (e) e.textContent = txt; };
const safeHTML = (sel, html) => { const e = $(sel); if (e) e.innerHTML = html; };
const safeAddEvent = (sel, ev, fn) => { const e = $(sel); if (e) e.addEventListener(ev, fn); };

/* ===========================================================================
   SECTION 1 — UTILITIES: Date, Format & Helpers
   =========================================================================== */

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${da}`;
}
function monthDate(off) {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth() + off, 1);
}
function yearDate(off) {
  const n = new Date();
  return new Date(n.getFullYear() + off, 0, 1);
}
function sameMonth(ds, md) {
  const d = new Date(ds);
  return d.getFullYear() === md.getFullYear() && d.getMonth() === md.getMonth();
}
function sameYear(ds, yd) {
  const d = new Date(ds);
  return d.getFullYear() === yd.getFullYear();
}
function fmt(n) {
  n = Number(n) || 0;
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function fmtTime(ts) {
  if (!ts) return "Never";
  const d = new Date(ts);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/* simple hash for PIN (non-cryptographic, consistent with original) */
function hashPin(pin) {
  return btoa(pin.split("").reverse().join(""));
}

/* storage helpers */
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error("[save] localStorage failed:", e);
  }
}
function load() {
  try {
    const r = localStorage.getItem(KEY);
    if (!r) return;
    const p = JSON.parse(r);
    if (p.tx) state.tx = p.tx;
    if (p.cats) state.cats = p.cats;
    if (p.settings) {
      state.settings.pinHash = p.settings.pinHash || null;
      state.settings.bio = !!p.settings.bio;
      state.settings.lastBackupTS = p.settings.lastBackupTS || null;
    }
  } catch (e) {
    console.error("[load] parse error:", e);
  }
}

/* default categories (only if none exist) */
function defaultCats() {
  if (Object.keys(state.cats).length) return;
  const d = [
    { id: "food", n: "Food & Drinks", e: "🍕", subs: ["Groceries 🛒", "Dining Out 🍽"] },
    { id: "shop", n: "Shopping", e: "🛍️", subs: ["Online", "Offline"] },
    { id: "trans", n: "Transport", e: "🚗", subs: ["Cab 🚕", "Fuel ⛽"] },
    { id: "health", n: "Health", e: "💊", subs: ["Doctor", "Medicines"] },
  ];
  d.forEach(c => {
    state.cats[c.id] = {
      id: c.id,
      name: c.n,
      emoji: c.e,
      subs: c.subs.map((s, i) => ({ id: c.id + "-s" + i, name: s }))
    };
  });
}

/* ===========================================================================
   SECTION 2 — BACKUP: IndexedDB + FileHandle Helpers
   =========================================================================== */

function openBackupDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(BACKUP_DB, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(BACKUP_STORE)) {
          db.createObjectStore(BACKUP_STORE);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}
async function saveBackupHandle(handle) {
  const db = await openBackupDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, "readwrite");
    tx.objectStore(BACKUP_STORE).put(handle, BACKUP_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}
async function loadBackupHandle() {
  const db = await openBackupDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, "readonly");
    const req = tx.objectStore(BACKUP_STORE).get(BACKUP_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

/* UI for backup banner/labels */
function showBackupBanner(message) {
  const banner = $("#backup-banner");
  const text = $("#backup-banner-text");
  if (!banner || !text) return;
  text.textContent = message;
  banner.classList.remove("hidden");
}
function hideBackupBanner() {
  const banner = $("#backup-banner");
  if (!banner) return;
  banner.classList.add("hidden");
}
function updateBackupLabel() {
  const label = $("#backup-file-label");
  const last = $("#backup-last");
  if (!label) return;
  label.textContent = backupHandle ? (backupHandle.name || "Backup file selected") : "No file selected";
  if (last) last.textContent = "Last backup: " + fmtTime(state.settings.lastBackupTS);
}

async function chooseBackupFile() {
  if (!("showSaveFilePicker" in window)) {
    alert("Auto backup is only supported in Chromium browsers (Chrome/Edge) with HTTPS or localhost.");
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: "expense-backup.json",
      types: [{
        description: "JSON file",
        accept: { "application/json": [".json"] }
      }]
    });
    backupHandle = handle;
    await saveBackupHandle(handle);
    hideBackupBanner();
    updateBackupLabel();
    await saveBackup("Initial backup after selecting file");
    alert("Backup file configured and initial backup created.");
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("[Backup] choose failed:", e);
      alert("Could not select backup file.");
    }
  }
}

async function saveBackup(reason) {
  if (!backupHandle) return;
  if (backupBusy) return;
  backupBusy = true;
  try {
    const perm = await backupHandle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") throw new Error("permission_revoked");
    const writable = await backupHandle.createWritable();
    await writable.write(JSON.stringify(state, null, 2));
    await writable.close();
    state.settings.lastBackupTS = Date.now();
    save();
    updateBackupLabel();
    console.log("[Backup] Saved:", reason || "(no reason)");
  } catch (e) {
    if (e.message === "permission_revoked" || e.name === "NotAllowedError" || e.name === "SecurityError") {
      showBackupBanner("Auto-backup lost access to your backup file. Tap Fix to choose again.");
      backupHandle = null;
      try { await saveBackupHandle(null); } catch (_) { }
      updateBackupLabel();
    } else {
      console.error("[Backup] Failed:", e);
    }
  } finally {
    backupBusy = false;
  }
}

function triggerBackup(reason) {
  if (!backupHandle) return;
  saveBackup(reason);
}
function shouldDailyBackup() {
  if (!backupHandle) return false;
  if (!state.settings.lastBackupTS) return true;
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  return now - state.settings.lastBackupTS > DAY;
}
async function checkDailyBackup() {
  if (shouldDailyBackup()) {
    await saveBackup("Automatic daily backup on app open/focus");
  }
}

/* ===========================================================================
   SECTION 3 — PERIOD HELPERS (month/year tx filtering)
   =========================================================================== */

function getPeriodTx() {
  if (periodMode === "month") {
    const md = monthDate(periodOffset);
    return state.tx.filter(t => sameMonth(t.date, md)).sort((a, b) => new Date(b.date) - new Date(a.date));
  } else {
    const yd = yearDate(periodOffset);
    return state.tx.filter(t => sameYear(t.date, yd)).sort((a, b) => new Date(b.date) - new Date(a.date));
  }
}

/* mLabel safely updates month/year UI labels and card subtitles */
function mLabel() {
  const mm = $("#m-main");
  const ms = $("#m-sub");
  if (!mm || !ms) return;

  if (periodMode === "month") {
    const md = monthDate(periodOffset);
    const monthShort = md.toLocaleString("en-IN", { month: "short" });
    mm.textContent = `${monthShort} ${md.getFullYear()}`;

    let t = "";
    if (periodOffset === 0) t = "This month";
    else if (periodOffset === -1) t = "Previous month";
    else if (periodOffset === 1) t = "Next month";
    else t = (periodOffset < 0 ? Math.abs(periodOffset) + " months ago" : periodOffset + " months ahead");
    ms.textContent = t;
  } else {
    const yd = yearDate(periodOffset);
    const y = yd.getFullYear();
    mm.textContent = `${y}`;
    let t = "";
    if (periodOffset === 0) t = "This year";
    else if (periodOffset === -1) t = "Previous year";
    else if (periodOffset === 1) t = "Next year";
    else t = (periodOffset < 0 ? Math.abs(periodOffset) + " years ago" : periodOffset + " years ahead");
    ms.textContent = t;
  }

  /* update labels on cards safely */
  const sLabel = $("#sum-label"); if (sLabel) sLabel.textContent = periodMode === "month" ? "Month balance" : "Year balance";
  const statsSub = $("#stats-sub"); if (statsSub) statsSub.textContent = periodMode === "month" ? "Selected month summary" : "Selected year summary";
  const catSub = $("#cat-sub"); if (catSub) catSub.textContent = periodMode === "month" ? "Expenses this month" : "Expenses this year";
}

/* ===========================================================================
   SECTION 4 — HOME RENDERING
   =========================================================================== */

function renderHome() {
  const list = $("#home-list");
  if (!list) return;

  const mt = getPeriodTx();
  let inc = 0, exp = 0;

  mt.forEach(t => {
    const a = Number(t.amount) || 0;
    if (t.type === "income") inc += a; else exp += a;
  });

  const incEl = $("#h-inc"); if (incEl) incEl.textContent = fmt(inc);
  const expEl = $("#h-exp"); if (expEl) expEl.textContent = fmt(exp);

  const bal = inc - exp;
  const hb = $("#h-bal");
  if (hb) {
    hb.textContent = fmt(bal);
    hb.classList.remove("pos", "neg");
    if (bal > 0) hb.classList.add("pos");
    else if (bal < 0) hb.classList.add("neg");
  }

  if (!mt.length) {
    list.innerHTML = '<div class="empty">No entries for this period. Tap + to add.</div>';
    return;
  }

  /* group by date */
  const groups = {};
  mt.forEach(t => (groups[t.date] || (groups[t.date] = [])).push(t));
  const dates = Object.keys(groups).sort((a, b) => new Date(b) - new Date(a));
  list.innerHTML = "";

  dates.forEach(ds => {
    const g = document.createElement("div");
    g.className = "day-group";

    const h = document.createElement("div");
    h.className = "day-head";

    const d = new Date(ds);
    const m = document.createElement("div");
    m.className = "day-main";
    m.textContent = d.toLocaleString("en-IN", { weekday: "short", day: "2-digit", month: "short" });

    const s = document.createElement("div");
    s.className = "day-sub";

    let di = 0, de = 0;
    groups[ds].forEach(t => {
      const a = Number(t.amount) || 0;
      if (t.type === "income") di += a; else de += a;
    });
    s.textContent = `Inc ${fmt(di)} · Exp ${fmt(de)}`;

    h.appendChild(m); h.appendChild(s); g.appendChild(h);

    groups[ds].forEach(t => {
      const c = document.createElement("div");
      c.className = "tx-card";
      c.addEventListener("click", () => openEntrySheet(t.id));

      const l = document.createElement("div"); l.className = "tx-l";
      const ic = document.createElement("div"); ic.className = "tx-icon";
      const cat = state.cats[t.catId];
      let em = t.catEmoji || "💸";
      if (cat) em = cat.emoji || em;
      ic.textContent = em;

      const main = document.createElement("div"); main.className = "tx-main";
      const ti = document.createElement("div"); ti.className = "tx-title";
      let title = cat ? cat.name : "Other";
      if (t.subId && cat) {
        const sb = cat.subs.find(su => su.id === t.subId);
        if (sb) title += " · " + sb.name;
      }
      ti.textContent = title;

      const no = document.createElement("div"); no.className = "tx-note";
      no.textContent = t.note || "No note";

      main.appendChild(ti); main.appendChild(no);

      l.appendChild(ic); l.appendChild(main);

      const r = document.createElement("div"); r.className = "tx-r";
      const am = document.createElement("div");
      const a = Number(t.amount) || 0;
      am.textContent = fmt(a);
      am.className = t.type === "income" ? "pos" : "neg";
      r.appendChild(am);

      c.appendChild(l); c.appendChild(r);
      g.appendChild(c);
    });

    list.appendChild(g);
  });
}
/* ===========================================================================
   SECTION 5 — STATS & CHARTS
   =========================================================================== */

/* Helper: break a category down into its subcategories totals */
function expandSubCats(catId, tx, total) {
  const cat = state.cats[catId];
  if (!cat) return [{ name: "Other", amt: total }];
  const map = {};
  cat.subs.forEach(s => map[s.id] = { name: s.name, amt: 0 });
  let other = 0;
  tx.filter(t => t.catId === catId && t.type === "expense").forEach(t => {
    const a = Number(t.amount) || 0;
    if (map[t.subId]) map[t.subId].amt += a;
    else other += a;
  });
  const arr = Object.values(map).filter(x => x.amt > 0);
  if (other > 0) arr.push({ name: "Other", amt: other });
  return arr.sort((a, b) => b.amt - a.amt);
}

/* Chart plugin for leader lines and internal percentages (kept original behavior) */
const leaderLinePlugin = {
  id: "leaderLines",
  afterDraw(chart, args, opts) {
    const { ctx, chartArea } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;
    const ds = chart.data.datasets[0];
    const total = ds.data.reduce((a, b) => a + b, 0);
    if (!total) return;

    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;

    ctx.save();
    ctx.font = "11px system-ui";

    meta.data.forEach((arc, i) => {
      const val = ds.data[i];
      if (!val) return;
      const label = chart.data.labels[i];
      const pct = Math.round((val * 100) / total);
      const angle = (arc.startAngle + arc.endAngle) / 2;
      const outerRadius = arc.outerRadius;
      const innerRadius = arc.innerRadius;

      const lineStartX = cx + Math.cos(angle) * (outerRadius * 0.9);
      const lineStartY = cy + Math.sin(angle) * (outerRadius * 0.9);
      const lineMidX = cx + Math.cos(angle) * (outerRadius + 12);
      const lineMidY = cy + Math.sin(angle) * (outerRadius + 12);
      const onLeftSide = (angle > Math.PI / 2 || angle < -Math.PI / 2);
      const horizontalOffset = onLeftSide ? -28 : 28;
      const lineEndX = lineMidX + horizontalOffset;
      const lineEndY = lineMidY;

      ctx.strokeStyle = (opts && opts.color) || "#4b5563";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lineStartX, lineStartY);
      ctx.lineTo(lineMidX, lineMidY);
      ctx.lineTo(lineEndX, lineEndY);
      ctx.stroke();

      ctx.fillStyle = (opts && opts.textColor) || "#e5e7eb";
      ctx.textBaseline = "middle";
      ctx.textAlign = onLeftSide ? "right" : "left";
      const text = `${label}  ${fmt(val)}`;
      ctx.fillText(text, lineEndX, lineEndY);

      const labelRadius = innerRadius + (outerRadius - innerRadius) * 0.5;
      const innerX = cx + Math.cos(angle) * labelRadius;
      const innerY = cy + Math.sin(angle) * labelRadius;
      ctx.font = "10px system-ui";
      ctx.fillStyle = "#f9fafb";
      ctx.textAlign = "center";
      ctx.fillText(pct + "%", innerX, innerY);
      ctx.font = "11px system-ui";
    });

    ctx.restore();
  }
};

function renderStats() {
  const mt = getPeriodTx();
  let inc = 0, exp = 0;
  mt.forEach(t => {
    const a = Number(t.amount) || 0;
    t.type === "income" ? inc += a : exp += a;
  });

  const sInc = $("#s-inc"); if (sInc) sInc.textContent = fmt(inc);
  const sExp = $("#s-exp"); if (sExp) sExp.textContent = fmt(exp);
  const bal = inc - exp;
  const sBal = $("#s-bal");
  if (sBal) {
    sBal.textContent = fmt(bal);
    sBal.classList.remove("pos", "neg");
    if (bal > 0) sBal.classList.add("pos");
    else if (bal < 0) sBal.classList.add("neg");
  }
  const sCnt = $("#s-cnt"); if (sCnt) sCnt.textContent = mt.length;

  const canvas = $("#chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const expTx = mt.filter(t => t.type === "expense");
  const byCat = {};
  expTx.forEach(t => {
    const c = state.cats[t.catId];
    const key = t.catId || "other";
    if (!byCat[key]) byCat[key] = { amt: 0, cat: c };
    byCat[key].amt += (Number(t.amount) || 0);
  });

  const labels = [], data = [], colors = [];
  const base = ["#38bdf8", "#a855f7", "#f97316", "#22c55e", "#facc15", "#fb7185", "#2dd4bf", "#4f46e5"];
  let i = 0, totalExp = 0;
  Object.keys(byCat).forEach(k => {
    const v = byCat[k];
    if (!v.amt) return;
    totalExp += v.amt;
    labels.push(v.cat ? v.cat.name : "Other");
    data.push(v.amt);
    colors.push(base[i++ % base.length]);
  });

  if (chart) try { chart.destroy(); } catch (e) { /* ignore */ }
  const cl = $("#cat-list");

  if (!data.length) {
    chart = new Chart(ctx, {
      type: "doughnut",
      data: { labels: ["No data"], datasets: [{ data: [1], backgroundColor: ["#1f2937"], borderWidth: 0 }] },
      options: { plugins: { legend: { display: false }, tooltip: { enabled: false } }, cutout: "65%" }
    });
    if (cl) cl.innerHTML = '<div class="empty">No expense data for this period.</div>';
    return;
  }

  chart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: "#020617",
        hoverOffset: 6,
        spacing: 2
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(ctx.raw)}` } }
      },
      layout: { padding: 32 },
      cutout: "55%"
    },
    plugins: [leaderLinePlugin]
  });

  if (cl) cl.innerHTML = "";
  const catKeys = Object.keys(byCat).filter(k => byCat[k].amt > 0).sort((a, b) => byCat[b].amt - byCat[a].amt);
  catKeys.forEach((k, idx) => {
    const v = byCat[k];
    const pct = Math.round(v.amt * 100 / totalExp);

    const item = document.createElement("div"); item.className = "cat-item";
    const head = document.createElement("div"); head.className = "cat-head";
    const l = document.createElement("div"); l.className = "cat-l";
    const ic = document.createElement("div"); ic.className = "cat-ic";
    ic.textContent = v.cat && v.cat.emoji ? v.cat.emoji : "💸";

    const nm = document.createElement("div"); nm.className = "cat-name"; nm.textContent = v.cat ? v.cat.name : "Other";
    const pr = document.createElement("div"); pr.className = "cat-per"; pr.textContent = pct + "%";

    const twrap = document.createElement("div"); twrap.style.display = "flex"; twrap.style.flexDirection = "column";
    twrap.appendChild(nm); twrap.appendChild(pr);

    l.appendChild(ic); l.appendChild(twrap);

    const rv = document.createElement("div"); rv.className = "cat-val";
    const s1 = document.createElement("div"); s1.className = "cat-amt"; s1.textContent = fmt(v.amt);
    rv.appendChild(s1);

    const tg = document.createElement("div"); tg.className = "cat-toggle"; tg.textContent = "▾";

    head.appendChild(l); head.appendChild(rv); head.appendChild(tg);

    const subBox = document.createElement("div"); subBox.className = "sub-list";
    const subs = expandSubCats(k, expTx, v.amt);
    subs.forEach(s => {
      const r = document.createElement("div"); r.className = "sub-row";
      const l1 = document.createElement("span"); l1.textContent = s.name;
      const r1 = document.createElement("span"); r1.textContent = `${fmt(s.amt)} · ${Math.round(s.amt * 100 / v.amt)}%`;
      r.appendChild(l1); r.appendChild(r1);
      subBox.appendChild(r);
    });

    item.appendChild(head); item.appendChild(subBox);
    head.addEventListener("click", () => {
      const vis = subBox.style.display === "block";
      subBox.style.display = vis ? "none" : "block";
      tg.textContent = vis ? "▾" : "▴";
    });
    if (idx === 0) subBox.style.display = "block";
    if (cl) cl.appendChild(item);
  });
}

/* ===========================================================================
   SECTION 6 — SHEET (ENTRY) HELPERS
   =========================================================================== */

function openSheet(id) { const el = $(id); if (el) el.classList.add("active"); }
function closeSheet(id) { const el = $(id); if (el) el.classList.remove("active"); }

/* fill category select safely */
function fillCatSelect() {
  const sel = $("#e-cat"), sub = $("#e-subcat");
  if (!sel || !sub) return;
  sel.innerHTML = "";
  const opt = document.createElement("option"); opt.value = ""; opt.textContent = "Select"; sel.appendChild(opt);
  Object.values(state.cats).forEach(c => {
    const o = document.createElement("option"); o.value = c.id; o.textContent = (c.emoji || "") + " " + c.name; sel.appendChild(o);
  });
  sub.innerHTML = "";
  const o2 = document.createElement("option"); o2.value = ""; o2.textContent = "None"; sub.appendChild(o2);
}

function fillSubSelect(catId) {
  const sub = $("#e-subcat");
  if (!sub) return;
  sub.innerHTML = "";
  const o = document.createElement("option"); o.value = ""; o.textContent = "None"; sub.appendChild(o);
  const c = state.cats[catId];
  if (!c) return;
  c.subs.forEach(s => { const o2 = document.createElement("option"); o2.value = s.id; o2.textContent = s.name; sub.appendChild(o2); });
}

/* ENTRY SHEET: open for add/edit */
function openEntrySheet(id) {
  editId = id || null;
  const f = $("#entry-form");
  if (f) f.reset();
  const typeEl = $("#e-type"); if (typeEl) typeEl.value = "expense";
  const dateEl = $("#e-date"); if (dateEl) dateEl.value = todayISO();
  fillCatSelect();
  const sub = $("#e-subcat"); if (sub) sub.innerHTML = '<option value="">None</option>';
  const delBtn = $("#entry-del"); if (delBtn) delBtn.style.display = id ? "inline-flex" : "none";
  const saveBtn = $("#entry-save"); if (saveBtn) saveBtn.textContent = id ? "Save" : "Add";
  const title = $("#entry-title"); if (title) title.textContent = id ? "Edit entry" : "Add entry";

  if (id) {
    const t = state.tx.find(x => x.id === id);
    if (!t) return;
    const eType = $("#e-type"); if (eType) eType.value = t.type;
    const eAmt = $("#e-amt"); if (eAmt) eAmt.value = t.amount;
    const eDate = $("#e-date"); if (eDate) eDate.value = t.date;
    const eNote = $("#e-note"); if (eNote) eNote.value = t.note || "";
    if (t.catId) {
      const eCat = $("#e-cat"); if (eCat) eCat.value = t.catId;
      fillSubSelect(t.catId);
      const eSub = $("#e-subcat"); if (eSub && t.subId) eSub.value = t.subId;
    }
  } else {
    const eDate = $("#e-date"); if (eDate) eDate.value = todayISO();
  }

  openSheet("#sheet-entry");
}

function deleteEntry() {
  if (!editId) return;
  const idx = state.tx.findIndex(t => t.id === editId);
  if (idx === -1) return;
  if (!confirm("Delete this entry?")) return;
  state.tx.splice(idx, 1);
  save();
  triggerBackup("Entry deleted");
  editId = null;
  closeSheet("#sheet-entry");
  rerender();
}

/* ===========================================================================
   SECTION 7 — CATEGORY MANAGER & SHEET
   =========================================================================== */

function renderCatMgr() {
  const box = $("#cat-mgr");
  if (!box) return;
  if (!Object.keys(state.cats).length) {
    box.innerHTML = '<div class="empty">No categories. Add one.</div>';
    return;
  }
  box.innerHTML = "";
  Object.values(state.cats).forEach(c => {
    const card = document.createElement("div"); card.className = "cat-card";
    const head = document.createElement("div"); head.className = "cat-card-head";
    const left = document.createElement("div"); left.className = "cat-card-left";
    const ic = document.createElement("div"); ic.className = "cat-ic"; ic.textContent = c.emoji || "💸";
    const main = document.createElement("div"); main.className = "cat-card-main";
    const nm = document.createElement("div"); nm.className = "cat-card-name"; nm.textContent = c.name;
    const sb = document.createElement("div"); sb.className = "cat-card-sub"; sb.textContent = c.subs.length ? c.subs.map(s => s.name).join(", ") : "No subcategories";
    main.appendChild(nm); main.appendChild(sb);
    left.appendChild(ic); left.appendChild(main);

    const btns = document.createElement("div"); btns.className = "cat-card-btns";
    const b1 = document.createElement("button"); b1.className = "btn btn-ghost small"; b1.textContent = "Edit";
    b1.onclick = () => openCatSheet(c.id);
    btns.appendChild(b1);

    head.appendChild(left); head.appendChild(btns);
    card.appendChild(head);
    box.appendChild(card);
  });
}

function renderSubcatList() {
  const box = $("#subcat-list");
  if (!box) return;
  box.innerHTML = "";
  tempSubcats.forEach(s => {
    const pill = document.createElement("div"); pill.className = "subcat-pill";
    const name = document.createElement("span"); name.className = "subcat-name"; name.textContent = s.name;
    const del = document.createElement("button"); del.type = "button"; del.className = "subcat-del"; del.textContent = "×";
    del.dataset.id = s.id;
    pill.appendChild(name); pill.appendChild(del);
    box.appendChild(pill);
  });
}

function openCatSheet(id) {
  editCatId = id || null;
  const c = id ? state.cats[id] : null;
  currentCatIdForSheet = c ? c.id : null;
  prevSubIds = c ? c.subs.map(s => s.id) : [];
  tempSubcats = c ? c.subs.map(s => ({ id: s.id, name: s.name })) : [];
  const title = $("#cat-sheet-title"); if (title) title.textContent = id ? "Edit category" : "Add category";
  const emoji = $("#c-emoji"); if (emoji) emoji.value = c?.emoji || "";
  const name = $("#c-name"); if (name) name.value = c?.name || "";
  const input = $("#c-subcat-input"); if (input) input.value = "";
  const delBtn = $("#cat-del"); if (delBtn) delBtn.style.display = id ? "inline-flex" : "none";
  renderSubcatList();
  openSheet("#sheet-cat");
}

function saveCategory(e) {
  e.preventDefault();
  const nameEl = $("#c-name");
  if (!nameEl) return;
  const name = nameEl.value.trim();
  if (!name) { alert("Category name required"); return; }
  const emojiEl = $("#c-emoji"); const emoji = emojiEl ? emojiEl.value.trim() || "💸" : "💸";

  if (editCatId) {
    const id = editCatId;
    const removedIds = prevSubIds.filter(oldId => !tempSubcats.some(s => s.id === oldId));
    const subs = tempSubcats.map(s => ({ id: s.id, name: s.name }));
    state.cats[id] = { id, name, emoji, subs };
    if (removedIds.length) {
      state.tx.forEach(t => { if (t.catId === id && removedIds.includes(t.subId)) t.subId = null; });
    }
    save();
    triggerBackup("Category updated");
  } else {
    const id = "c" + Date.now();
    const subs = tempSubcats.map((s, i) => ({ id: id + "-s" + i, name: s.name }));
    state.cats[id] = { id, name, emoji, subs };
    save();
    triggerBackup("Category added");
  }

  editCatId = null;
  tempSubcats = [];
  prevSubIds = [];
  currentCatIdForSheet = null;
  closeSheet("#sheet-cat");
  rerender();
}

function deleteCategory() {
  if (!editCatId) return;
  const used = state.tx.some(t => t.catId === editCatId);
  if (used && !confirm("Some transactions use this category. Delete anyway?")) return;
  delete state.cats[editCatId];
  state.tx.forEach(t => { if (t.catId === editCatId) { t.catId = null; t.subId = null; } });
  save();
  triggerBackup("Category deleted");
  editCatId = null;
  tempSubcats = [];
  prevSubIds = [];
  currentCatIdForSheet = null;
  closeSheet("#sheet-cat");
  rerender();
}

/* ===========================================================================
   SECTION 8 — TABS, NAV & SWIPE
   =========================================================================== */

function setTab(t) {
  qa(".tab-page").forEach(x => x.classList.remove("tab-active"));
  const tab = $(`#tab-${t}`);
  if (tab) tab.classList.add("tab-active");
  qa(".nav-item").forEach(x => x.classList.remove("nav-active"));
  const btn = document.querySelector(`.nav-item[data-tab="${t}"]`);
  if (btn) btn.classList.add("nav-active");

  const fab = $("#fab"); if (fab) fab.classList.toggle("hidden", t !== "home");
  const mh = $("#month-header"); if (mh) mh.style.display = (t === "settings") ? "none" : "flex";

  if (t === "stats") renderStats();
}

function setupSwipe() {
  const area = $("#swipe");
  if (!area) return;
  let sx = 0, sy = 0, sw = false;
  const st = e => {
    const t = e.touches ? e.touches[0] : e;
    sx = t.clientX; sy = t.clientY; sw = true;
  };
  const ed = e => {
    if (!sw) return; sw = false;
    const t = e.changedTouches ? e.changedTouches[0] : e;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 80) return;
    const active = document.querySelector(".nav-item.nav-active");
    const tab = active ? active.dataset.tab : "home";
    if (tab === "settings") return;
    if (dx < 0) periodOffset++; else periodOffset--;
    rerender();
  };
  area.addEventListener("touchstart", st, { passive: true });
  area.addEventListener("touchend", ed);
  area.addEventListener("mousedown", st);
  area.addEventListener("mouseup", ed);
}

/* ===========================================================================
   SECTION 9 — WEBAUTHN (PASSKEY) HELPERS
   =========================================================================== */

/* Binary / base64url helpers */
function randomBuf(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr.buffer;
}
function toB64(buf) {
  // ArrayBuffer -> base64url
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64(b64) {
  // base64url -> ArrayBuffer
  b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const str = atob(b64);
  const u = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i);
  return u.buffer;
}

/* Register a new platform credential (user gesture required) */
async function registerBiometricKey() {
  if (!("credentials" in navigator) || !("create" in navigator.credentials)) {
    console.warn("WebAuthn not supported");
    return { success: false, error: "not_supported" };
  }

  try {
    // user.id should be an ArrayBuffer (16+ bytes). Use random id for local user.
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);

    const publicKey = {
      challenge: randomBuf(32),
      rp: { name: "Expense Manager" },
      user: {
        id: userId,
        name: "local",
        displayName: "Local User"
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required"
      },
      timeout: 60000,
      attestation: "none"
    };

    const cred = await navigator.credentials.create({ publicKey });

    if (!cred) throw new Error("no_credential_created");
    const rawId = cred.rawId;
    const idB64 = toB64(rawId);
    localStorage.setItem(PASSKEY_ID, idB64);

    console.log("Passkey created and stored:", idB64);
    return { success: true, id: idB64 };
  } catch (err) {
    console.error("registerBiometricKey error:", err);
    return { success: false, error: err };
  }
}

/* Authenticate using stored credential (user gesture required to prompt) */
async function biometricUnlock() {
  const stored = localStorage.getItem(PASSKEY_ID);
  if (!stored) return { success: false, error: "no_passkey" };

  if (!("credentials" in navigator) || !("get" in navigator.credentials)) {
    return { success: false, error: "not_supported" };
  }

  try {
    const publicKey = {
      challenge: randomBuf(32),
      allowCredentials: [{
        id: fromB64(stored),
        type: "public-key",
        transports: ["internal"]
      }],
      userVerification: "required",
      timeout: 60000
    };

    const assertion = await navigator.credentials.get({ publicKey });

    if (!assertion) throw new Error("no_assertion");
    return { success: true, assertion };
  } catch (err) {
    console.warn("biometricUnlock failed:", err);
    return { success: false, error: err };
  }
}

/* ===========================================================================
   SECTION 10 — BIOMETRICS & LOCK SCREEN (setupLock integration)
   =========================================================================== */

function canUseBio() {
  return "PublicKeyCredential" in window && (location.protocol === "https:" || location.hostname === "localhost");
}

/* update biometrics toggle row UI (safe) */
function updateBioRow() {
  const row = $("#bio-row"), btn = $("#btn-toggle-bio");
  if (!row || !btn) return;
  if (!canUseBio()) { row.style.display = "none"; return; }
  row.style.display = "flex";
  btn.textContent = state.settings.bio ? "Disable" : "Enable";
}

/* lock screen setup — safe with guards and WebAuthn wiring */
function setupLock() {
  const ls = $("#lock");
  const pins = qa(".pin-inputs input");
  const main = $("#lock-main-btn");
  const alt = $("#lock-alt-btn");
  const ttl = $("#lock-title");
  const sub = $("#lock-sub");
  const note = $("#lock-note");

  function getPin() { return Array.from(pins).map(i => i.value).join(""); }
  pins.forEach((p, i) => {
    p.addEventListener("input", () => { if (p.value && i < pins.length - 1) pins[i + 1].focus(); });
    p.addEventListener("keydown", e => { if (e.key === "Backspace" && !p.value && i > 0) pins[i - 1].focus(); });
  });
  function clearPins() { pins.forEach(p => { p.value = ""; }); if (pins[0]) pins[0].focus(); }

  const havePin = !!state.settings.pinHash;
  if (ttl) ttl.textContent = havePin ? "Enter PIN" : "Set PIN";
  if (sub) sub.textContent = havePin ? "Unlock to view your expenses." : "Create a 4-digit PIN to protect your expenses.";
  if (main) main.textContent = havePin ? "Unlock" : "Save PIN";
  if (note) note.textContent = havePin ? "Forgot PIN? Clear browser data to reset app (this deletes all data)." : "You can enable biometrics later from Settings (HTTPS & supported browser).";

  if (havePin && canUseBio() && alt) {
    alt.classList.remove("hidden");
    alt.textContent = state.settings.bio ? "Use biometrics" : "Try biometrics";
  } else if (alt) {
    alt.classList.add("hidden");
  }

  if (main) {
    main.onclick = () => {
      const pin = getPin();
      if (pin.length !== 4) { alert("Enter 4 digits."); return; }
      if (!havePin) {
        state.settings.pinHash = hashPin(pin);
        save();
        if (ls) ls.classList.add("hidden");
      } else {
        if (hashPin(pin) === state.settings.pinHash) {
          if (ls) ls.classList.add("hidden");
        } else {
          alert("Wrong PIN.");
          clearPins();
          return;
        }
      }
      rerender();
    };
  }

  if (alt) {
    alt.onclick = async () => {
      // Trigger WebAuthn-based biometric unlock
      const res = await biometricUnlock();
      if (res.success) {
        if (ls) ls.classList.add("hidden");
        rerender();
        // ensure bio flag saved if not already
        if (!state.settings.bio) {
          state.settings.bio = true;
          save();
          updateBioRow();
        }
      } else {
        if (res.error === "no_passkey") {
          const want = confirm("No biometric credential found. Set up now?");
          if (want) {
            const r = await registerBiometricKey();
            if (r.success) {
              alert("Biometric set up. Try unlocking again.");
              updateBioRow();
            } else {
              alert("Biometric setup failed.");
            }
          }
        } else {
          console.log("Biometric failed:", res.error);
          alert("Biometric authentication failed or was cancelled.");
        }
      }
    };
  }

  clearPins();
}
/* ===========================================================================
   SECTION 11 — RERENDER & INIT
   =========================================================================== */

function rerender() {
  mLabel();
  renderHome();
  const active = document.querySelector(".nav-item.nav-active");
  if (active && active.dataset.tab === "stats") renderStats();
  renderCatMgr();
}

/* ===========================================================================
   SECTION 12 — BOOTSTRAP: Wiring event listeners + init
   =========================================================================== */


/* ======== Category Picker Helpers (added UX) ======== */
function renderCategoryPicker() {
  const left = $("#picker-cats");
  const right = $("#picker-subs");
  if (!left || !right) return;
  left.innerHTML = '';
  right.innerHTML = '<div class="empty">Select a category</div>';
  Object.values(state.cats).forEach(c => {
    const item = document.createElement('div');
    item.className = 'picker-item';
    item.dataset.id = c.id;
    item.innerHTML = `<div style="width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center">${c.emoji || '💸'}</div><div style="flex:1;min-width:0;font-weight:600;">${c.name}</div>`;
    item.addEventListener('click', (e) => {
      const now = Date.now();
      const isDouble = (now - lastCatClick) < 350 && lastCatClick !== 0 && selectedCatId === c.id;
      lastCatClick = now;
      qa('.picker-item').forEach(x => x.classList.remove('active'));
      item.classList.add('active');
      selectedCatId = c.id;
      selectedSubId = null;
      if (isDouble) {
        const inp = $('#e-category');
        if (inp) { inp.value = c.name; inp.dataset.cat = c.id; inp.dataset.sub = ''; }
        closeCategoryPicker();
        return;
      }
      right.innerHTML = '';
      if (!c.subs || !c.subs.length) {
        right.innerHTML = '<div class="empty">No subcategories</div>';
      } else {
        c.subs.forEach(s => {
          const sub = document.createElement('div');
          sub.className = 'picker-sub';
          sub.dataset.id = s.id;
          sub.textContent = s.name;
          sub.addEventListener('click', () => {
            selectedSubId = s.id;
            const inp = $('#e-category');
            if (inp) { inp.value = (c.emoji ? c.emoji + ' ' : '') + c.name + ' · ' + s.name; inp.dataset.cat = c.id; inp.dataset.sub = s.id; }
            closeCategoryPicker();
          });
          right.appendChild(sub);
        });
      }
    });
    left.appendChild(item);
  });
}
function openCategoryPicker() { const bg = $('#category-picker'); if (!bg) return; bg.classList.remove('hidden'); renderCategoryPicker(); }
function closeCategoryPicker() { const bg = $('#category-picker'); if (!bg) return; bg.classList.add('hidden'); }

/* ======== Override openEntrySheet to auto-focus amount and populate category from selection ======== */
function openEntrySheet(id) {
  editId = id || null;
  const f = $("#entry-form");
  if (f) f.reset();
  selectedCatId = null; selectedSubId = null;
  const amt = $("#e-amt"); if (amt) { amt.value = ''; setTimeout(() => amt.focus(), 80); }
  const dateEl = $("#e-date"); if (dateEl) dateEl.value = todayISO();
  const note = $("#e-note"); if (note) note.value = '';
  const catInp = $("#e-category"); if (catInp) { catInp.value = ''; delete catInp.dataset.cat; delete catInp.dataset.sub; }

  const delBtn = $("#entry-del"); if (delBtn) delBtn.style.display = id ? "inline-flex" : "none";
  const saveBtn = $("#entry-save"); if (saveBtn) saveBtn.textContent = id ? "Save" : "Add";
  const title = $("#entry-title"); if (title) title.textContent = id ? "Edit entry" : "Add entry";

  if (id) {
    const t = state.tx.find(x => x.id === id);
    if (!t) return;
    const eType = $("#e-type"); if (eType) eType.value = t.type;
    const eAmt = $("#e-amt"); if (eAmt) eAmt.value = t.amount;
    const eDate = $("#e-date"); if (eDate) eDate.value = t.date;
    const eNote = $("#e-note"); if (eNote) eNote.value = t.note || "";
    if (t.catId) {
      const cat = state.cats[t.catId];
      selectedCatId = t.catId;
      selectedSubId = t.subId || null;
      const catInp = $("#e-category");
      if (catInp) {
        catInp.value = cat ? (cat.emoji ? cat.emoji + ' ' : '') + cat.name + (t.subId ? ' · ' + ((cat.subs.find(s => s.id === t.subId) || {}).name || '') : '') : '';
        catInp.dataset.cat = t.catId;
        catInp.dataset.sub = t.subId || '';
      }
    }
  } else {
    const eDate = $("#e-date"); if (eDate) eDate.value = todayISO();
  }

  openSheet("#sheet-entry");
}
document.addEventListener("DOMContentLoaded", () => {
  /* load state */
  load();
  defaultCats();

  /* initial renders */
  mLabel();
  renderHome();
  renderCatMgr();

  /* UI wiring */
  setupSwipe();

  /* nav items */
  qa(".nav-item").forEach(n => n.addEventListener("click", () => setTab(n.dataset.tab)));

  /* FAB */
  const fab = $("#fab");
  if (fab) fab.onclick = () => openEntrySheet(null);

  /* entry sheet wiring */
  safeAddEvent("#e-cat", "change", (e) => fillSubSelect(e.target.value));
  if ($("#entry-close")) $("#entry-close").onclick = () => { editId = null; closeSheet("#sheet-entry"); };
  if ($("#entry-cancel")) $("#entry-cancel").onclick = () => { editId = null; closeSheet("#sheet-entry"); };
  if ($("#entry-del")) $("#entry-del").onclick = deleteEntry;

  /* entry form submit */
  const entryForm = $("#entry-form");
  if (entryForm) {
    entryForm.addEventListener("submit", ev => {
      ev.preventDefault();
      const type = $("#e-type") ? $("#e-type").value : "expense";
      const amt = Number($('#e-amt') ? $('#e-amt').value : 0);
      const catEl = $('#e-category');
      const catId = catEl ? (catEl.dataset.cat || null) : null;
      const subId = catEl ? (catEl.dataset.sub || null) : null;
      const date = $('#e-date') ? $('#e-date').value : todayISO();
      const note = $('#e-note') ? $('#e-note').value.trim() : '';
      if (!amt || amt <= 0) { alert('Enter valid amount.'); return; }
      if (!date) { alert('Select date.'); return; }
      if (editId) {
        const t = state.tx.find(x => x.id === editId);
        if (t) {
          t.type = type; t.amount = amt; t.catId = catId; t.subId = subId; t.date = date; t.note = note;
        }
      } else {
        state.tx.push({ id: Date.now().toString(), type, amount: amt, catId, subId, date, note });
      }
      save();
      triggerBackup('Entry added/updated');
      closeSheet('#sheet-entry');
      editId = null;
      rerender();
    });
  }
  save();
  triggerBackup("Entry added/updated");
  closeSheet("#sheet-entry");
  editId = null;
  rerender();
});

/* sheet background click to close */
const sheetEntry = $("#sheet-entry");
if (sheetEntry) sheetEntry.addEventListener("click", e => { if (e.target.id === "sheet-entry") { editId = null; closeSheet("#sheet-entry"); } });

/* category sheet wiring */
if ($("#cat-close")) $("#cat-close").onclick = () => { editCatId = null; tempSubcats = []; prevSubIds = []; currentCatIdForSheet = null; closeSheet("#sheet-cat"); };
const sheetCat = $("#sheet-cat");
if (sheetCat) sheetCat.addEventListener("click", e => { if (e.target.id === "sheet-cat") { editCatId = null; tempSubcats = []; prevSubIds = []; currentCatIdForSheet = null; closeSheet("#sheet-cat"); } });

if ($("#cat-form")) $("#cat-form").addEventListener("submit", saveCategory);
if ($("#cat-del")) $("#cat-del").onclick = deleteCategory;
if ($("#btn-add-cat")) $("#btn-add-cat").onclick = () => openCatSheet(null);

/* subcat add/remove */
const subAddBtn = $("#c-subcat-add");
const subInput = $("#c-subcat-input");
const subList = $("#subcat-list");
if (subAddBtn && subInput) {
  subAddBtn.onclick = () => {
    const val = subInput.value.trim();
    if (!val) return;
    let id;
    if (currentCatIdForSheet) id = currentCatIdForSheet + "-s" + Date.now();
    else id = "new-" + Date.now();
    tempSubcats.push({ id, name: val });
    subInput.value = "";
    renderSubcatList();
  };
}
if (subList) {
  subList.addEventListener("click", (e) => {
    const btn = e.target.closest(".subcat-del");
    if (!btn) return;
    const id = btn.dataset.id;
    tempSubcats = tempSubcats.filter(s => s.id !== id);
    renderSubcatList();
  });
}

/* month/year nav */
if ($("#m-prev")) $("#m-prev").onclick = () => { periodOffset--; rerender(); };
if ($("#m-next")) $("#m-next").onclick = () => { periodOffset++; rerender(); };
if ($("#mode-month")) $("#mode-month").onclick = () => { if (periodMode !== "month") { periodMode = "month"; periodOffset = 0; $("#mode-month")?.classList.add("seg-active"); $("#mode-year")?.classList.remove("seg-active"); rerender(); } };
if ($("#mode-year")) $("#mode-year").onclick = () => { if (periodMode !== "year") { periodMode = "year"; periodOffset = 0; $("#mode-year")?.classList.add("seg-active"); $("#mode-month")?.classList.remove("seg-active"); rerender(); } };

/* export/import/reset */
if ($("#btn-export")) $("#btn-export").onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "expense-backup.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const fileImport = $("#file-import");
if (fileImport) fileImport.addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if (!d || typeof d !== "object") { alert("Invalid file."); return; }
      if (!confirm("Import data and replace existing?")) return;
      state.tx = d.tx || [];
      state.cats = d.cats || {};
      state.settings = d.settings || state.settings;
      save();
      triggerBackup("Import data");
      rerender();
      alert("Import successful.");
    } catch (err) {
      alert("Could not import.");
    }
  };
  r.readAsText(f);
});

if ($("#btn-clear")) $("#btn-clear").onclick = () => {
  if (!confirm("Clear all data? This cannot be undone.")) return;
  state = { tx: [], cats: {}, settings: { pinHash: state.settings.pinHash, bio: false, lastBackupTS: null } };
  defaultCats();
  save();
  triggerBackup("Reset all data");
  rerender();
};

/* pin & biometric toggles */
if ($("#btn-change-pin")) $("#btn-change-pin").onclick = () => {
  state.settings.pinHash = null;
  save();
  const lockEl = $("#lock"); if (lockEl) lockEl.classList.remove("hidden");
  setupLock();
};

/* UPDATED: btn-toggle-bio now registers passkey if enabling */
if ($("#btn-toggle-bio")) {
  $("#btn-toggle-bio").onclick = async () => {
    // If enabling and no passkey exists, create it first
    if (!state.settings.bio) {
      const stored = localStorage.getItem(PASSKEY_ID);
      if (!stored) {
        const r = await registerBiometricKey();
        if (!r.success) return alert("Biometric setup failed or cancelled.");
      }
    }
    state.settings.bio = !state.settings.bio;
    save();
    updateBioRow();
    alert(state.settings.bio ? "Biometric enabled" : "Biometric disabled");
  };
}

/* backup UI wiring */
const chooseBtn = $("#btn-choose-backup");
const backupNowBtn = $("#btn-backup-now");
const fixBtn = $("#backup-fix");
const dismissBtn = $("#backup-dismiss");

if (chooseBtn) chooseBtn.onclick = () => chooseBackupFile();
if (backupNowBtn) backupNowBtn.onclick = () => { if (!backupHandle) { alert("Choose a backup file first."); return; } saveBackup("Manual backup"); };
if (fixBtn) fixBtn.onclick = () => chooseBackupFile();
if (dismissBtn) dismissBtn.onclick = () => hideBackupBanner();

if ("indexedDB" in window) {
  loadBackupHandle().then((handle) => {
    backupHandle = handle || null; updateBackupLabel(); if (backupHandle) checkDailyBackup();
  }).catch((e) => console.error("[Backup] load handle failed:", e));
} else {
  console.log("[Backup] IndexedDB not available");
}

window.addEventListener("focus", () => { if (backupHandle) checkDailyBackup(); });


/* --- New UX: date click and category picker wiring --- */
const dateEl = $('#e-date');
if (dateEl) {
  dateEl.addEventListener('click', (ev) => { ev.stopPropagation(); try { dateEl.showPicker && dateEl.showPicker(); } catch (e) { } dateEl.focus(); });
}
const catInp = $('#e-category');
if (catInp) {
  catInp.addEventListener('click', (e) => { openCategoryPicker(); });
}
const pickerClose = $('#picker-close');
if (pickerClose) pickerClose.onclick = () => closeCategoryPicker();
const pickerBg = $('#category-picker');
if (pickerBg) pickerBg.addEventListener('click', (e) => { if (e.target === pickerBg) closeCategoryPicker(); });
/* misc init */
updateBioRow();
fillCatSelect();
setupLock();

/* Optional: try auto-unlock with biometric if user enabled it.
   Note: some browsers require user gesture for navigator.credentials.get;
   this attempt is best-effort and will silently fail if blocked. */
if (state.settings.bio && localStorage.getItem(PASSKEY_ID)) {
  setTimeout(async () => {
    const res = await biometricUnlock();
    if (res.success) {
      const ls = $("#lock");
      if (ls) ls.classList.add("hidden");
      rerender();
    }
  }, 350);
}