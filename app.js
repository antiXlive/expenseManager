"use strict";

/* ---------------- STATE ---------------- */
const KEY = "expMgrMobileDarkV2";

let state = {
  tx: [],
  cats: {},
  settings: { pinHash: null, bio: false }
};

let editId = null;
let editCatId = null;
let periodMode = "month"; // "month" | "year"
let offset = 0;
let chart = null;

const $ = s => document.querySelector(s);
const qa = s => document.querySelectorAll(s);

/* --------------- HELPERS --------------- */
function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function fmt(n) {
  n = Number(n) || 0;
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function hashPin(pin) {
  return btoa(pin.split("").reverse().join(""));
}

function getPeriodBase() {
  const now = new Date();
  if (periodMode === "month") {
    return new Date(now.getFullYear(), now.getMonth() + offset, 1);
  } else {
    return new Date(now.getFullYear() + offset, 0, 1);
  }
}

function matchPeriod(dateStr) {
  const d = new Date(dateStr);
  const p = getPeriodBase();
  if (periodMode === "month") {
    return d.getFullYear() === p.getFullYear() && d.getMonth() === p.getMonth();
  }
  return d.getFullYear() === p.getFullYear();
}

/* --------------- STORAGE --------------- */
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.tx) state.tx = s.tx;
    if (s.cats) state.cats = s.cats;
    if (s.settings) state.settings = s.settings;
  } catch (e) {
    console.error(e);
  }
}
function defaultCats() {
  if (Object.keys(state.cats).length) return;
  const base = [
    { id: "food", n: "Food & Drinks", e: "🍕", subs: ["Groceries 🛒", "Dining Out 🍽"] },
    { id: "shop", n: "Shopping", e: "🛍️", subs: ["Online", "Offline"] },
    { id: "trans", n: "Transport", e: "🚗", subs: ["Cab 🚕", "Fuel ⛽"] },
    { id: "health", n: "Health", e: "💊", subs: ["Doctor", "Medicines"] }
  ];
  base.forEach(c => {
    state.cats[c.id] = {
      id: c.id,
      name: c.n,
      emoji: c.e,
      subs: c.subs.map((s, i) => ({ id: c.id + "-s" + i, name: s }))
    };
  });
}

/* -------- PERIOD HEADER LABELS -------- */
function updatePeriodHeader() {
  const p = getPeriodBase();
  const main = $("#m-main");
  const sub = $("#m-sub");

  if (periodMode === "month") {
    main.textContent = p.toLocaleString("en-IN", { month: "short", year: "numeric" });
    if (offset === 0) sub.textContent = "This month";
    else if (offset === -1) sub.textContent = "Previous month";
    else if (offset === 1) sub.textContent = "Next month";
    else sub.textContent = (offset < 0 ? `${Math.abs(offset)} months ago` : `${offset} months ahead`);
    $("#sum-label").textContent = "Month balance";
    $("#stats-sub").textContent = "Selected month summary";
    $("#cat-sub").textContent = "Expenses this month";
  } else {
    main.textContent = p.getFullYear();
    if (offset === 0) sub.textContent = "This year";
    else if (offset === -1) sub.textContent = "Last year";
    else if (offset === 1) sub.textContent = "Next year";
    else sub.textContent = (offset < 0 ? `${Math.abs(offset)} years ago` : `${offset} years ahead`);
    $("#sum-label").textContent = "Year balance";
    $("#stats-sub").textContent = "Selected year summary";
    $("#cat-sub").textContent = "Expenses this year";
  }
}

/* --------- FILTER PERIOD TX --------- */
function periodTx() {
  return state.tx
    .filter(t => matchPeriod(t.date))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

/* --------------- HOME --------------- */
function renderHome() {
  const list = $("#home-list");
  const txs = periodTx();

  let inc = 0, exp = 0;
  txs.forEach(t => {
    const a = Number(t.amount) || 0;
    if (t.type === "income") inc += a;
    else exp += a;
  });

  $("#h-inc").textContent = fmt(inc);
  $("#h-exp").textContent = fmt(exp);
  const bal = inc - exp;
  const hb = $("#h-bal");
  hb.textContent = fmt(bal);
  hb.classList.remove("pos", "neg");
  if (bal > 0) hb.classList.add("pos");
  else if (bal < 0) hb.classList.add("neg");

  if (!txs.length) {
    list.innerHTML = `<div class="empty">No entries for this period. Tap + to add.</div>`;
    return;
  }

  const groups = {};
  txs.forEach(t => {
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
      month: "short"
    });

    const s = document.createElement("div");
    s.className = "day-sub";
    let di = 0, de = 0;
    groups[ds].forEach(t => {
      const a = Number(t.amount) || 0;
      t.type === "income" ? di += a : de += a;
    });
    s.textContent = `Inc ${fmt(di)} · Exp ${fmt(de)}`;

    h.appendChild(m);
    h.appendChild(s);
    g.appendChild(h);

    groups[ds].forEach(t => {
      const cat = state.cats[t.catId];

      const card = document.createElement("div");
      card.className = "tx-card";
      card.onclick = () => openEntrySheet(t.id);

      const left = document.createElement("div");
      left.className = "tx-l";

      const ic = document.createElement("div");
      ic.className = "tx-icon";
      ic.textContent = cat?.emoji || "💸";

      const main = document.createElement("div");
      main.className = "tx-main";

      const title = document.createElement("div");
      title.className = "tx-title";
      let ttl = cat ? cat.name : "Other";
      if (t.subId && cat) {
        const sb = cat.subs.find(s => s.id === t.subId);
        if (sb) ttl += " · " + sb.name;
      }
      title.textContent = ttl;

      const note = document.createElement("div");
      note.className = "tx-note";
      let subcat = "";
      if (t.subId && cat) {
        const sb = cat.subs.find(s => s.id === t.subId);
        if (sb) subcat = sb.name;
      }
      if (subcat) {
        note.textContent = subcat + (t.note ? " • " + t.note : "");
      } else {
        note.textContent = t.note || "No note";
      }

      main.appendChild(title);
      main.appendChild(note);
      left.appendChild(ic);
      left.appendChild(main);

      const right = document.createElement("div");
      right.className = "tx-r";
      const am = document.createElement("div");
      am.textContent = fmt(t.amount);
      am.className = t.type === "income" ? "pos" : "neg";
      right.appendChild(am);

      card.appendChild(left);
      card.appendChild(right);
      g.appendChild(card);
    });

    list.appendChild(g);
  });
}

/* --------------- STATS / CHART --------------- */
function expandSubCats(catId, expTx, totalAmt) {
  const cat = state.cats[catId];
  if (!cat) return [{ name: "Other", amt: totalAmt }];

  const map = {};
  cat.subs.forEach(s => map[s.id] = { name: s.name, amt: 0 });
  let other = 0;
  expTx.forEach(t => {
    const a = Number(t.amount) || 0;
    if (t.subId && map[t.subId]) map[t.subId].amt += a;
    else other += a;
  });

  const arr = Object.values(map).filter(x => x.amt > 0);
  if (other > 0) arr.push({ name: "Other", amt: other });
  return arr.sort((a, b) => b.amt - a.amt);
}

function renderStats() {
  const txs = periodTx();
  let inc = 0, exp = 0;
  txs.forEach(t => {
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
  $("#s-cnt").textContent = txs.length;

  const expTx = txs.filter(t => t.type === "expense");
  const byCat = {};
  expTx.forEach(t => {
    const key = t.catId || "other";
    if (!byCat[key]) byCat[key] = { amt: 0, cat: state.cats[t.catId] || null };
    byCat[key].amt += Number(t.amount) || 0;
  });

  const entries = [];
  Object.keys(byCat).forEach(cid => {
    if (!byCat[cid].amt) return;
    entries.push({
      cid,
      amt: byCat[cid].amt,
      cat: byCat[cid].cat
    });
  });

  if (!entries.length) {
    if (chart) chart.destroy();
    const ctx = $("#chart").getContext("2d");
    chart = new Chart(ctx, {
      type: "doughnut",
      data: { labels: ["No data"], datasets: [{ data: [1], backgroundColor: ["#1f2937"] }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        cutout: "70%"
      }
    });
    $("#cat-list").innerHTML = `<div class="empty">No expense data for this period.</div>`;
    return;
  }

  const palette = ["#6366f1","#f97316","#22c55e","#eab308","#ec4899","#06b6d4","#a855f7","#f97373"];
  entries.sort((a, b) => b.amt - a.amt).forEach((e, i) => e.color = palette[i % palette.length]);

  const labels = entries.map(e => e.cat?.name || "Other");
  const data = entries.map(e => e.amt);
  const colors = entries.map(e => e.color);

  const ctx = $("#chart").getContext("2d");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 0 }]
    },
    options: {
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            color: "#e5e7eb",
            usePointStyle: true,
            pointStyle: "circle",
            padding: 10
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ${fmt(ctx.raw)}`
          }
        }
      },
      cutout: "60%"
    }
  });

  const catList = $("#cat-list");
  catList.innerHTML = "";
  const totalExp = expTx.reduce((s, t) => s + (Number(t.amount) || 0), 0);

  entries.forEach(e => {
    const pct = Math.round(e.amt * 100 / totalExp);

    const item = document.createElement("div");
    item.className = "cat-item";

    const head = document.createElement("div");
    head.className = "cat-head";

    const left = document.createElement("div");
    left.className = "cat-l";

    const colorDot = document.createElement("span");
    colorDot.className = "cat-color-dot";
    colorDot.style.backgroundColor = e.color;

    const ic = document.createElement("div");
    ic.className = "cat-ic";
    ic.textContent = e.cat?.emoji || "💸";

    const nameBox = document.createElement("div");
    nameBox.style.display = "flex";
    nameBox.style.flexDirection = "column";

    const nm = document.createElement("div");
    nm.className = "cat-name";
    nm.textContent = e.cat?.name || "Other";

    const pr = document.createElement("div");
    pr.className = "cat-per";
    pr.textContent = pct + "%";

    nameBox.appendChild(nm);
    nameBox.appendChild(pr);

    left.appendChild(colorDot);
    left.appendChild(ic);
    left.appendChild(nameBox);

    const val = document.createElement("div");
    val.className = "cat-val";
    val.innerHTML = `<strong>${fmt(e.amt)}</strong><span>${pct}%</span>`;

    const tg = document.createElement("div");
    tg.className = "cat-toggle";
    tg.textContent = "▾";

    head.appendChild(left);
    head.appendChild(val);
    head.appendChild(tg);

    const subBox = document.createElement("div");
    subBox.className = "sub-list";
    const subs = expandSubCats(e.cid, expTx.filter(t => t.catId === e.cid), e.amt);
    subs.forEach(s => {
      const row = document.createElement("div");
      row.className = "sub-row";
      row.innerHTML = `<span>${s.name}</span><span>${fmt(s.amt)} · ${Math.round(s.amt * 100 / e.amt)}%</span>`;
      subBox.appendChild(row);
    });

    head.onclick = () => {
      const open = subBox.style.display === "block";
      subBox.style.display = open ? "none" : "block";
      tg.textContent = open ? "▾" : "▴";
    };

    item.appendChild(head);
    item.appendChild(subBox);
    catList.appendChild(item);
  });
}

/* --------------- CATEGORY MANAGER --------------- */
function renderCatMgr() {
  const box = $("#cat-mgr");
  box.innerHTML = "";
  const cats = Object.values(state.cats);
  if (!cats.length) {
    box.innerHTML = `<div class="empty">No categories. Add one.</div>`;
    return;
  }

  cats.forEach(c => {
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

    const edit = document.createElement("button");
    edit.className = "btn btn-ghost small";
    edit.textContent = "Edit";
    edit.onclick = () => openCatSheet(c.id);
    btns.appendChild(edit);

    head.appendChild(left);
    head.appendChild(btns);
    card.appendChild(head);
    box.appendChild(card);
  });
}

/* --------------- ENTRY SHEET --------------- */
function fillCatSelect() {
  const catSel = $("#e-cat");
  catSel.innerHTML = "";
  Object.values(state.cats).forEach(c => {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = (c.emoji || "") + " " + c.name;
    catSel.appendChild(o);
  });
}

function fillSubSelect(catId) {
  const subSel = $("#e-subcat");
  subSel.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "None";
  subSel.appendChild(none);
  if (!catId || !state.cats[catId]) return;
  state.cats[catId].subs.forEach(s => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    subSel.appendChild(o);
  });
}

function openEntrySheet(id) {
  editId = id || null;
  const form = $("#entry-form");
  form.reset();
  $("#entry-del").style.display = id ? "inline-flex" : "none";
  $("#entry-title").textContent = id ? "Edit entry" : "Add entry";
  $("#entry-save").textContent = id ? "Save" : "Add";

  fillCatSelect();

  if (id) {
    const t = state.tx.find(x => x.id === id);
    if (!t) return;
    $("#e-type").value = t.type;
    $("#e-amt").value = t.amount;
    $("#e-cat").value = t.catId;
    fillSubSelect(t.catId);
    if (t.subId) $("#e-subcat").value = t.subId;
    $("#e-date").value = t.date;
    $("#e-note").value = t.note || "";
  } else {
    const firstCat = Object.keys(state.cats)[0];
    if (firstCat) {
      $("#e-cat").value = firstCat;
      fillSubSelect(firstCat);
    }
    $("#e-date").value = todayISO();
  }

  openSheet("#sheet-entry");
}

function deleteEntry() {
  if (!editId) return;
  if (!confirm("Delete this entry?")) return;
  state.tx = state.tx.filter(t => t.id !== editId);
  save();
  editId = null;
  closeSheet("#sheet-entry");
  rerender();
}

/* --------------- CATEGORY SHEET --------------- */
function openCatSheet(id) {
  editCatId = id || null;
  const c = id ? state.cats[id] : null;

  $("#cat-sheet-title").textContent = id ? "Edit category" : "Add category";
  $("#c-emoji").value = c?.emoji || "";
  $("#c-name").value = c?.name || "";
  $("#c-subcats").value = c ? c.subs.map(s => s.name).join(", ") : "";
  $("#cat-del").style.display = id ? "inline-flex" : "none";

  openSheet("#sheet-cat");
}

function saveCategory(e) {
  e.preventDefault();
  const name = $("#c-name").value.trim();
  if (!name) return alert("Category name required");

  const emoji = $("#c-emoji").value.trim() || "💸";
  const subsRaw = $("#c-subcats").value.trim();
  const subs = subsRaw ? subsRaw.split(",").map(s => s.trim()).filter(Boolean) : [];

  const id = editCatId || ("c" + Date.now());
  state.cats[id] = {
    id,
    name,
    emoji,
    subs: subs.map((s, i) => ({ id: id + "-s" + i, name: s }))
  };

  save();
  editCatId = null;
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
  editCatId = null;
  closeSheet("#sheet-cat");
  rerender();
}

/* --------------- SHEETS UTIL --------------- */
function openSheet(id) { $(id).classList.add("active"); }
function closeSheet(id) { $(id).classList.remove("active"); }

/* --------------- PIN LOCK --------------- */
function setupLock() {
  const ls = $("#lock");
  const pins = qa(".pin-inputs input");
  const main = $("#lock-main-btn");
  const alt = $("#lock-alt-btn");

  function getPin() {
    return Array.from(pins).map(i => i.value).join("");
  }
  function clearPins() {
    pins.forEach(i => i.value = "");
    pins[0].focus();
  }

  pins.forEach((p, i) => {
    p.addEventListener("input", () => {
      if (p.value && i < 3) pins[i + 1].focus();
    });
    p.addEventListener("keydown", e => {
      if (e.key === "Backspace" && !p.value && i > 0) pins[i - 1].focus();
    });
  });

  const havePin = !!state.settings.pinHash;
  if (!havePin) {
    $("#lock-title").textContent = "Set PIN";
    $("#lock-sub").textContent = "Create a 4-digit PIN to protect your expenses.";
    main.textContent = "Save PIN";
    $("#lock-note").textContent = "You can enable biometrics later from Settings (HTTPS & supported device).";
  } else {
    $("#lock-title").textContent = "Enter PIN";
    $("#lock-sub").textContent = "Unlock to view your expenses.";
    main.textContent = "Unlock";
    $("#lock-note").textContent = "Forgot PIN? Clear browser data to reset app (this deletes all data).";
  }

  main.onclick = () => {
    const pin = getPin();
    if (pin.length !== 4) { alert("Enter 4 digits."); return; }
    if (!havePin) {
      state.settings.pinHash = hashPin(pin);
      save();
      ls.classList.add("hidden");
      rerender();
    } else {
      if (hashPin(pin) === state.settings.pinHash) {
        ls.classList.add("hidden");
        rerender();
      } else {
        alert("Wrong PIN.");
        clearPins();
      }
    }
  };

  alt.onclick = () => {
    alert("Biometric auth is a demo flag here. Real FaceID/TouchID needs WebAuthn + HTTPS.");
  };

  clearPins();
}

/* --------------- NAV / TABS / FAB --------------- */
function setTab(t) {
  qa(".tab-page").forEach(x => x.classList.remove("tab-active"));
  $("#tab-" + t).classList.add("tab-active");

  qa(".nav-item").forEach(x => x.classList.remove("nav-active"));
  const btn = document.querySelector(`.nav-item[data-tab="${t}"]`);
  if (btn) btn.classList.add("nav-active");

  // FAB only on Home
  $("#fab").style.display = (t === "home") ? "flex" : "none";

  // Hide period header on Settings
  $("#month-header").style.display = (t === "settings") ? "none" : "block";

  if (t === "stats") renderStats();
}

/* --------------- SWIPE --------------- */
function setupSwipe() {
  const area = $("#swipe");
  let sx = 0, sy = 0, active = false;

  const start = e => {
    const t = e.touches ? e.touches[0] : e;
    sx = t.clientX;
    sy = t.clientY;
    active = true;
  };
  const end = e => {
    if (!active) return;
    active = false;
    const t = e.changedTouches ? e.changedTouches[0] : e;
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 80) return;
    if (dx < 0) offset++;
    else offset--;
    rerender();
  };

  area.addEventListener("touchstart", start, { passive: true });
  area.addEventListener("touchend", end);
  area.addEventListener("mousedown", start);
  area.addEventListener("mouseup", end);
}

/* --------------- RERENDER --------------- */
function rerender() {
  updatePeriodHeader();
  renderHome();
  renderCatMgr();
  if (document.querySelector(".nav-item.nav-active")?.dataset.tab === "stats") {
    renderStats();
  }
}

/* --------------- INIT --------------- */
document.addEventListener("DOMContentLoaded", () => {
  load();
  defaultCats();
  setupLock();
  setupSwipe();
  updatePeriodHeader();
  renderHome();
  renderCatMgr();

  // Tabs
  qa(".nav-item").forEach(n => {
    n.addEventListener("click", () => setTab(n.dataset.tab));
  });

  // FAB
  $("#fab").onclick = () => openEntrySheet(null);
  $("#fab").style.display = "flex"; // default (Home initial)

  // Category change -> subcategory list
  $("#e-cat").addEventListener("change", e => fillSubSelect(e.target.value));

  // Entry sheet
  $("#entry-close").onclick = () => closeSheet("#sheet-entry");
  $("#entry-cancel").onclick = () => closeSheet("#sheet-entry");
  $("#entry-del").onclick = deleteEntry;
  $("#sheet-entry").addEventListener("click", e => {
    if (e.target.id === "sheet-entry") closeSheet("#sheet-entry");
  });
  $("#entry-form").addEventListener("submit", e => {
    e.preventDefault();
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
        t.subId = subId || null;
        t.date = date;
        t.note = note;
      }
    } else {
      state.tx.push({
        id: String(Date.now()),
        type,
        amount: amt,
        catId,
        subId: subId || null,
        date,
        note
      });
    }

    save();
    closeSheet("#sheet-entry");
    editId = null;
    rerender();
  });

  // Category sheet
  $("#cat-close").onclick = () => closeSheet("#sheet-cat");
  $("#sheet-cat").addEventListener("click", e => {
    if (e.target.id === "sheet-cat") closeSheet("#sheet-cat");
  });
  $("#cat-form").addEventListener("submit", saveCategory);
  $("#cat-del").onclick = deleteCategory;
  $("#btn-add-cat").onclick = () => openCatSheet(null);

  // Period toggle
  $("#mode-month").onclick = () => {
    periodMode = "month";
    offset = 0;
    $("#mode-month").classList.add("seg-active");
    $("#mode-year").classList.remove("seg-active");
    rerender();
  };
  $("#mode-year").onclick = () => {
    periodMode = "year";
    offset = 0;
    $("#mode-year").classList.add("seg-active");
    $("#mode-month").classList.remove("seg-active");
    rerender();
  };

  // Prev/next
  $("#m-prev").onclick = () => { offset--; rerender(); };
  $("#m-next").onclick = () => { offset++; rerender(); };

  // Backup
  $("#btn-export").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "expense-backup.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  $("#file-import").addEventListener("change", e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        if (!confirm("Import data and replace existing?")) return;
        state = d;
        save();
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
    state = { tx: [], cats: {}, settings: { pinHash: state.settings.pinHash, bio: false } };
    defaultCats();
    save();
    rerender();
  };

  $("#btn-change-pin").onclick = () => {
    state.settings.pinHash = null;
    save();
    $("#lock").classList.remove("hidden");
    setupLock();
  };

  $("#btn-toggle-bio").onclick = () => {
    state.settings.bio = !state.settings.bio;
    save();
    alert("Biometric flag toggled (demo). Real biometrics require WebAuthn & HTTPS.");
  };
});
