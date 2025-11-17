"use strict";

/* -----------------------------------------------------
   GLOBAL STATE
----------------------------------------------------- */
const KEY = "expMgrMobileDarkV2";

let state = {
    tx: [],
    cats: {},
    settings: {
        pinHash: null,
        bio: false
    }
};

let editId = null;
let editCatId = null;

let periodMode = "month";     // "month" | "year"
let offset = 0;               // monthOff or yearOff depending on mode

let chart = null;

/* -----------------------------------------------------
    SHORTCUTS
----------------------------------------------------- */
const $ = (x) => document.querySelector(x);
const qa = (x) => document.querySelectorAll(x);

/* -----------------------------------------------------
   DATE HELPERS
----------------------------------------------------- */
function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
}

function getCurrentPeriodDate() {
    const d = new Date();
    if (periodMode === "month") {
        return new Date(d.getFullYear(), d.getMonth() + offset, 1);
    } else {
        return new Date(d.getFullYear() + offset, 0, 1);
    }
}

function matchPeriod(dateStr) {
    const d = new Date(dateStr);
    const p = getCurrentPeriodDate();

    if (periodMode === "month") {
        return d.getFullYear() === p.getFullYear() &&
               d.getMonth() === p.getMonth();
    } else {
        return d.getFullYear() === p.getFullYear();
    }
}

function fmt(n) {
    n = Number(n) || 0;
    return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function hashPin(pin) {
    return btoa(pin.split("").reverse().join(""));
}

/* -----------------------------------------------------
   LOAD / SAVE
----------------------------------------------------- */
function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
}

function load() {
    try {
        const d = localStorage.getItem(KEY);
        if (!d) return;
        const obj = JSON.parse(d);
        state.tx = obj.tx || [];
        state.cats = obj.cats || {};
        state.settings = obj.settings || state.settings;
    } catch (e) {}
}

function defaultCats() {
    if (Object.keys(state.cats).length) return;

    const defs = [
        { id: "food", name: "Food & Drinks", emoji: "🍕",
          subs: ["Groceries 🛒","Dining Out 🍽"] },
        { id: "shop", name: "Shopping", emoji: "🛍️",
          subs: ["Online","Offline"] },
        { id: "trans", name: "Transport", emoji: "🚗",
          subs: ["Cab 🚕","Fuel ⛽"] },
        { id: "health", name: "Health", emoji: "💊",
          subs: ["Doctor","Medicines"] }
    ];

    defs.forEach(c => {
        state.cats[c.id] = {
            id: c.id,
            name: c.name,
            emoji: c.emoji,
            subs: c.subs.map((s,i)=>({ id:c.id+"-s"+i, name:s }))
        };
    });
}

/* -----------------------------------------------------
   PERIOD LABELS
----------------------------------------------------- */
function updatePeriodHeader() {
    const p = getCurrentPeriodDate();
    const mm = $("#m-main");
    const ms = $("#m-sub");

    if (periodMode === "month") {
        mm.textContent = p.toLocaleString("en-IN", { month:"long", year:"numeric" });

        if (offset === 0) ms.textContent = "This month";
        else if (offset === -1) ms.textContent = "Previous month";
        else if (offset === 1) ms.textContent = "Next month";
        else ms.textContent = Math.abs(offset) + (offset < 0 ? " months ago" : " months ahead");
    }
    else {
        mm.textContent = p.getFullYear();

        if (offset === 0) ms.textContent = "This year";
        else if (offset === -1) ms.textContent = "Last year";
        else if (offset === 1) ms.textContent = "Next year";
        else ms.textContent = Math.abs(offset) + (offset < 0 ? " years ago" : " years ahead");
    }
}

/* -----------------------------------------------------
   FILTER TRANSACTIONS FOR CURRENT PERIOD
----------------------------------------------------- */
function periodTx() {
    return state.tx
        .filter(t => matchPeriod(t.date))
        .sort((a,b)=> new Date(b.date) - new Date(a.date));
}

/* -----------------------------------------------------
   HOME RENDER
----------------------------------------------------- */
function renderHome() {
    const list = $("#home-list");
    const tx = periodTx();

    let inc = 0, exp = 0;
    tx.forEach(t => t.type === "income" ? inc += Number(t.amount) : exp += Number(t.amount));

    $("#h-inc").textContent = fmt(inc);
    $("#h-exp").textContent = fmt(exp);

    const bal = inc - exp;
    const hb = $("#h-bal");
    hb.textContent = fmt(bal);
    hb.classList.remove("pos","neg");
    if (bal > 0) hb.classList.add("pos");
    if (bal < 0) hb.classList.add("neg");

    if (!tx.length) {
        list.innerHTML = `<div class="empty">No entries for this period.</div>`;
        return;
    }

    const groups = {};
    tx.forEach(t => {
        if (!groups[t.date]) groups[t.date] = [];
        groups[t.date].push(t);
    });

    const sortedDates = Object.keys(groups).sort((a,b)=> new Date(b)-new Date(a));

    list.innerHTML = "";
    sortedDates.forEach(ds => {
        const g = document.createElement("div");
        g.className = "day-group";

        const h = document.createElement("div");
        h.className = "day-head";

        const d = new Date(ds);
        const m = document.createElement("div");
        m.className = "day-main";
        m.textContent = d.toLocaleString("en-IN",{ weekday:"short", day:"2-digit", month:"short" });

        const s = document.createElement("div");
        s.className = "day-sub";

        let di=0,de=0;
        groups[ds].forEach(t=>{
            t.type === "income" ? di += Number(t.amount) : de += Number(t.amount);
        });
        s.textContent = "Inc " + fmt(di) + " · Exp " + fmt(de);

        h.appendChild(m);
        h.appendChild(s);
        g.appendChild(h);

        groups[ds].forEach(t => {
            const card = document.createElement("div");
            card.className = "tx-card";
            card.onclick = ()=> openEntrySheet(t.id);

            const left = document.createElement("div");
            left.className = "tx-l";

            const ic = document.createElement("div");
            ic.className = "tx-icon";
            const cat = state.cats[t.catId];
            ic.textContent = cat?.emoji || "💸";

            const main = document.createElement("div");
            main.className = "tx-main";

            const title = document.createElement("div");
            title.className = "tx-title";
            title.textContent = cat ? cat.name : "Other";

            const note = document.createElement("div");
            note.className = "tx-note";
            note.textContent = t.note || "No note";

            main.appendChild(title);
            main.appendChild(note);

            left.appendChild(ic);
            left.appendChild(main);

            const r = document.createElement("div");
            r.className = "tx-r";

            const am = document.createElement("div");
            am.textContent = fmt(t.amount);
            am.className = t.type === "income" ? "pos" : "neg";
            r.appendChild(am);

            card.appendChild(left);
            card.appendChild(r);
            g.appendChild(card);
        });

        list.appendChild(g);
    });
}

/* -----------------------------------------------------
   STATS RENDER
----------------------------------------------------- */
function renderStats() {
    const tx = periodTx();

    let inc = 0, exp = 0;
    tx.forEach(t => t.type === "income" ? inc += Number(t.amount) : exp += Number(t.amount));

    $("#s-inc").textContent = fmt(inc);
    $("#s-exp").textContent = fmt(exp);

    const bal = inc - exp;
    const sb = $("#s-bal");
    sb.textContent = fmt(bal);
    sb.classList.remove("pos","neg");
    if (bal > 0) sb.classList.add("pos");
    if (bal < 0) sb.classList.add("neg");

    $("#s-cnt").textContent = tx.length;

    /* ----- CATEGORY BREAKDOWN ----- */
    const expTx = tx.filter(t => t.type === "expense");
    const byCat = {};

    expTx.forEach(t => {
        const key = t.catId || "other";
        if (!byCat[key]) byCat[key] = { amt:0, cat:state.cats[t.catId] };
        byCat[key].amt += Number(t.amount);
    });

    // Chart
    const labels = [], data = [], colors = [];
    const palette = ["#6366f1","#f97316","#22c55e","#eab308","#ec4899","#06b6d4","#a855f7","#f43f5e"];

    let i = 0;
    Object.keys(byCat).forEach(k => {
        if (byCat[k].amt <= 0) return;

        labels.push(byCat[k].cat?.name || "Other");
        data.push(byCat[k].amt);
        colors.push(palette[i++ % palette.length]);
    });

    const ctx = $("#chart").getContext("2d");
    if (chart) chart.destroy();

    if (!data.length) {
        chart = new Chart(ctx,{
            type:"doughnut",
            data:{ labels:["No data"], datasets:[{ data:[1], backgroundColor:["#1f2937"] }] },
            options:{ plugins:{ legend:{display:false} }, cutout:"70%" }
        });
        $("#cat-list").innerHTML = `<div class="empty">No expense data</div>`;
        return;
    }

    chart = new Chart(ctx,{
        type:"doughnut",
        data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:0 }] },
        options:{
            plugins:{
                legend:{display:false},
                tooltip:{ callbacks:{label:x => `${x.label}: ${fmt(x.raw)}`} }
            },
            cutout:"65%"
        }
    });

    /* ----- CATEGORY LIST BELOW CHART ----- */
    const catBox = $("#cat-list");
    catBox.innerHTML = "";

    const sorted = Object.keys(byCat)
        .filter(k => byCat[k].amt > 0)
        .sort((a,b)=> byCat[b].amt - byCat[a].amt);

    const total = expTx.reduce((s,t)=> s+Number(t.amount), 0);

    sorted.forEach((cid, idx) => {
        const v = byCat[cid];
        const pct = Math.round(v.amt * 100 / total);

        const item = document.createElement("div");
        item.className = "cat-item";

        const head = document.createElement("div");
        head.className = "cat-head";

        const left = document.createElement("div");
        left.className = "cat-l";

        const ic = document.createElement("div");
        ic.className = "cat-ic";
        ic.textContent = v.cat?.emoji || "💸";

        const nm = document.createElement("div");
        nm.className = "cat-name";
        nm.textContent = v.cat?.name || "Other";

        const pr = document.createElement("div");
        pr.className = "cat-per";
        pr.textContent = pct + "%";

        const tw = document.createElement("div");
        tw.style.display = "flex";
        tw.style.flexDirection = "column";
        tw.appendChild(nm);
        tw.appendChild(pr);

        left.appendChild(ic);
        left.appendChild(tw);

        const rv = document.createElement("div");
        rv.className = "cat-val";
        rv.innerHTML = `<strong>${fmt(v.amt)}</strong><span>${pct}%</span>`;

        const tg = document.createElement("div");
        tg.className = "cat-toggle";
        tg.textContent = "▾";

        head.appendChild(left);
        head.appendChild(rv);
        head.appendChild(tg);

        /* sub-categories */
        const subBox = document.createElement("div");
        subBox.className = "sub-list";

        const subs = expandSubCats(cid, expTx, v.amt);
        subs.forEach(s => {
            const r = document.createElement("div");
            r.className = "sub-row";
            r.innerHTML = `
                <span>${s.name}</span>
                <span>${fmt(s.amt)} · ${Math.round(s.amt*100/v.amt)}%</span>`;
            subBox.appendChild(r);
        });

        head.onclick = () => {
            const open = subBox.style.display === "block";
            subBox.style.display = open ? "none" : "block";
            tg.textContent = open ? "▾" : "▴";
        };

        if (idx === 0) subBox.style.display = "block";

        item.appendChild(head);
        item.appendChild(subBox);
        catBox.appendChild(item);
    });
}

/* helper for sub-cats */
function expandSubCats(catId, tx, total) {
    const cat = state.cats[catId];
    if (!cat) return [{ name:"Other", amt:total }];

    const bucket = {};
    cat.subs.forEach(s=> bucket[s.id] = { name:s.name, amt:0 });

    let other = 0;

    tx.forEach(t=>{
        const a = Number(t.amount);
        if (t.subId && bucket[t.subId]) bucket[t.subId].amt += a;
        else other += a;
    });

    const out = Object.values(bucket).filter(x=> x.amt>0);
    if (other > 0) out.push({ name:"Other", amt:other });

    return out.sort((a,b)=> b.amt - a.amt);
}

/* -----------------------------------------------------
   CATEGORY MANAGER
----------------------------------------------------- */
function renderCatMgr() {
    const box = $("#cat-mgr");
    box.innerHTML = "";

    const cats = Object.values(state.cats);
    if (!cats.length) {
        box.innerHTML = `<div class="empty">No categories.</div>`;
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

        const mn = document.createElement("div");
        mn.className = "cat-card-main";

        const name = document.createElement("div");
        name.className = "cat-card-name";
        name.textContent = c.name;

        const sb = document.createElement("div");
        sb.className = "cat-card-sub";
        sb.textContent = c.subs.map(s=>s.name).join(", ");

        mn.appendChild(name);
        mn.appendChild(sb);

        left.appendChild(ic);
        left.appendChild(mn);

        const btns = document.createElement("div");
        btns.className = "cat-card-btns";

        const editBtn = document.createElement("button");
        editBtn.className = "btn btn-ghost small";
        editBtn.textContent = "Edit";
        editBtn.onclick = ()=> openCatSheet(c.id);

        btns.appendChild(editBtn);

        head.appendChild(left);
        head.appendChild(btns);
        card.appendChild(head);

        box.appendChild(card);
    });
}

/* -----------------------------------------------------
   ENTRY SHEET
----------------------------------------------------- */
function openEntrySheet(id) {
    editId = id;

    const f = $("#entry-form");
    f.reset();
    $("#entry-del").style.display = id ? "inline-flex" : "none";
    $("#entry-title").textContent = id ? "Edit entry" : "Add entry";
    $("#entry-save").textContent = id ? "Save" : "Add";

    fillCatSelect();

    if (id) {
        const t = state.tx.find(x=> x.id === id);
        $("#e-type").value = t.type;
        $("#e-amt").value = t.amount;
        $("#e-cat").value = t.catId;
        $("#e-date").value = t.date;
        $("#e-note").value = t.note || "";
    } else {
        $("#e-date").value = todayISO();
    }

    openSheet("#sheet-entry");
}

function fillCatSelect() {
    const sel = $("#e-cat");
    sel.innerHTML = "";
    Object.values(state.cats).forEach(c=>{
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = (c.emoji || "") + " " + c.name;
        sel.appendChild(o);
    });
}

function deleteEntry() {
    if (!editId) return;
    state.tx = state.tx.filter(t=> t.id !== editId);
    save();
    closeSheet("#sheet-entry");
    editId = null;
    rerender();
}

/* -----------------------------------------------------
   CATEGORY SHEET
----------------------------------------------------- */
function openCatSheet(id) {
    editCatId = id || null;
    const c = state.cats[id];

    $("#cat-sheet-title").textContent = id ? "Edit category" : "Add category";
    $("#c-emoji").value = c?.emoji || "";
    $("#c-name").value  = c?.name || "";
    $("#c-subcats").value = c ? c.subs.map(s=>s.name).join(", ") : "";
    $("#cat-del").style.display = id ? "inline-flex" : "none";

    openSheet("#sheet-cat");
}

function saveCategory(e) {
    e.preventDefault();

    const name = $("#c-name").value.trim();
    if (!name) return alert("Category name required.");

    const emoji = $("#c-emoji").value.trim() || "💸";
    const subsRaw = $("#c-subcats").value.trim();
    const subs = subsRaw ? subsRaw.split(",").map(s=> s.trim()).filter(Boolean) : [];

    const id = editCatId || ("c_"+Date.now());
    state.cats[id] = {
        id,
        name,
        emoji,
        subs: subs.map((s,i)=>({ id:id+"-s"+i, name:s }))
    };

    save();
    closeSheet("#sheet-cat");
    editCatId = null;
    rerender();
}

function deleteCategory() {
    if (!editCatId) return;

    const used = state.tx.some(t=> t.catId === editCatId);
    if (used && !confirm("Category used by transactions. Delete anyway?"))
        return;

    delete state.cats[editCatId];
    state.tx.forEach(t=>{
        if (t.catId === editCatId) {
            t.catId = null;
        }
    });

    save();
    closeSheet("#sheet-cat");
    editCatId = null;
    rerender();
}

/* -----------------------------------------------------
   SHEETS UTIL
----------------------------------------------------- */
function openSheet(id){ $(id).classList.add("active"); }
function closeSheet(id){ $(id).classList.remove("active"); }

/* -----------------------------------------------------
   PIN LOCK
----------------------------------------------------- */
function setupLock() {
    const ls = $("#lock");
    const pins = qa(".pin-inputs input");
    const main = $("#lock-main-btn");
    const alt  = $("#lock-alt-btn");

    const hasPin = !!state.settings.pinHash;

    function getPin() {
        return [...pins].map(i => i.value).join("");
    }

    function clearPins() {
        pins.forEach(i=> i.value="");
        pins[0].focus();
    }

    pins.forEach((p,i)=> {
        p.addEventListener("input", ()=>{
            if (p.value && i < 3) pins[i+1].focus();
        });
        p.addEventListener("keydown", e=>{
            if (e.key === "Backspace" && !p.value && i>0) pins[i-1].focus();
        });
    });

    if (!hasPin) {
        $("#lock-title").textContent = "Set PIN";
        $("#lock-sub").textContent = "Create a 4-digit PIN.";
        main.textContent = "Save PIN";
    } else {
        $("#lock-title").textContent = "Enter PIN";
        $("#lock-sub").textContent = "Unlock your expenses.";
        main.textContent = "Unlock";
    }

    main.onclick = () => {
        const pin = getPin();
        if (pin.length !== 4) return alert("Enter 4 digits.");

        if (!hasPin) {
            state.settings.pinHash = hashPin(pin);
            save();
            ls.classList.add("hidden");
            return;
        }

        if (hashPin(pin) === state.settings.pinHash) {
            ls.classList.add("hidden");
        } else {
            alert("Wrong PIN.");
            clearPins();
        }
    };

    clearPins();
}

/* -----------------------------------------------------
   NAVIGATION
----------------------------------------------------- */
function setTab(t) {
    qa(".tab-page").forEach(x=> x.classList.remove("tab-active"));
    $("#tab-"+t).classList.add("tab-active");

    qa(".nav-item").forEach(x=> x.classList.remove("nav-active"));
    $(`.nav-item[data-tab='${t}']`).classList.add("nav-active");

    // Hide period header on settings
    $("#month-header").style.display = (t === "settings") ? "none" : "block";

    if (t === "stats") renderStats();
}

/* -----------------------------------------------------
   SWIPE PERIOD
----------------------------------------------------- */
function setupSwipe() {
    const area = $("#swipe");

    let sx = 0, sy = 0, down = false;

    area.addEventListener("touchstart", e=>{
        const t = e.touches[0];
        sx = t.clientX; sy = t.clientY; down = true;
    },{passive:true});

    area.addEventListener("touchend", e=>{
        if (!down) return;
        down = false;

        const t = e.changedTouches[0];
        const dx = t.clientX - sx;
        const dy = t.clientY - sy;

        if (Math.abs(dx) < 60 || Math.abs(dy) > 80) return;

        if (dx < 0) offset++; else offset--;
        rerender();
    });
}

/* -----------------------------------------------------
   RERENDER ALL
----------------------------------------------------- */
function rerender() {
    updatePeriodHeader();
    renderHome();
    renderCatMgr();

    const active = document.querySelector(".nav-item.nav-active")?.dataset.tab;
    if (active === "stats") renderStats();
}

/* -----------------------------------------------------
   INIT
----------------------------------------------------- */
document.addEventListener("DOMContentLoaded", ()=>{

    load();
    defaultCats();
    setupLock();
    setupSwipe();
    updatePeriodHeader();
    renderHome();
    renderCatMgr();

    /* NAV */
    qa(".nav-item").forEach(n=>{
        n.onclick = () => setTab(n.dataset.tab);
    });

    /* PERIOD MODE TOGGLE */
    $("#mode-month").onclick = ()=>{
        periodMode = "month";
        offset = 0;
        $("#mode-month").classList.add("seg-active");
        $("#mode-year").classList.remove("seg-active");
        rerender();
    };

    $("#mode-year").onclick = ()=>{
        periodMode = "year";
        offset = 0;
        $("#mode-year").classList.add("seg-active");
        $("#mode-month").classList.remove("seg-active");
        rerender();
    };

    /* MONTH/YEAR MOVE */
    $("#m-prev").onclick = ()=>{ offset--; rerender(); };
    $("#m-next").onclick = ()=>{ offset++; rerender(); };

    /* ENTRY */
    $("#fab").onclick = ()=> openEntrySheet(null);
    $("#entry-close").onclick = ()=> closeSheet("#sheet-entry");
    $("#entry-cancel").onclick = ()=> closeSheet("#sheet-entry");
    $("#entry-del").onclick = deleteEntry;

    $("#entry-form").onsubmit = (e)=>{
        e.preventDefault();

        const type = $("#e-type").value;
        const amt  = Number($("#e-amt").value);
        const cat  = $("#e-cat").value;
        const date = $("#e-date").value;
        const note = $("#e-note").value.trim();

        if (!amt || amt <= 0) return alert("Enter valid amount.");
        if (!date) return alert("Select date.");

        if (editId) {
            const t = state.tx.find(x=> x.id === editId);
            t.type = type;
            t.amount = amt;
            t.catId = cat;
            t.date = date;
            t.note = note;
        } else {
            state.tx.push({
                id:String(Date.now()),
                type,
                amount:amt,
                catId:cat,
                date,
                note
            });
        }
        save();
        closeSheet("#sheet-entry");
        editId = null;
        rerender();
    };

    $("#sheet-entry").onclick = (e)=>{
        if (e.target.id === "sheet-entry") closeSheet("#sheet-entry");
    };

    /* CATEGORY */
    $("#cat-close").onclick = ()=> closeSheet("#sheet-cat");
    $("#sheet-cat").onclick = (e)=>{
        if (e.target.id === "sheet-cat") closeSheet("#sheet-cat");
    };

    $("#cat-form").onsubmit = saveCategory;
    $("#cat-del").onclick = deleteCategory;
    $("#btn-add-cat").onclick = ()=> openCatSheet(null);

    /* BACKUP */
    $("#btn-export").onclick = ()=>{
        const blob = new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "expense-backup.json";
        a.click();
        URL.revokeObjectURL(url);
    };

    $("#file-import").onchange = (e)=>{
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = ev=>{
            try {
                const d = JSON.parse(ev.target.result);
                if (!confirm("Replace existing data?")) return;
                state = d;
                save();
                rerender();
                alert("Import successful.");
            } catch (e) { alert("Invalid file."); }
        };
        r.readAsText(f);
    };

    $("#btn-clear").onclick = ()=>{
        if (!confirm("Delete ALL data?")) return;
        state.tx = [];
        state.cats = {};
        state.settings.bio = false;
        defaultCats();
        save();
        rerender();
    };

    $("#btn-change-pin").onclick = ()=>{
        state.settings.pinHash = null;
        save();
        $("#lock").classList.remove("hidden");
        setupLock();
    };

    $("#btn-toggle-bio").onclick = ()=>{
        state.settings.bio = !state.settings.bio;
        save();
        alert("Biometric flag saved (fake). Real biometric requires HTTPS.");
    };
});
