"use strict";

const KEY = "expMgrMobileDarkV1";

// Backup constants
const BACKUP_DB = "expenseBackupDB";
const BACKUP_STORE = "meta";
const BACKUP_KEY = "backupFile";

let state = {
  tx: [],
  cats: {},
  settings: {
    pinHash: null,
    bio: false,
    lastBackupTS: null
  }
};

let editId = null;
let editCatId = null;
let periodMode = "month"; // "month" | "year"
let periodOffset = 0;     // month offset or year offset depending on mode
let chart = null;

// backup handle + temp category subcat state
let backupHandle = null;
let backupBusy = false;
let tempSubcats = [];
let prevSubIds = [];
let currentCatIdForSheet = null;

const $ = s => document.querySelector(s);
const qa = s => document.querySelectorAll(s);

/* ---------- DATE / UTILS ---------- */
function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + da;
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
};

function hashPin(pin) {
  return btoa(pin.split("").reverse().join(""));
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
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
    console.error(e);
  }
}
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

/* ---------- BACKUP: INDEXEDDB HELPERS ---------- */
function openBackupDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_DB, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(BACKUP_STORE)) {
        db.createObjectStore(BACKUP_STORE);
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
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

/* ---------- BACKUP BANNER / LABEL ---------- */
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

  if (!backupHandle) {
    label.textContent = "No file selected";
  } else {
    label.textContent = backupHandle.name || "Backup file selected";
  }

  if (last) {
    last.textContent = "Last backup: " + fmtTime(state.settings.lastBackupTS);
  }
}

/* ---------- BACKUP CORE ---------- */
async function chooseBackupFile() {
  if (!("showSaveFilePicker" in window)) {
    alert("Auto backup is only supported in Chromium browsers (Chrome/Edge) with HTTPS or localhost.");
    return;
  }

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: "expense-backup.json",
      types: [
        {
          description: "JSON file",
          accept: { "application/json": [".json"] }
        }
      ]
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
    if (perm !== "granted") {
      throw new Error("permission_revoked");
    }

    const writable = await backupHandle.createWritable();
    await writable.write(JSON.stringify(state, null, 2));
    await writable.close();

    console.log("[Backup] Saved:", reason || "(no reason)");
    state.settings.lastBackupTS = Date.now();
    save();
    updateBackupLabel();
  } catch (e) {
    if (
      e.message === "permission_revoked" ||
      e.name === "NotAllowedError" ||
      e.name === "SecurityError"
    ) {
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

/* ---------- PERIOD TX HELPERS ---------- */
function getPeriodTx() {
  if (periodMode === "month") {
    const md = monthDate(periodOffset);
    return state.tx
      .filter(t => sameMonth(t.date, md))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  } else {
    const yd = yearDate(periodOffset);
    return state.tx
      .filter(t => sameYear(t.date, yd))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }
}

function mLabel() {
  const mm = $("#m-main");
  const ms = $("#m-sub");
  if (!mm || !ms) return;

  if (periodMode === "month") {
    const md = monthDate(periodOffset);
    const monthShort = md.toLocaleString("en-IN", { month: "short" }); // 3 chars
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

  // update labels on cards
  $("#sum-label").textContent = periodMode === "month" ? "Month balance" : "Year balance";
  $("#stats-sub").textContent = periodMode === "month" ? "Selected month summary" : "Selected year summary";
  $("#cat-sub").textContent = periodMode === "month" ? "Expenses this month" : "Expenses this year";
}

/* ---------- HOME RENDER ---------- */
function renderHome() {
  const list = $("#home-list"), mt = getPeriodTx();
  let inc = 0, exp = 0;
  mt.forEach(t => {
    const a = Number(t.amount) || 0;
    t.type === "income" ? inc += a : exp += a;
  });
  $("#h-inc").textContent = fmt(inc);
  $("#h-exp").textContent = fmt(exp);
  const bal = inc - exp;
  const hb = $("#h-bal");
  hb.textContent = fmt(bal);
  hb.classList.remove("pos", "neg");
  if (bal > 0) hb.classList.add("pos");
  else if (bal < 0) hb.classList.add("neg");

  if (!mt.length) {
    list.innerHTML = '<div class="empty">No entries for this period. Tap + to add.</div>';
    return;
  }

  const groups = {};
  mt.forEach(t => {
    (groups[t.date] || (groups[t.date] = [])).push(t);
  });
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
    m.textContent = d.toLocaleString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short" // already short like "Dec"
    });
    const s = document.createElement("div");
    s.className = "day-sub";
    let di = 0, de = 0;
    groups[ds].forEach(t => {
      const a = Number(t.amount) || 0;
      t.type === "income" ? di += a : de += a;
    });
    s.textContent = "Inc " + fmt(di) + " · Exp " + fmt(de);
    h.appendChild(m);
    h.appendChild(s);
    g.appendChild(h);

    groups[ds].forEach(t => {
      const c = document.createElement("div");
      c.className = "tx-card";
      c.addEventListener("click", () => openEntrySheet(t.id));

      const l = document.createElement("div");
      l.className = "tx-l";
      const ic = document.createElement("div");
      ic.className = "tx-icon";
      const cat = state.cats[t.catId];
      let em = t.catEmoji || "💸";
      if (cat) em = cat.emoji || em;
      ic.textContent = em;

      const main = document.createElement("div");
      main.className = "tx-main";
      const ti = document.createElement("div");
      ti.className = "tx-title";
      let title = (cat ? cat.name : "Other");
      if (t.subId && cat) {
        const sb = cat.subs.find(s => s.id === t.subId);
        if (sb) title += " · " + sb.name;
      }
      ti.textContent = title;
      const no = document.createElement("div");
      no.className = "tx-note";
      no.textContent = t.note || "No note";
      main.appendChild(ti);
      main.appendChild(no);

      l.appendChild(ic);
      l.appendChild(main);

      const r = document.createElement("div");
      r.className = "tx-r";
      const am = document.createElement("div");
      const a = Number(t.amount) || 0;
      am.textContent = fmt(a);
      am.className = t.type === "income" ? "pos" : "neg";
      r.appendChild(am);

      c.appendChild(l);
      c.appendChild(r);
      g.appendChild(c);
    });

    list.appendChild(g);
  });
}

/* ---------- STATS / CHART ---------- */
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

// Chart.js plugin for leader lines + labels around donut + percents inside
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

      ctx.strokeStyle = opts?.color || "#4b5563";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lineStartX, lineStartY);
      ctx.lineTo(lineMidX, lineMidY);
      ctx.lineTo(lineEndX, lineEndY);
      ctx.stroke();

      ctx.fillStyle = opts?.textColor || "#e5e7eb";
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
  $("#s-inc").textContent = fmt(inc);
  $("#s-exp").textContent = fmt(exp);
  const bal = inc - exp;
  const sb = $("#s-bal");
  sb.textContent = fmt(bal);
  sb.classList.remove("pos", "neg");
  if (bal > 0) sb.classList.add("pos");
  else if (bal < 0) sb.classList.add("neg");
  $("#s-cnt").textContent = mt.length;

  const ctx = $("#chart").getContext("2d");
  const expTx = mt.filter(t => t.type === "expense");
  const byCat = {};
  expTx.forEach(t => {
    const c = state.cats[t.catId];
    const key = t.catId || "other";
    if (!byCat[key]) byCat[key] = { amt: 0, cat: c };
    byCat[key].amt += (Number(t.amount) || 0);
  });

  const labels = [], data = [], colors = [];
  const base = [
    "#38bdf8",
    "#a855f7",
    "#f97316",
    "#22c55e",
    "#facc15",
    "#fb7185",
    "#2dd4bf",
    "#4f46e5"
  ];
  let i = 0, totalExp = 0;
  Object.keys(byCat).forEach(k => {
    const v = byCat[k];
    if (!v.amt) return;
    totalExp += v.amt;
    labels.push(v.cat ? v.cat.name : "Other");
    data.push(v.amt);
    colors.push(base[i++ % base.length]);
  });

  if (chart) chart.destroy();
  const cl = $("#cat-list");

  if (!data.length) {
    chart = new Chart(ctx, {
      type: "doughnut",
      data: { labels: ["No data"], datasets: [{ data: [1], backgroundColor: ["#1f2937"], borderWidth: 0 }] },
      options: { plugins: { legend: { display: false }, tooltip: { enabled: false } }, cutout: "65%" }
    });
    cl.innerHTML = '<div class="empty">No expense data for this period.</div>';
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
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ${fmt(ctx.raw)}`
          }
        }
      },
      layout: {
        padding: 32
      },
      cutout: "55%"
    },
    plugins: [leaderLinePlugin]
  });
cl.innerHTML = "";
  const catKeys = Object.keys(byCat)
    .filter(k => byCat[k].amt > 0)
    .sort((a, b) => byCat[b].amt - byCat[a].amt);

  catKeys.forEach((k, idx) => {
    const v = byCat[k];
    const pct = Math.round(v.amt * 100 / totalExp);

    const item = document.createElement("div");
    item.className = "cat-item";

    const head = document.createElement("div");
    head.className = "cat-head";

    const l = document.createElement("div");
    l.className = "cat-l";
    const ic = document.createElement("div");
    ic.className = "cat-ic";
    ic.textContent = v.cat && v.cat.emoji ? v.cat.emoji : "💸";
    const nm = document.createElement("div");
    nm.className = "cat-name";
    nm.textContent = v.cat ? v.cat.name : "Other";
    const pr = document.createElement("div");
    pr.className = "cat-per";
    pr.textContent = pct + "%";

    const twrap = document.createElement("div");
    twrap.style.display = "flex";
    twrap.style.flexDirection = "column";
    twrap.appendChild(nm);
    twrap.appendChild(pr);

    l.appendChild(ic);
    l.appendChild(twrap);

    const rv = document.createElement("div");
    rv.className = "cat-val";
    const s1 = document.createElement("div");
    s1.className = "cat-amt";
    s1.textContent = fmt(v.amt);
    rv.appendChild(s1);

    const tg = document.createElement("div");
    tg.className = "cat-toggle";
    tg.textContent = "▾";

    head.appendChild(l);
    head.appendChild(rv);
    head.appendChild(tg);

    const subBox = document.createElement("div");
    subBox.className = "sub-list";
    const subs = expandSubCats(k, expTx, v.amt);
    subs.forEach(s => {
      const r = document.createElement("div");
      r.className = "sub-row";
      const l1 = document.createElement("span");
      l1.textContent = s.name;
      const r1 = document.createElement("span");
      r1.textContent = `${fmt(s.amt)} · ${Math.round(s.amt * 100 / v.amt)}%`;
      r.appendChild(l1);
      r.appendChild(r1);
      subBox.appendChild(r);
    });

    item.appendChild(head);
    item.appendChild(subBox);
    head.addEventListener("click", () => {
      const vis = subBox.style.display === "block";
      subBox.style.display = vis ? "none" : "block";
      tg.textContent = vis ? "▾" : "▴";
    });
    if (idx === 0) subBox.style.display = "block";
    cl.appendChild(item);
  });
}

/* ---------- SHEETS HELPERS ---------- */
function openSheet(id) { $(id).classList.add("active"); }
function closeSheet(id) { $(id).classList.remove("active"); }

function fillCatSelect() {
  const sel = $("#e-cat"), sub = $("#e-subcat");
  sel.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = "Select";
  sel.appendChild(opt);
  Object.values(state.cats).forEach(c => {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = (c.emoji || "") + " " + c.name;
    sel.appendChild(o);
  });
  sub.innerHTML = "";
  const o2 = document.createElement("option");
  o2.value = "";
  o2.textContent = "None";
  sub.appendChild(o2);
}
function fillSubSelect(catId) {
  const sub = $("#e-subcat");
  sub.innerHTML = "";
  const o = document.createElement("option");
  o.value = "";
  o.textContent = "None";
  sub.appendChild(o);
  const c = state.cats[catId];
  if (!c) return;
  c.subs.forEach(s => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    sub.appendChild(o);
  });
}

/* ---------- ENTRY SHEET ---------- */
function openEntrySheet(id) {
  editId = id || null;
  const f = $("#entry-form");
  f.reset();
  $("#e-type").value = "expense";
  $("#e-date").value = todayISO();
  fillCatSelect();
  $("#e-subcat").innerHTML = '<option value="">None</option>';
  const delBtn = $("#entry-del");
  if (delBtn) delBtn.style.display = id ? "inline-flex" : "none";
  $("#entry-save").textContent = id ? "Save" : "Add";
  $("#entry-title").textContent = id ? "Edit entry" : "Add entry";

  if (id) {
    const t = state.tx.find(x => x.id === id);
    if (!t) return;
    $("#e-type").value = t.type;
    $("#e-amt").value = t.amount;
    $("#e-date").value = t.date;
    $("#e-note").value = t.note || "";
    if (t.catId) {
      $("#e-cat").value = t.catId;
      fillSubSelect(t.catId);
      if (t.subId) $("#e-subcat").value = t.subId;
    }
  } else {
    $("#e-date").value = todayISO();
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

/* ---------- CATEGORY MANAGER & SHEET ---------- */
function renderCatMgr() {
  const box = $("#cat-mgr");
  if (!box) return;
  if (!Object.keys(state.cats).length) {
    box.innerHTML = '<div class="empty">No categories. Add one.</div>';
    return;
  }
  box.innerHTML = "";
  Object.values(state.cats).forEach(c => {
    const card = document.createElement("div");
    card.className = "cat-card";

    const head = document.createElement("div");
    head.className = "cat-card-head";

    const left = document.createElement("div");
    left.className = "cat-card-left";

    const ic = document.createElement("div");
    ic.className = "cat-ic";
    ic.textContent = c.emoji || "💸";

    const main = document.createElement("div");
    main.className = "cat-card-main";
    const nm = document.createElement("div");
    nm.className = "cat-card-name";
    nm.textContent = c.name;
    const sb = document.createElement("div");
    sb.className = "cat-card-sub";
    sb.textContent = c.subs.length ? c.subs.map(s => s.name).join(", ") : "No subcategories";
    main.appendChild(nm);
    main.appendChild(sb);

    left.appendChild(ic);
    left.appendChild(main);

    const btns = document.createElement("div");
    btns.className = "cat-card-btns";
    const b1 = document.createElement("button");
    b1.className = "btn btn-ghost small";
    b1.textContent = "Edit";
    b1.onclick = () => openCatSheet(c.id);
    btns.appendChild(b1);

    head.appendChild(left);
    head.appendChild(btns);
    card.appendChild(head);
    box.appendChild(card);
  });
}

function renderSubcatList() {
  const box = $("#subcat-list");
  if (!box) return;
  box.innerHTML = "";
  tempSubcats.forEach(s => {
    const pill = document.createElement("div");
    pill.className = "subcat-pill";

    const name = document.createElement("span");
    name.className = "subcat-name";
    name.textContent = s.name;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "subcat-del";
    del.textContent = "×";
    del.dataset.id = s.id;

    pill.appendChild(name);
    pill.appendChild(del);
    box.appendChild(pill);
  });
}

function openCatSheet(id) {
  editCatId = id || null;
  const c = id ? state.cats[id] : null;

  currentCatIdForSheet = c ? c.id : null;
  prevSubIds = c ? c.subs.map(s => s.id) : [];
  tempSubcats = c ? c.subs.map(s => ({ id: s.id, name: s.name })) : [];

  $("#cat-sheet-title").textContent = id ? "Edit category" : "Add category";
  $("#c-emoji").value = c?.emoji || "";
  $("#c-name").value = c?.name || "";
  const input = $("#c-subcat-input");
  if (input) input.value = "";

  $("#cat-del").style.display = id ? "inline-flex" : "none";

  renderSubcatList();
  openSheet("#sheet-cat");
}

function saveCategory(e) {
  e.preventDefault();
  const name = $("#c-name").value.trim();
  if (!name) return alert("Category name required");

  const emoji = $("#c-emoji").value.trim() || "💸";

  if (editCatId) {
    const id = editCatId;
    const removedIds = prevSubIds.filter(oldId => !tempSubcats.some(s => s.id === oldId));
    const subs = tempSubcats.map(s => ({ id: s.id, name: s.name }));

    state.cats[id] = { id, name, emoji, subs };

    if (removedIds.length) {
      state.tx.forEach(t => {
        if (t.catId === id && removedIds.includes(t.subId)) {
          t.subId = null;
        }
      });
    }

    save();
    triggerBackup("Category updated");
  } else {
    const id = "c" + Date.now();
    const subs = tempSubcats.map((s, i) => ({
      id: id + "-s" + i,
      name: s.name
    }));
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
  state.tx.forEach(t => {
    if (t.catId === editCatId) {
      t.catId = null;
      t.subId = null;
    }
  });

  save();
  triggerBackup("Category deleted");

  editCatId = null;
  tempSubcats = [];
  prevSubIds = [];
  currentCatIdForSheet = null;
  closeSheet("#sheet-cat");
  rerender();
}

/* ---------- TABS & SWIPE ---------- */
function setTab(t) {
  qa(".tab-page").forEach(x => x.classList.remove("tab-active"));
  $("#tab-" + t).classList.add("tab-active");
  qa(".nav-item").forEach(x => x.classList.remove("nav-active"));
  const btn = document.querySelector('.nav-item[data-tab="' + t + '"]');
  if (btn) btn.classList.add("nav-active");

  // FAB only on home
  const fab = $("#fab");
  if (fab) fab.classList.toggle("hidden", t !== "home");

  // hide month header on settings
  const mh = $("#month-header");
  if (mh) mh.style.display = (t === "settings") ? "none" : "flex";

  if (t === "stats") renderStats();
}

function setupSwipe() {
  const area = $("#swipe");
  let sx = 0, sy = 0, sw = false;
  const st = e => {
    const t = e.touches ? e.touches[0] : e;
    sx = t.clientX;
    sy = t.clientY;
    sw = true;
  };
  const ed = e => {
    if (!sw) return;
    sw = false;
    const t = e.changedTouches ? e.changedTouches[0] : e;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 80) return;
    const active = document.querySelector(".nav-item.nav-active");
    const tab = active ? active.dataset.tab : "home";
    if (tab === "settings") return;
    if (dx < 0) periodOffset++;
    else periodOffset--;
    rerender();
  };
  area.addEventListener("touchstart", st, { passive: true });
  area.addEventListener("touchend", ed);
  area.addEventListener("mousedown", st);
  area.addEventListener("mouseup", ed);
}

/* ---------- BIOMETRIC & LOCK ---------- */
function canUseBio() {
  return "PublicKeyCredential" in window &&
    (location.protocol === "https:" || location.hostname === "localhost");
}
async function fakeBioFlow() {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const pub = {
    challenge,
    timeout: 60000,
    userVerification: "preferred",
    rpId: location.hostname || undefined,
    allowCredentials: []
  };
  await navigator.credentials.get({ publicKey: pub });
}
function updateBioRow() {
  const row = $("#bio-row"), btn = $("#btn-toggle-bio");
  if (!row || !btn) return;
  if (!canUseBio()) { row.style.display = "none"; return; }
  row.style.display = "flex";
  btn.textContent = state.settings.bio ? "Disable" : "Enable";
}
function setupLock() {
  const ls = $("#lock"),
    pins = qa(".pin-inputs input"),
    main = $("#lock-main-btn"),
    alt = $("#lock-alt-btn"),
    ttl = $("#lock-title"),
    sub = $("#lock-sub"),
    note = $("#lock-note");

  function getPin() { return Array.from(pins).map(i => i.value).join(""); }
  pins.forEach((p, i) => {
    p.addEventListener("input", () => { if (p.value && i < 3) pins[i + 1].focus(); });
    p.addEventListener("keydown", e => { if (e.key === "Backspace" && !p.value && i > 0) pins[i - 1].focus(); });
  });
  function clearPins() { pins.forEach(p => p.value = ""); pins[0].focus(); }

  const havePin = !!state.settings.pinHash;
  if (!havePin) {
    ttl.textContent = "Set PIN";
    sub.textContent = "Create a 4-digit PIN to protect your expenses.";
    main.textContent = "Save PIN";
    note.textContent = "You can enable biometrics later from Settings (HTTPS & supported browser).";
  } else {
    ttl.textContent = "Enter PIN";
    sub.textContent = "Unlock to view your expenses.";
    main.textContent = "Unlock";
    note.textContent = "Forgot PIN? Clear browser data to reset app (this deletes all data).";
    if (canUseBio()) {
      alt.classList.remove("hidden");
      alt.textContent = state.settings.bio ? "Use biometrics" : "Try biometrics";
    }
  }

  main.onclick = () => {
    const pin = getPin();
    if (pin.length !== 4) { alert("Enter 4 digits."); return; }
    if (!havePin) {
      state.settings.pinHash = hashPin(pin);
      save();
      ls.classList.add("hidden");
    } else {
      if (hashPin(pin) === state.settings.pinHash) {
        ls.classList.add("hidden");
      } else {
        alert("Wrong PIN.");
        clearPins();
        return;
      }
    }
    rerender();
  };

  alt.onclick = async () => {
    if (!canUseBio()) {
      alert("Biometric unlock not supported in this context.");
      return;
    }
    try {
      await fakeBioFlow();
      ls.classList.add("hidden");
      if (!state.settings.bio) {
        state.settings.bio = true;
        save();
        updateBioRow();
      }
    } catch (e) {
      alert("Biometric auth failed.");
    }
  };

  clearPins();
}

/* ---------- RERENDER ---------- */
function rerender() {
  mLabel();
  renderHome();
  const active = document.querySelector(".nav-item.nav-active");
  if (active && active.dataset.tab === "stats") {
    renderStats();
  }
  renderCatMgr();
}

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", () => {
  load();
  defaultCats();
  mLabel();
  renderHome();
  renderCatMgr();
  setupSwipe();

  qa(".nav-item").forEach(n => n.addEventListener("click", () => setTab(n.dataset.tab)));

  const fab = $("#fab");
  if (fab) fab.onclick = () => openEntrySheet(null);

  $("#e-cat").addEventListener("change", e => fillSubSelect(e.target.value));
  $("#entry-close").onclick = () => { editId = null; closeSheet("#sheet-entry"); };
  $("#entry-cancel").onclick = () => { editId = null; closeSheet("#sheet-entry"); };
  $("#entry-del").onclick = deleteEntry;

  $("#entry-form").addEventListener("submit", ev => {
    ev.preventDefault();
    const type = $("#e-type").value;
    const amt = Number($("#e-amt").value);
    const catId = $("#e-cat").value || null;
    const subId = $("#e-subcat").value || null;
    const date = $("#e-date").value;
    const note = $("#e-note").value.trim();
    if (!amt || amt <= 0) { alert("Enter valid amount."); return; }
    if (!date) { alert("Select date."); return; }
    if (editId) {
      const t = state.tx.find(x => x.id === editId);
      if (t) {
        t.type = type;
        t.amount = amt;
        t.catId = catId;
        t.subId = subId;
        t.date = date;
        t.note = note;
      }
    } else {
      state.tx.push({ id: Date.now().toString(), type, amount: amt, catId, subId, date, note });
    }
    save();
    triggerBackup("Entry added/updated");
    closeSheet("#sheet-entry");
    editId = null;
    rerender();
  });
  $("#sheet-entry").addEventListener("click", e => {
    if (e.target.id === "sheet-entry") {
      editId = null;
      closeSheet("#sheet-entry");
    }
  });

  // Category sheet
  $("#cat-close").onclick = () => {
    editCatId = null;
    tempSubcats = [];
    prevSubIds = [];
    currentCatIdForSheet = null;
    closeSheet("#sheet-cat");
  };
  $("#sheet-cat").addEventListener("click", e => {
    if (e.target.id === "sheet-cat") {
      editCatId = null;
      tempSubcats = [];
      prevSubIds = [];
      currentCatIdForSheet = null;
      closeSheet("#sheet-cat");
    }
  });
  $("#cat-form").addEventListener("submit", saveCategory);
  $("#cat-del").onclick = deleteCategory;
  $("#btn-add-cat").onclick = () => openCatSheet(null);

  const subAddBtn = $("#c-subcat-add");
  const subInput = $("#c-subcat-input");
  const subList = $("#subcat-list");

  if (subAddBtn && subInput) {
    subAddBtn.onclick = () => {
      const val = subInput.value.trim();
      if (!val) return;
      let id;
      if (currentCatIdForSheet) {
        id = currentCatIdForSheet + "-s" + Date.now();
      } else {
        id = "new-" + Date.now();
      }
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

  // Month/year nav
  $("#m-prev").onclick = () => { periodOffset--; rerender(); };
  $("#m-next").onclick = () => { periodOffset++; rerender(); };
  $("#mode-month").onclick = () => {
    if (periodMode !== "month") {
      periodMode = "month";
      periodOffset = 0;
      $("#mode-month").classList.add("seg-active");
      $("#mode-year").classList.remove("seg-active");
      rerender();
    }
  };
  $("#mode-year").onclick = () => {
    if (periodMode !== "year") {
      periodMode = "year";
      periodOffset = 0;
      $("#mode-year").classList.add("seg-active");
      $("#mode-month").classList.remove("seg-active");
      rerender();
    }
  };

  // Export/import/reset
  $("#btn-export").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "expense-backup.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  $("#file-import").addEventListener("change", e => {
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
  $("#btn-clear").onclick = () => {
    if (!confirm("Clear all data? This cannot be undone.")) return;
    state = {
      tx: [],
      cats: {},
      settings: {
        pinHash: state.settings.pinHash,
        bio: false,
        lastBackupTS: null
      }
    };
    defaultCats();
    save();
    triggerBackup("Reset all data");
    rerender();
  };

  // PIN & bio
  $("#btn-change-pin").onclick = () => {
    state.settings.pinHash = null;
    save();
    document.getElementById("lock").classList.remove("hidden");
    setupLock();
  };
  $("#btn-toggle-bio").onclick = () => {
    state.settings.bio = !state.settings.bio;
    save();
    updateBioRow();
    alert("Biometric flag updated. Real biometric prompt appears on next app unlock.");
  };

  // Auto backup UI & banner
  const chooseBtn = $("#btn-choose-backup");
  const backupNowBtn = $("#btn-backup-now");
  const fixBtn = $("#backup-fix");
  const dismissBtn = $("#backup-dismiss");

  if (chooseBtn) chooseBtn.onclick = () => chooseBackupFile();
  if (backupNowBtn) backupNowBtn.onclick = () => {
    if (!backupHandle) {
      alert("Choose a backup file first.");
      return;
    }
    saveBackup("Manual backup");
  };
  if (fixBtn) fixBtn.onclick = () => chooseBackupFile();
  if (dismissBtn) dismissBtn.onclick = () => hideBackupBanner();

  if ("indexedDB" in window) {
    loadBackupHandle()
      .then((handle) => {
        backupHandle = handle || null;
        updateBackupLabel();
        if (backupHandle) {
          checkDailyBackup();
        }
      })
      .catch((e) => console.error("[Backup] load handle failed:", e));
  } else {
    console.log("[Backup] IndexedDB not available");
  }
  window.addEventListener("focus", () => {
    if (backupHandle) checkDailyBackup();
  });

  updateBioRow();
  fillCatSelect();
  setupLock();
});