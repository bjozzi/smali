// Smalalína: tengir smalana í röð þvert á gönguna og finnur hver er of aftarlega.
// Notað bæði í appinu og í sýnishorninu.
(function (root) {
  "use strict";
  const toR = Math.PI / 180;

  // members: [{ id, lat, lon, stale, trail: [[t, lat, lon], ...] }]
  // opts: { lagM: metrar sem má dragast aftur úr, window: tími (sömu einingar og t) til að meta gönguátt,
  //         prevDir: síðasta gönguátt sem compute skilaði, notuð ef hópurinn stendur kyrr }
  function compute(members, opts) {
    const lagM = opts.lagM || 300;
    const win = opts.window;
    const pts = members.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon));
    const empty = { segs: [], lag: {}, dir: null };
    if (pts.length < 2) return empty;

    const lat0 = pts.reduce((s, m) => s + m.lat, 0) / pts.length;
    const lon0 = pts.reduce((s, m) => s + m.lon, 0) / pts.length;
    const kx = 111320 * Math.cos(lat0 * toR);
    const ky = 111320;
    const xy = (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];

    // Gönguátt hópsins: meðaltal af stefnu hvers smala síðustu mínútur
    let sx = 0, sy = 0, n = 0;
    for (const m of pts) {
      const tr = m.trail;
      if (!tr || tr.length < 2) continue;
      const end = tr[tr.length - 1];
      let start = tr[0];
      for (let i = tr.length - 2; i >= 0; i--) {
        if (end[0] - tr[i][0] >= win) { start = tr[i]; break; }
      }
      const dx = (end[2] - start[2]) * kx;
      const dy = (end[1] - start[1]) * ky;
      const L = Math.hypot(dx, dy);
      if (L < 30) continue; // stendur kyrr
      sx += dx / L; sy += dy / L; n++;
    }
    let fwd = null;
    let across;
    if (n && Math.hypot(sx, sy) > 0.4 * n) {
      const L = Math.hypot(sx, sy);
      fwd = [sx / L, sy / L];
      across = [fwd[1], -fwd[0]];
    } else if (opts.prevDir) {
      // Hópurinn stoppaði (t.d. beðið eftir kindum): notum síðustu þekktu gönguátt
      fwd = opts.prevDir;
      across = [fwd[1], -fwd[0]];
    } else if (pts.length >= 3) {
      // Engin átt þekkt ennþá: lína hópsins sjálf ræður röðinni
      let cxx = 0, cyy = 0, cxy = 0;
      for (const m of pts) {
        const [x, y] = xy(m.lat, m.lon);
        cxx += x * x; cyy += y * y; cxy += x * y;
      }
      const a = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      across = [Math.cos(a), Math.sin(a)];
    } else {
      return empty;
    }
    const axis = fwd || [-across[1], across[0]];

    const items = pts
      .map((m) => {
        const [x, y] = xy(m.lat, m.lon);
        return { m, u: x * across[0] + y * across[1], s: x * axis[0] + y * axis[1] };
      })
      .sort((a, b) => a.u - b.u);

    const segs = [];
    const lag = {};
    for (let i = 0; i < items.length - 1; i++) {
      const a = items[i], b = items[i + 1];
      const ds = b.s - a.s;
      const red = Math.abs(ds) > lagM;
      segs.push({ a: a.m, b: b.m, red, stale: !!(a.m.stale || b.m.stale), gap: Math.round(Math.abs(ds)) });
      if (red && fwd) {
        const behind = ds > 0 ? a : b; // sá sem er aftar í gönguáttinni
        lag[behind.m.id] = Math.max(lag[behind.m.id] || 0, Math.round(Math.abs(ds)));
      }
    }
    return { segs, lag, dir: fwd };
  }

  root.SmaliSweep = { compute };
})(typeof window !== "undefined" ? window : globalThis);
