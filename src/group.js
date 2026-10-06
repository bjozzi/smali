// Gögn eins hóps. Keyrir inni í Durable Object (einn per hópkóða) með SQLite.
// `sql` er ctx.storage.sql: sql.exec(query, ...bindings) -> cursor með toArray().
//
// Hannað fyrir ókeypis plan Cloudflare: ein köllun per samstillingu,
// einn skrifaður reitur per GPS punkt, og hreinsun gerð sjaldan (alarm).

const KEEP_MS = 3 * 24 * 3600 * 1000; // geymum slóðir í 3 daga
const MAX_PTS_PER_POST = 500;
const MAX_PTS_PER_READ = 20000;

export class GroupCore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS members(
      id TEXT PRIMARY KEY, name TEXT NOT NULL, help INTEGER NOT NULL DEFAULT 0,
      batt REAL, updated INTEGER NOT NULL,
      last_t INTEGER, lat REAL, lon REAL, acc REAL)`);
    // rx er raðnúmer móttöku (rowid), svo "allt nýtt síðan X" er ódýr bilaleit án aukavísis
    sql.exec(`CREATE TABLE IF NOT EXISTS pts(
      rx INTEGER PRIMARY KEY, id TEXT NOT NULL, t INTEGER NOT NULL,
      lat REAL NOT NULL, lon REAL NOT NULL, acc REAL)`);
  }

  get seq() {
    const row = this.sql.exec(`SELECT MAX(rx) AS m FROM pts`).toArray()[0];
    return (row && row.m) || 0;
  }

  post(body, now = Date.now()) {
    if (!body || typeof body !== "object") return { error: "bad_body" };
    const id = String(body.id || "");
    if (!/^[a-z0-9]{8,32}$/i.test(id)) return { error: "bad_id" };

    if (body.leave) {
      this.sql.exec(`DELETE FROM members WHERE id = ?`, id);
      return { ok: true };
    }

    // Upplýsingar um smalann eru bara sendar þegar þær breytast eða á 2 mín fresti
    if (body.name !== undefined) {
      const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 30) || "Smali";
      const help = body.help ? 1 : 0;
      const batt = Number.isFinite(body.batt) && body.batt >= 0 && body.batt <= 1 ? body.batt : null;
      this.sql.exec(
        `INSERT INTO members(id, name, help, batt, updated) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, help = excluded.help,
           batt = excluded.batt, updated = excluded.updated`,
        id, name, help, batt, now
      );
    }

    const raw = Array.isArray(body.pts) ? body.pts.slice(-MAX_PTS_PER_POST) : [];
    let newest = null;
    let accepted = 0;
    for (const p of raw) {
      if (!Array.isArray(p) || p.length < 3) continue;
      let [t, lat, lon, acc] = p;
      t = Math.round(Number(t));
      lat = Number(lat);
      lon = Number(lon);
      acc = Number.isFinite(Number(acc)) ? Math.round(Number(acc)) : null;
      if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      if (t < now - KEEP_MS) continue;
      if (t > now + 5 * 60 * 1000) t = now; // klukka símans of fljót
      lat = Math.round(lat * 1e6) / 1e6;
      lon = Math.round(lon * 1e6) / 1e6;
      this.sql.exec(`INSERT INTO pts(id, t, lat, lon, acc) VALUES(?, ?, ?, ?, ?)`, id, t, lat, lon, acc);
      accepted++;
      if (!newest || t > newest[0]) newest = [t, lat, lon, acc];
    }
    if (newest) {
      this.sql.exec(
        `UPDATE members SET last_t = ?, lat = ?, lon = ?, acc = ?
         WHERE id = ? AND (last_t IS NULL OR last_t < ?)`,
        newest[0], newest[1], newest[2], newest[3], id, newest[0]
      );
    }
    return { ok: true, accepted };
  }

  state(since, now = Date.now()) {
    since = Number.isFinite(since) && since >= 0 ? since : 0;
    const seq = this.seq;
    if (since > seq) since = 0; // gögnum var eytt: senda allt aftur
    const members = this.sql
      .exec(
        `SELECT id, name, help, batt, updated, last_t, lat, lon, acc FROM members
         WHERE updated > ? ORDER BY name`,
        now - KEEP_MS
      )
      .toArray();
    const rows = this.sql
      .exec(`SELECT rx, id, t, lat, lon FROM pts WHERE rx > ? ORDER BY rx LIMIT ?`, since, MAX_PTS_PER_READ)
      .toArray();
    const pts = {};
    for (const r of rows) (pts[r.id] ||= []).push([r.t, r.lat, r.lon]);
    const more = rows.length === MAX_PTS_PER_READ;
    const cursor = more ? rows[rows.length - 1].rx : Math.max(seq, since);
    return { now, cursor, more, members, pts };
  }

  // Ein köllun: senda eigin punkta og fá til baka allt nýtt frá hinum
  sync(body, since, now = Date.now()) {
    const r = this.post(body, now);
    if (r.error) return r;
    return { ...this.state(since, now), accepted: r.accepted || 0 };
  }

  cleanup(now = Date.now()) {
    this.sql.exec(`DELETE FROM pts WHERE t < ?`, now - KEEP_MS);
    this.sql.exec(`DELETE FROM members WHERE updated < ?`, now - KEEP_MS);
    const left = this.sql.exec(`SELECT COUNT(*) AS n FROM members`).toArray()[0].n;
    return left;
  }
}
