// Þekjukort: hvaða svæði er búið að ganga yfir.
// Hver slóð er teiknuð sem breiður borði (sjónlína til hvorrar handar), allir borðar í sama
// gegnsæja laginu svo skörun dekkist ekki. Svæði sem enginn hefur séð helst ólitað.
(function (root) {
  "use strict";
  const toR = Math.PI / 180;

  function create(map, opts = {}) {
    const color = opts.color || "#f2b705";
    let radius = opts.radius || 100; // metrar til hvorrar handar
    let visible = opts.visible !== false;
    const pane = map.createPane("cover");
    pane.style.zIndex = 350; // undir slóðum og merkjum
    pane.style.opacity = "0.38";
    pane.style.pointerEvents = "none";
    const lines = new Map(); // id -> { poly, segs }

    function weightPx() {
      const lat = map.getCenter().lat;
      const mpp = (40075016.686 * Math.cos(lat * toR)) / 2 ** (map.getZoom() + 8);
      return Math.max(2, (2 * radius) / mpp);
    }
    function restyle() {
      const w = weightPx();
      for (const l of lines.values()) l.poly.setStyle({ weight: w });
    }
    map.on("zoomend", restyle);

    // segs: [[[lat, lon], ...], ...] eins og slóðirnar
    function update(id, segs) {
      let l = lines.get(id);
      if (!l) {
        const poly = L.polyline(segs, { pane: "cover", color, opacity: 1, weight: weightPx(), lineCap: "round", lineJoin: "round", interactive: false });
        if (visible) poly.addTo(map);
        lines.set(id, (l = { poly, segs }));
      } else {
        l.poly.setLatLngs(segs);
        l.segs = segs;
      }
    }
    function remove(id) {
      const l = lines.get(id);
      if (l) map.removeLayer(l.poly);
      lines.delete(id);
    }
    function clear() {
      for (const id of [...lines.keys()]) remove(id);
    }
    function setRadius(m) {
      radius = m;
      restyle();
    }
    function setVisible(v) {
      visible = v;
      for (const l of lines.values()) {
        if (v) l.poly.addTo(map);
        else map.removeLayer(l.poly);
      }
    }

    // Flatarmál sem er þakið, í km². Reiknað á 20 m neti svo skörun telst bara einu sinni.
    function areaKm2() {
      const cell = 20;
      const pts = [];
      for (const l of lines.values()) for (const s of l.segs) for (const p of s) pts.push(p);
      if (!pts.length) return 0;
      const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const kx = 111320 * Math.cos(lat0 * toR);
      const ky = 111320;
      const r = radius / cell;
      const r2 = r * r;
      const seen = new Set();
      const mark = (cx, cy) => {
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
            if (dx * dx + dy * dy > r2) continue;
            seen.add((Math.round(cx) + dx) * 1048576 + (Math.round(cy) + dy));
          }
        }
      };
      for (const l of lines.values()) {
        for (const s of l.segs) {
          for (let i = 0; i < s.length; i++) {
            const x = (s[i][1] * kx) / cell;
            const y = (s[i][0] * ky) / cell;
            if (i === 0) { mark(x, y); continue; }
            const px = (s[i - 1][1] * kx) / cell;
            const py = (s[i - 1][0] * ky) / cell;
            const n = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / Math.max(1, r * 0.5)));
            for (let k = 1; k <= n; k++) mark(px + ((x - px) * k) / n, py + ((y - py) * k) / n);
          }
        }
      }
      return (seen.size * cell * cell) / 1e6;
    }

    return { update, remove, clear, setRadius, setVisible, areaKm2 };
  }

  root.SmaliCover = { create };
})(typeof window !== "undefined" ? window : globalThis);
