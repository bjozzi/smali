(() => {
  "use strict";

  // ---------- Stillingar ----------
  const SYNC_MS = 15000; // hversu oft er sent og sótt
  const MIN_DIST = 20; // m: skrá punkt ef færst svona langt
  const MIN_DT = 30000; // ms: annars skrá punkt á 30 s fresti
  const MAX_ACC = 250; // m: hunsa mjög ónákvæma GPS punkta
  const STALE_MS = 3 * 60000; // eftir 3 mín er staðsetning talin gömul
  const GAP_MS = 10 * 60000; // slóð er rofin ef bil er lengra en þetta
  const QUEUE_MAX = 3000;
  const POST_MAX = 500;
  const TILE_CACHE = "smali-tiles-v1";
  const TILE_KB = 25; // áætluð stærð flísar
  const MAX_TILES = 3000; // ókeypis plan: 100.000 beiðnir á dag fyrir allan hópinn
  const ME_COLOR = "#1e6fd9";
  // enginn rauður eða grænn: þeir litir þýða "of aftarlega" og "í takt" á smalalínunni
  const COLORS = ["#f58231", "#911eb4", "#008080", "#9a6324", "#f032e6", "#808000", "#000075", "#d4a000", "#3a9fc4", "#6d4c41", "#7e57c2", "#37474f"];
  const ICELAND = L.latLngBounds([63.2, -24.6], [66.7, -13.4]);
  const DEMO = new URLSearchParams(location.search).has("demo"); // /?demo: hermdir smalar á alvöru korti

  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) {
      try {
        const v = localStorage.getItem("smali." + k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem("smali." + k, JSON.stringify(v));
      } catch {}
    },
    del(k) {
      try {
        localStorage.removeItem("smali." + k);
      } catch {}
    },
  };

  // ---------- Ástand ----------
  const me = LS.get("me", null) || { id: randomId(), name: "" };
  LS.set("me", me);
  let group = LS.get("group", null);
  let queue = LS.get("queue", []);
  let help = LS.get("help", false);
  let wake = LS.get("wake", true);
  let showTrails = LS.get("trails", true);
  let showLine = LS.get("line", true);
  let lagM = LS.get("lagM", 300);
  let showCover = LS.get("cover", true);
  let coverM = LS.get("coverM", 100);
  let coverArea = 0;
  let coverAreaAt = 0;
  let lastDir = null; // síðasta gönguátt hópsins
  let sweepRes = { segs: [], lag: {}, dir: null };

  const people = new Map(); // id -> {name, help, batt, last, trail, marker, line, html}
  let cursor = 0;
  let skew = 0;
  let lastOk = 0;
  let failSince = 0;
  let lastPost = 0;
  let dirtyMeta = true;
  let syncing = false;
  let syncTimer = null;
  let myPos = null;
  let lastRec = null;
  let gpsState = "wait"; // wait | ok | denied | error
  let watchId = null;
  let follow = false;
  let firstFix = true;
  let batt = null;
  let wl = null;

  // ---------- Kort ----------
  const map = L.map("map", { zoomControl: false, attributionControl: true }).setView([64.9, -18.6], 6);
  L.tileLayer("/tile/{z}/{x}/{y}.png", {
    minZoom: 5,
    maxZoom: 18,
    maxNativeZoom: 16,
    attribution: "© Landmælingar Íslands",
    errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
  }).addTo(map);
  L.control.zoom({ position: "bottomleft" }).addTo(map);
  const trailLayer = L.layerGroup().addTo(map);
  const sweepLayer = L.layerGroup().addTo(map);
  const cover = SmaliCover.create(map, { radius: coverM, visible: showCover });
  const peopleLayer = L.layerGroup().addTo(map);
  if (!showTrails) map.removeLayer(trailLayer);
  const meAcc = L.circle([0, 0], { radius: 1, color: ME_COLOR, weight: 1, fillOpacity: 0.12, interactive: false });
  const meMarker = L.marker([0, 0], {
    icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [0, 0] }),
    zIndexOffset: 2000,
    interactive: false,
  });
  map.on("dragstart", () => setFollow(false));
  // nöfn falin þegar kortið er dregið langt út, svo smalalínan sjáist; aðstoðarbeiðnir haldast merktar
  const labelZoom = () => map.getContainer().classList.toggle("far", map.getZoom() < 13.5);
  map.on("zoomend", labelZoom);
  labelZoom();

  // ---------- Hjálparföll ----------
  function randomId() {
    const a = new Uint8Array(10);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => (b % 36).toString(36)).join("") + Date.now().toString(36).slice(-4);
  }
  function genCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const a = new Uint8Array(6);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => abc[b % abc.length]).join("");
  }
  function colorFor(id) {
    if (id === me.id) return ME_COLOR;
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length];
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function dist(a, b) {
    const R = 6371000;
    const toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR;
    const dLon = (b.lon - a.lon) * toR;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function bearing(a, b) {
    const toR = Math.PI / 180;
    const y = Math.sin((b.lon - a.lon) * toR) * Math.cos(b.lat * toR);
    const x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) - Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos((b.lon - a.lon) * toR);
    return ((Math.atan2(y, x) / toR) + 360) % 360;
  }
  const DIRS = ["N", "NA", "A", "SA", "S", "SV", "V", "NV"];
  const dirName = (deg) => DIRS[Math.round(deg / 45) % 8];
  function fmtDist(m) {
    if (m < 1000) return Math.round(m / 10) * 10 + " m";
    return (m / 1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",") + " km";
  }
  function fmtAge(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return "rétt í þessu";
    const m = Math.round(s / 60);
    if (m < 60) return `fyrir ${m} mín`;
    const h = Math.floor(m / 60);
    return `fyrir ${h} klst ${m % 60} mín`;
  }
  const nowServer = () => Date.now() + skew;
  let toastTimer = null;
  function toast(msg, ms = 3500) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }
  async function fetchT(url, opts = {}, ms = 20000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ac.signal, cache: "no-store" });
    } finally {
      clearTimeout(t);
    }
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // ---------- GPS ----------
  function startGps() {
    if (watchId != null) return;
    if (!("geolocation" in navigator)) {
      gpsState = "error";
      updateStatus();
      return;
    }
    watchId = navigator.geolocation.watchPosition(onFix, onGpsErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 60000 });
  }
  function stopGps() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  function onFix(p) {
    const c = p.coords;
    const fix = { t: p.timestamp || Date.now(), lat: c.latitude, lon: c.longitude, acc: c.accuracy || 0 };
    myPos = fix;
    gpsState = "ok";
    meMarker.setLatLng([fix.lat, fix.lon]);
    meAcc.setLatLng([fix.lat, fix.lon]).setRadius(fix.acc);
    if (!map.hasLayer(meMarker)) {
      meMarker.addTo(map);
      meAcc.addTo(map);
    }
    if (firstFix) {
      firstFix = false;
      map.setView([fix.lat, fix.lon], Math.max(map.getZoom(), 14));
    } else if (follow) {
      map.panTo([fix.lat, fix.lon], { animate: true });
    }
    maybeRecord(fix);
    updateStatus();
  }
  function onGpsErr(e) {
    gpsState = e.code === 1 ? "denied" : myPos ? gpsState : "error";
    updateStatus();
  }
  function maybeRecord(f) {
    if (DEMO) return;
    if (f.acc > MAX_ACC) return;
    if (lastRec) {
      const moved = dist(lastRec, f);
      if (moved < Math.max(MIN_DIST, f.acc * 0.5) && f.t - lastRec.t < MIN_DT) return;
    }
    lastRec = f;
    queue.push([Math.round(f.t), +f.lat.toFixed(6), +f.lon.toFixed(6), Math.round(f.acc)]);
    if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
    LS.set("queue", queue);
    drawTrail(me.id);
  }

  // ---------- Samstilling við netþjón ----------
  function scheduleSync(ms) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, ms);
  }
  async function sync() {
    if (DEMO || !group || syncing) return;
    clearTimeout(syncTimer);
    if (document.visibilityState === "hidden") {
      // síminn er læstur eða annað app opið: spörum rafhlöðu og beiðnir
      scheduleSync(60000);
      return;
    }
    syncing = true;
    let again = SYNC_MS;
    try {
      const batch = queue.slice(0, POST_MAX);
      const sentCursor = cursor;
      const body = { id: me.id, pts: batch, since: cursor };
      const sendMeta = dirtyMeta || Date.now() - lastPost > 120000;
      if (sendMeta) Object.assign(body, { name: me.name, help, batt });
      const r = await fetchT(`/api/g/${group}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.status >= 500 || r.status === 429) throw new Error("sync " + r.status);
      // 4xx: gögnin eru gölluð og verða aldrei samþykkt, sleppum þeim frekar en að festast
      const sent = new Set(batch);
      queue = queue.filter((p) => !sent.has(p));
      LS.set("queue", queue);
      if (sendMeta) {
        dirtyMeta = false;
        lastPost = Date.now();
      }
      if (!r.ok) throw new Error("sync " + r.status);
      const s = await r.json();
      applyState(s, sentCursor);
      if (queue.length || s.more) again = 1000;
      lastOk = Date.now();
      failSince = 0;
    } catch (e) {
      if (!failSince) failSince = Date.now();
    } finally {
      syncing = false;
      updateStatus();
      if (group) scheduleSync(again);
    }
  }

  function applyState(s, sentCursor) {
    skew = s.now - Date.now();
    if (s.cursor < sentCursor) for (const p of people.values()) p.trail = [];
    cursor = s.cursor;
    const seen = new Set();
    for (const m of s.members) {
      seen.add(m.id);
      let p = people.get(m.id);
      if (!p) people.set(m.id, (p = { trail: [], marker: null, line: null, html: "" }));
      p.name = m.name;
      p.help = !!m.help;
      p.batt = m.batt;
      if (m.last_t != null) p.last = { t: m.last_t, lat: m.lat, lon: m.lon, acc: m.acc };
    }
    for (const [id, p] of people) {
      if (!seen.has(id) && id !== me.id) {
        if (p.marker) peopleLayer.removeLayer(p.marker);
        if (p.line) trailLayer.removeLayer(p.line);
        cover.remove(id);
        people.delete(id);
      }
    }
    for (const [id, arr] of Object.entries(s.pts || {})) {
      let p = people.get(id);
      if (!p) {
        if (id !== me.id) continue;
        people.set(id, (p = { trail: [], marker: null, line: null, html: "" }));
      }
      p.trail.push(...arr);
      p.trail.sort((a, b) => a[0] - b[0]);
      p.trail = p.trail.filter((pt, i, a) => i === 0 || pt[0] !== a[i - 1][0]);
      p.trailDirty = true;
    }
    saveSnap();
    render();
  }

  // Síðasta þekkta staða hópsins geymd í símanum, svo hún sjáist ef síðan opnast án sambands
  function saveSnap() {
    const ppl = {};
    for (const [id, p] of people) ppl[id] = { name: p.name, help: p.help, batt: p.batt, last: p.last, trail: p.trail.slice(-1500) };
    LS.set("snap", { group, cursor, skew, people: ppl });
  }
  function loadSnap(code) {
    const snap = LS.get("snap", null);
    if (!snap || snap.group !== code) return;
    cursor = snap.cursor || 0;
    skew = snap.skew || 0;
    for (const [id, p] of Object.entries(snap.people || {})) {
      people.set(id, { ...p, marker: null, line: null, html: "", trailDirty: true });
    }
    render();
  }

  // ---------- Teikning ----------
  function segments(points) {
    const segs = [];
    let cur = [];
    for (let i = 0; i < points.length; i++) {
      if (i > 0 && points[i][0] - points[i - 1][0] > GAP_MS && cur.length) {
        segs.push(cur);
        cur = [];
      }
      cur.push([points[i][1], points[i][2]]);
    }
    if (cur.length) segs.push(cur);
    return segs;
  }
  function drawTrail(id) {
    let p = people.get(id);
    if (!p && id === me.id) people.set(id, (p = { trail: [], marker: null, line: null, html: "" }));
    if (!p) return;
    let pts = p.trail;
    if (id === me.id && queue.length) {
      pts = pts.concat(queue.map((q) => [q[0], q[1], q[2]])).sort((a, b) => a[0] - b[0]);
    }
    const segs = segments(pts);
    cover.update(id, segs);
    if (!p.line) {
      p.line = L.polyline(segs, { color: colorFor(id), weight: id === me.id ? 4 : 3, opacity: 0.75, interactive: false });
      trailLayer.addLayer(p.line);
    } else {
      p.line.setLatLngs(segs);
    }
    p.trailDirty = false;
  }

  function personClass(p) {
    const age = nowServer() - (p.last ? p.last.t : 0);
    return { age, stale: age > STALE_MS, help: p.help };
  }

  // Smalalínan: græn á milli smala sem eru í takt, rauð ef annar er of aftarlega
  function updateSweep() {
    const members = [];
    for (const [id, p] of people) {
      if (id === me.id || !p.last) continue;
      const age = nowServer() - p.last.t;
      if (age > 10 * 60000) continue; // ekki séð í 10 mín: of óviss til að vera í línunni
      members.push({ id, lat: p.last.lat, lon: p.last.lon, stale: age > STALE_MS, trail: p.trail });
    }
    if (myPos && !DEMO) { // í sýnishorninu ert þú ekki í línunni, bara hermdu smalarnir
      const mine = people.get(me.id);
      const trail = (mine ? mine.trail : []).concat(queue.map((q) => [q[0], q[1], q[2]])).sort((a, b) => a[0] - b[0]);
      members.push({ id: me.id, lat: myPos.lat, lon: myPos.lon, stale: false, trail });
    }
    // sá sem er meira en 5 km frá næsta manni (t.d. farinn í bílinn) er ekki hluti af línunni
    const inLine = members.filter((m) => members.some((o) => o !== m && dist(m, o) < 5000));
    sweepRes = SmaliSweep.compute(inLine, { lagM, window: 5 * 60000, prevDir: lastDir });
    if (sweepRes.dir) lastDir = sweepRes.dir;
    sweepLayer.clearLayers();
    if (!showLine) return;
    for (const sg of sweepRes.segs) {
      L.polyline(
        [[sg.a.lat, sg.a.lon], [sg.b.lat, sg.b.lon]],
        { color: sg.red ? "#c0392b" : "#2f8a4a", weight: sg.red ? 6 : 4, opacity: 0.85, dashArray: sg.stale ? "8 8" : null, interactive: false }
      ).addTo(sweepLayer);
    }
    const meLag = !!sweepRes.lag[me.id];
    if (meLag !== meMarker._lag) {
      meMarker._lag = meLag;
      meMarker.setIcon(L.divIcon({ className: "", html: `<div class="me-dot${meLag ? " lag" : ""}"></div>`, iconSize: [0, 0] }));
    }
  }

  function render() {
    updateSweep();
    const others = [];
    for (const [id, p] of people) {
      if (p.trailDirty || (id === me.id && queue.length)) drawTrail(id);
      if (id === me.id) continue;
      if (!p.last) continue;
      const { age, stale } = personClass(p);
      const cls = ["pin", stale ? "stale" : "", p.help ? "help" : "", showLine && sweepRes.lag[id] ? "lag" : ""].join(" ");
      const label = esc(p.name) + (age > 60000 ? ` · ${fmtAge(age).replace("fyrir ", "")}` : "") + (p.help ? " · AÐSTOÐ" : "");
      const html = `<div class="${cls}"><div class="d" style="background:${colorFor(id)}"></div><div class="n">${label}</div></div>`;
      if (!p.marker) {
        p.marker = L.marker([p.last.lat, p.last.lon], { icon: L.divIcon({ className: "", html, iconSize: [0, 0] }), keyboard: false });
        p.marker.on("click", () => focusOn(id));
        peopleLayer.addLayer(p.marker);
        p.html = html;
      } else {
        p.marker.setLatLng([p.last.lat, p.last.lon]);
        if (p.html !== html) {
          p.marker.setIcon(L.divIcon({ className: "", html, iconSize: [0, 0] }));
          p.html = html;
        }
      }
      p.marker.setZIndexOffset(p.help ? 1500 : stale ? 0 : 500);
      others.push([id, p]);
    }
    renderList(others);
    renderHelp(others);
  }

  function relTo(p) {
    if (!myPos || !p.last) return null;
    const d = dist(myPos, p.last);
    return { d, b: bearing(myPos, p.last) };
  }

  function renderList(others) {
    const list = $("list");
    list.textContent = "";
    others.sort((a, b) => {
      if (a[1].help !== b[1].help) return a[1].help ? -1 : 1;
      const ra = relTo(a[1]);
      const rb = relTo(b[1]);
      if (ra && rb) return ra.d - rb.d;
      return a[1].name.localeCompare(b[1].name, "is");
    });
    if (Date.now() - coverAreaAt > 10000) {
      coverAreaAt = Date.now();
      coverArea = cover.areaKm2();
    }
    const areaTxt = showCover && coverArea >= 0.01 ? ` · ${coverArea.toFixed(coverArea < 10 ? 1 : 0).replace(".", ",")} km² gengið` : "";
    $("sheetTitle").textContent = (others.length
      ? `${others.length} ${others.length === 1 ? "smali" : "smalar"} í hópnum`
      : "Enginn annar kominn í hópinn") + areaTxt;
    if (!others.length) {
      const e = document.createElement("li");
      e.className = "empty";
      e.textContent = "Ýttu á hópkóðann efst til að senda hinum hlekk.";
      list.appendChild(e);
      return;
    }
    for (const [id, p] of others) {
      const { age, stale } = personClass(p);
      const li = document.createElement("li");
      if (p.help) li.classList.add("help");
      if (stale) li.classList.add("stale");
      const b = document.createElement("button");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = colorFor(id);
      const mid = document.createElement("div");
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = p.name + (p.help ? " · þarf aðstoð" : "");
      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = (stale ? "Síðast séð " : "Uppfært ") + fmtAge(age) + (p.batt != null ? ` · rafhlaða ${Math.round(p.batt * 100)}%` : "");
      if (showLine && sweepRes.lag[id]) {
        const lg = document.createElement("span");
        lg.className = "lagtxt";
        lg.textContent = `Of aftarlega, ${fmtDist(sweepRes.lag[id])} á eftir · `;
        sub.prepend(lg);
      }
      mid.append(who, sub);
      const where = document.createElement("div");
      where.className = "where";
      const r = relTo(p);
      if (r) {
        where.textContent = fmtDist(r.d);
        const sm = document.createElement("small");
        sm.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px;transform:rotate(${Math.round(r.b)}deg)"><path d="M12 3l6 16-6-4-6 4z" fill="currentColor"/></svg> `;
        sm.append(dirName(r.b));
        where.appendChild(sm);
      } else {
        where.textContent = "";
      }
      b.append(dot, mid, where);
      b.addEventListener("click", () => focusOn(id));
      li.appendChild(b);
      list.appendChild(li);
    }
  }

  function renderHelp(others) {
    const box = $("helpBanner");
    box.textContent = "";
    const needy = others.filter(([, p]) => p.help);
    if (help) {
      const b = document.createElement("button");
      b.textContent = "Þú hefur beðið um aðstoð. Ýttu hér til að hætta við.";
      b.addEventListener("click", () => openMenu());
      box.appendChild(b);
    }
    for (const [id, p] of needy) {
      const r = relTo(p);
      const b = document.createElement("button");
      b.textContent = `${p.name} þarf aðstoð` + (r ? ` · ${fmtDist(r.d)} ${dirName(r.b)}` : "");
      b.addEventListener("click", () => focusOn(id));
      box.appendChild(b);
    }
    box.hidden = !box.childNodes.length;
  }

  function focusOn(id) {
    const p = people.get(id);
    if (!p || !p.last) return;
    setFollow(false);
    map.setView([p.last.lat, p.last.lon], Math.max(map.getZoom(), 15));
    $("sheet").classList.remove("open");
    $("sheetHandle").setAttribute("aria-expanded", "false");
  }

  function setFollow(on) {
    follow = on;
    $("meBtn").classList.toggle("active", on);
  }

  function updateStatus() {
    const el = $("status");
    if (DEMO) {
      el.className = "status status-" + (myPos ? "ok" : "wait");
      el.textContent = myPos ? "Sýnishorn" : "Bíð eftir GPS";
      return;
    }
    let cls = "ok";
    let txt = "Í sambandi";
    const q = queue.length;
    if (gpsState === "denied") {
      cls = "bad";
      txt = "Staðsetning ekki leyfð";
    } else if (failSince && Date.now() - failSince > 15000) {
      cls = "bad";
      txt = lastOk ? `Ekkert samband ${fmtAge(Date.now() - lastOk).replace("fyrir ", "í ")}` : "Ekkert samband";
      if (q) txt += ` · ${q} í biðröð`;
    } else if (!myPos) {
      cls = "wait";
      txt = gpsState === "error" ? "Næ ekki GPS" : "Bíð eftir GPS";
    } else if (q > 3) {
      cls = "wait";
      txt = `Sendi ${q} punkta`;
    }
    if (navigator.onLine === false) {
      cls = "bad";
      txt = "Ekkert net" + (q ? ` · ${q} í biðröð` : "");
    }
    el.className = "status status-" + cls;
    el.textContent = txt;
  }

  // ---------- Skjár kveiktur ----------
  async function applyWake() {
    if (!wake || document.visibilityState !== "visible") {
      if (wl) {
        wl.release().catch(() => {});
        wl = null;
      }
      return;
    }
    if (!("wakeLock" in navigator) || wl) return;
    try {
      wl = await navigator.wakeLock.request("screen");
      wl.addEventListener("release", () => (wl = null));
    } catch {}
  }

  // ---------- Hópur ----------
  function enterGroup(code, isNew) {
    group = code;
    LS.set("group", code);
    LS.set("me", me);
    history.replaceState(null, "", "/?g=" + code);
    $("codeText").textContent = code;
    $("join").hidden = true;
    cursor = 0;
    for (const p of people.values()) {
      if (p.marker) peopleLayer.removeLayer(p.marker);
      if (p.line) trailLayer.removeLayer(p.line);
    }
    people.clear();
    cover.clear();
    if (!isNew) loadSnap(code);
    dirtyMeta = true;
    startGps();
    applyWake();
    sync();
    updateStatus();
    if (isNew) toast("Hópur búinn til. Ýttu á kóðann efst til að bjóða hinum.", 6000);
    else if (!LS.get("tipShown", false)) {
      LS.set("tipShown", true);
      toast("Hafðu Smala opinn með skjáinn kveiktan á meðan þú smalar.", 6000);
    }
  }

  function showJoin(prefillCode) {
    $("nameInput").value = me.name || "";
    $("codeInput").value = prefillCode || "";
    $("join").hidden = false;
    setTimeout(() => (me.name ? $("codeInput") : $("nameInput")).focus(), 50);
  }

  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("nameInput").value.replace(/\s+/g, " ").trim();
    if (!name) return $("nameInput").focus();
    let code = $("codeInput").value.trim().toUpperCase();
    let isNew = false;
    if (!code) {
      code = genCode();
      isNew = true;
    }
    if (!/^[A-Z0-9]{4,12}$/.test(code)) return toast("Kóðinn þarf að vera 4 til 12 stafir eða tölustafir, án íslenskra stafa.");
    me.name = name;
    enterGroup(code, isNew);
  });
  $("newGroupBtn").addEventListener("click", () => {
    $("codeInput").value = "";
    $("joinForm").requestSubmit();
  });

  async function share() {
    const url = location.origin + "/?g=" + group;
    const text = `Vertu með í smalamennskunni á Smala. Hópkóði: ${group}`;
    try {
      if (navigator.share) return await navigator.share({ title: "Smali", text, url });
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Hlekkur afritaður: " + url);
    } catch {
      toast(url, 8000);
    }
  }

  // ---------- Valmynd ----------
  function openMenu() {
    $("helpBtn").classList.toggle("on", help);
    $("helpBtn").textContent = help ? "Hætta við aðstoðarbeiðni" : "Ég þarf aðstoð";
    $("wakeChk").checked = wake;
    $("trailChk").checked = showTrails;
    $("lineChk").checked = showLine;
    $("coverChk").checked = showCover;
    document.querySelectorAll("[data-cover]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.cover === coverM)));
    document.querySelectorAll("[data-lag]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.lag === lagM)));
    $("renameInput").value = me.name;
    const info = LS.get("dlInfo", null);
    $("dlInfo").textContent = info
      ? `Síðast vistað ${new Date(info.when).toLocaleDateString("is-IS")}: ${info.n} kortaflísar.`
      : "Gerðu þetta heima á Wi-Fi áður en lagt er af stað. Þysjaðu fyrst þannig að allt smalasvæðið sjáist.";
    $("tip").textContent = isIOS
      ? "Á iPhone hættir síminn að senda staðsetningu þegar skjárinn slokknar eða þú skiptir yfir í annað app. Hafðu Smala opinn og bættu honum á heimaskjáinn (Deila, svo Bæta á heimaskjá) svo vistuðu kortin haldist."
      : "Síminn hættir að senda staðsetningu ef þú skiptir yfir í annað app eða skjárinn slokknar. Hafðu Smala opinn á meðan þú smalar. Bættu honum á heimaskjáinn svo vistuðu kortin haldist.";
    $("menu").hidden = false;
  }
  function closeOverlay(el) {
    el.hidden = true;
  }
  $("menuBtn").addEventListener("click", openMenu);
  $("menu").addEventListener("click", (e) => {
    if (e.target === $("menu") || e.target.closest("[data-close]")) closeOverlay($("menu"));
  });
  $("helpBtn").addEventListener("click", () => {
    help = !help;
    LS.set("help", help);
    dirtyMeta = true;
    $("helpBtn").classList.toggle("on", help);
    $("helpBtn").textContent = help ? "Hætta við aðstoðarbeiðni" : "Ég þarf aðstoð";
    toast(help ? "Allir í hópnum sjá að þú þarft aðstoð." : "Aðstoðarbeiðni afturkölluð.");
    render();
    sync();
  });
  $("shareBtn").addEventListener("click", share);
  $("codeBtn").addEventListener("click", () => group && share());
  $("wakeChk").addEventListener("change", (e) => {
    wake = e.target.checked;
    LS.set("wake", wake);
    applyWake();
  });
  $("coverChk").addEventListener("change", (e) => {
    showCover = e.target.checked;
    LS.set("cover", showCover);
    cover.setVisible(showCover);
    coverAreaAt = 0;
    render();
  });
  document.querySelectorAll("[data-cover]").forEach((b) =>
    b.addEventListener("click", () => {
      coverM = +b.dataset.cover;
      LS.set("coverM", coverM);
      cover.setRadius(coverM);
      document.querySelectorAll("[data-cover]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      coverAreaAt = 0;
      render();
    })
  );
  $("lineChk").addEventListener("change", (e) => {
    showLine = e.target.checked;
    LS.set("line", showLine);
    render();
  });
  document.querySelectorAll("[data-lag]").forEach((b) =>
    b.addEventListener("click", () => {
      lagM = +b.dataset.lag;
      LS.set("lagM", lagM);
      document.querySelectorAll("[data-lag]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      render();
    })
  );
  $("trailChk").addEventListener("change", (e) => {
    showTrails = e.target.checked;
    LS.set("trails", showTrails);
    if (showTrails) trailLayer.addTo(map);
    else map.removeLayer(trailLayer);
  });
  $("renameInput").addEventListener("change", (e) => {
    const n = e.target.value.replace(/\s+/g, " ").trim();
    if (!n) return;
    me.name = n;
    LS.set("me", me);
    dirtyMeta = true;
    sync();
  });
  $("leaveBtn").addEventListener("click", async () => {
    if (!confirm("Hætta að deila staðsetningu og fara úr hópnum?")) return;
    const code = group;
    group = null;
    clearTimeout(syncTimer);
    stopGps();
    LS.del("group");
    LS.del("snap");
    queue = [];
    LS.set("queue", queue);
    help = false;
    LS.set("help", false);
    try {
      await fetchT(`/api/g/${code}/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: me.id, leave: true }) }, 8000);
    } catch {}
    for (const p of people.values()) {
      if (p.marker) peopleLayer.removeLayer(p.marker);
      if (p.line) trailLayer.removeLayer(p.line);
    }
    people.clear();
    cover.clear();
    map.removeLayer(meMarker);
    map.removeLayer(meAcc);
    myPos = null;
    firstFix = true;
    $("codeText").textContent = "—";
    closeOverlay($("menu"));
    renderHelp([]);
    history.replaceState(null, "", "/");
    showJoin("");
  });

  // ---------- Kort vistuð offline ----------
  const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const lat2y = (lat, z) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  };
  function tileUrls(bounds, z0, z1) {
    const out = [];
    for (let z = z0; z <= z1; z++) {
      const x0 = lon2x(bounds.getWest(), z);
      const x1 = lon2x(bounds.getEast(), z);
      const y0 = lat2y(bounds.getNorth(), z);
      const y1 = lat2y(bounds.getSouth(), z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`/tile/${z}/${x}/${y}.png`);
    }
    return out;
  }
  let dlPlan = null;
  let dlCancel = false;
  let dlRunning = false;
  function planDownload() {
    const area = map.getBounds();
    let zmax = 16;
    let area_urls;
    for (;;) {
      area_urls = tileUrls(area, 9, zmax);
      if (area_urls.length <= MAX_TILES || zmax <= 11) break;
      zmax--;
    }
    const urls = Array.from(new Set(tileUrls(ICELAND, 5, 8).concat(area_urls)));
    return { urls, zmax };
  }
  $("dlBtn").addEventListener("click", () => {
    closeOverlay($("menu"));
    if (!("caches" in window)) return toast("Þessi vafri getur ekki vistað kort.");
    dlPlan = planDownload();
    const mb = Math.round((dlPlan.urls.length * TILE_KB) / 1024);
    let txt = `${dlPlan.urls.length} kortaflísar, um ${mb} MB. Nákvæmni upp í aðdrátt ${dlPlan.zmax}.`;
    if (dlPlan.zmax < 14) txt += " Svæðið er stórt. Þysjaðu nær ef þú vilt nákvæmari kort.";
    if (dlPlan.urls.length > MAX_TILES + 400) txt += " Þetta er mikið. Þysjaðu nær til að minnka svæðið.";
    $("dlText").textContent = txt;
    $("dlProg").value = 0;
    $("dlGo").hidden = false;
    $("dlGo").disabled = false;
    $("dlCancel").textContent = "Hætta við";
    $("dl").hidden = false;
  });
  $("dlCancel").addEventListener("click", () => {
    if (dlRunning) dlCancel = true;
    else closeOverlay($("dl"));
  });
  $("dlGo").addEventListener("click", async () => {
    if (!dlPlan || dlRunning) return;
    dlRunning = true;
    dlCancel = false;
    $("dlGo").disabled = true;
    try {
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    } catch {}
    const cache = await caches.open(TILE_CACHE);
    const urls = dlPlan.urls;
    let done = 0;
    let fail = 0;
    let i = 0;
    const worker = async () => {
      while (i < urls.length && !dlCancel) {
        const u = urls[i++];
        try {
          if (!(await cache.match(u))) {
            const r = await fetchT(u, {}, 30000);
            if (r.ok) await cache.put(u, r);
            else fail++;
          }
        } catch {
          fail++;
        }
        done++;
        $("dlProg").value = done / urls.length;
        $("dlText").textContent = `Vista ${done} af ${urls.length}…`;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    dlRunning = false;
    const ok = done - fail;
    if (!dlCancel) LS.set("dlInfo", { when: Date.now(), n: ok });
    $("dlText").textContent = dlCancel
      ? `Hætt við. ${ok} flísar vistaðar.`
      : fail
        ? `${ok} flísar vistaðar, ${fail} mistókust. Reyndu aftur til að klára.`
        : `Búið. ${ok} kortaflísar eru vistaðar í símanum og virka án sambands.`;
    $("dlGo").hidden = true;
    $("dlCancel").textContent = "Loka";
  });

  // ---------- Hnappar og atburðir ----------
  $("meBtn").addEventListener("click", () => {
    if (!myPos) return toast(gpsState === "denied" ? "Leyfðu staðsetningu fyrir þessa síðu í stillingum símans." : "Bíð eftir GPS…");
    setFollow(true);
    map.setView([myPos.lat, myPos.lon], Math.max(map.getZoom(), 15));
  });
  $("fitBtn").addEventListener("click", () => {
    const pts = [];
    for (const [id, p] of people) if (id !== me.id && p.last) pts.push([p.last.lat, p.last.lon]);
    if (myPos) pts.push([myPos.lat, myPos.lon]);
    if (!pts.length) return toast("Enginn á kortinu ennþá.");
    setFollow(false);
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(pts, { padding: [70, 70], maxZoom: 16 });
  });
  $("sheetHandle").addEventListener("click", () => {
    const open = $("sheet").classList.toggle("open");
    $("sheetHandle").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("visibilitychange", () => {
    applyWake();
    if (document.visibilityState === "visible" && group) sync();
  });
  window.addEventListener("online", () => group && sync());
  window.addEventListener("offline", updateStatus);
  setInterval(() => {
    if (group) {
      render();
      updateStatus();
    }
  }, 5000);

  if (navigator.getBattery) {
    navigator
      .getBattery()
      .then((b) => {
        const upd = () => (batt = Math.round(b.level * 100) / 100);
        upd();
        b.addEventListener("levelchange", upd);
      })
      .catch(() => {});
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }


  // ---------- Sýnishorn: /?demo ----------
  // Hermdir smalar ganga í línu frá staðsetningunni þinni að Úthlíð, á alvöru korti Landmælinga.
  // Ekkert er sent á netþjóninn.
  function startDemo() {
    const UTHLID = { lat: 64.2798, lon: -20.4464 };
    const MAX_KM = 20; // lengra en þetta er ekki smalamennska: byrjum þá nær Úthlíð
    const START_KM = 8;
    let speed = 10;
    let simT = 0;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const toR = Math.PI / 180;
    const offset = (p, km, deg) => ({
      lat: p.lat + (km * 1000 * Math.cos(deg * toR)) / 111320,
      lon: p.lon + (km * 1000 * Math.sin(deg * toR)) / (111320 * Math.cos(p.lat * toR)),
    });

    $("codeText").textContent = "SÝNI";
    document.body.classList.add("demo");
    $("join").hidden = true;
    me.name = me.name || "Þú";
    L.marker([UTHLID.lat, UTHLID.lon], {
      icon: L.divIcon({ className: "", html: '<div class="fold">Úthlíð</div>', iconSize: [0, 0] }),
      interactive: false,
    }).addTo(map);

    const tag = document.createElement("button");
    tag.className = "demo-tag";
    const setTag = () => (tag.textContent = `${speed}× hraði · ýttu til að breyta`);
    setTag();
    tag.addEventListener("click", () => {
      speed = speed === 1 ? 10 : speed === 10 ? 30 : 1;
      setTag();
    });
    document.body.appendChild(tag);

    let sim = null;
    function begin(startPos, note) {
      const total = dist(startPos, UTHLID) / 1000;
      let start = startPos;
      if (total > MAX_KM) {
        start = offset(UTHLID, START_KM, bearing(UTHLID, startPos));
        note = `Þú ert ${Math.round(total)} km frá Úthlíð. Smalarnir byrja ${START_KM} km frá Úthlíð í áttina til þín.`;
      }
      const toEnd = bearing(start, UTHLID);
      const spec = [
        { id: "demo-h", name: "Halla", x: -2, batt: 0.52, stuckAt: 900 },
        { id: "demo-g", name: "Gunna", x: -1, batt: 0.64 },
        { id: "demo-s", name: "Siggi", x: 1, batt: 0.41, offline: (t) => ((t + 150) % 480) < 260 },
        { id: "demo-a", name: "Anna", x: 2, batt: 0.88 },
        { id: "demo-j", name: "Jói", x: 3, batt: 0.23, speed: (t) => 1.15 + 0.55 * Math.sin(t / 380 + 0.4) },
      ];
      const spacing = 0.3; // km á milli smala
      sim = spec.map((sp) => {
        const p0 = offset(start, sp.x * spacing, toEnd + 90);
        return {
          ...sp, lat: p0.lat, lon: p0.lon, x0: sp.x * spacing, heading: toEnd,
          speed: sp.speed || (() => 1.15), offline: sp.offline || (() => false),
          pending: [], trail: [], lastRec: null, help: false,
        };
      });
      sim.toEnd = toEnd;
      for (let i = 0; i < 1200; i++) step(1); // 20 mínútna forsaga
      push();
      const pts = sim.map((h) => [h.lat, h.lon]);
      map.fitBounds(pts.concat([[UTHLID.lat, UTHLID.lon]]), { padding: [60, 60], maxZoom: 15 });
      if (note) toast(note, 7000);
    }
    // markmið hvers smala: Úthlíð, en línan þrengist eftir því sem nær dregur
    function targetOf(h) {
      return offset(UTHLID, h.x0 * 0.25, sim.toEnd + 90);
    }
    function step(dt) {
      simT += dt;
      for (const h of sim) {
        if (h.stuckAt != null && simT >= h.stuckAt) h.help = true;
        else {
          const tg = targetOf(h);
          if (dist(h, tg) > 60) {
            const want = bearing(h, tg);
            const diff = ((want - h.heading + 540) % 360) - 180;
            h.heading = (h.heading + diff * 0.15 + (rnd() - 0.5) * 30 + 360) % 360;
            const m = Math.max(0.2, h.speed(simT)) * dt;
            const n = offset(h, m / 1000, h.heading);
            h.lat = n.lat;
            h.lon = n.lon;
          }
        }
        const pt = { t: simT, lat: h.lat, lon: h.lon };
        if (!h.lastRec || dist(h.lastRec, pt) >= MIN_DIST || simT - h.lastRec.t >= MIN_DT / 1000) {
          h.lastRec = pt;
          h.pending.push([simT, h.lat, h.lon]);
        }
        if (!h.offline(simT) && h.pending.length) {
          h.trail.push(...h.pending);
          h.pending = [];
        }
      }
    }
    // hermdi tíminn er í sekúndum; færður yfir á klukkuna núna svo „síðast séð“ virki
    function push() {
      skew = 0;
      for (const h of sim) {
        if (!h.trail.length) continue;
        let p = people.get(h.id);
        if (!p) people.set(h.id, (p = { trail: [], marker: null, line: null, html: "" }));
        const now = Date.now();
        const shift = (t) => now - (simT - t) * 1000;
        p.name = h.name;
        p.help = h.help;
        p.batt = h.batt;
        p.trail = h.trail.map(([t, la, lo]) => [shift(t), la, lo]);
        const l = p.trail[p.trail.length - 1];
        p.last = { t: l[0], lat: l[1], lon: l[2], acc: 8 };
        p.trailDirty = true;
      }
      render();
      updateStatus();
    }

    // Staðsetningin þín er upphafspunkturinn; ef GPS svarar ekki byrjum við norðan við Úthlíð
    startGps();
    let started = false;
    const go = (pos, note) => {
      if (started) return;
      started = true;
      begin(pos, note);
    };
    const waitGps = setInterval(() => {
      if (myPos) {
        clearInterval(waitGps);
        go({ lat: myPos.lat, lon: myPos.lon });
      }
    }, 300);
    setTimeout(() => {
      if (!started) {
        clearInterval(waitGps);
        go(offset(UTHLID, START_KM, 20), "Næ ekki staðsetningunni þinni, svo smalarnir byrja norðan við Úthlíð.");
      }
    }, 12000);
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      let dt = Math.min(5, (now - last) / 1000) * speed;
      last = now;
      if (!sim) return;
      while (dt > 0) {
        const d = Math.min(1, dt);
        step(d);
        dt -= d;
      }
      push();
    }, 1000);
  }

  // ---------- Ræsing ----------
  const urlCode = (new URLSearchParams(location.search).get("g") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (DEMO) {
    startDemo();
  } else if (group && me.name && (!urlCode || urlCode === group)) {
    enterGroup(group, false);
  } else {
    showJoin(urlCode || group || "");
  }
  updateStatus();
})();
