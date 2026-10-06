import assert from "node:assert/strict";
await import("../public/sweep.js");
const S = globalThis.SmaliSweep;
// 4 smalar í röð vestur-austur, ganga suður. C er 400 m aftar (norðar).
const m = 1 / 111320, k = 1 / (111320 * Math.cos(64.3 * Math.PI / 180));
function walker(id, x, behind) {
  const lat = 64.3 + behind * m, lon = -20.3 + x * k;
  return { id, lat, lon, stale: false, trail: [[0, lat + 300 * m, lon], [600, lat, lon]] };
}
const r = S.compute([walker("D", 1500, 0), walker("A", 0, 0), walker("C", 1000, 400), walker("B", 500, 20)], { lagM: 300, window: 300 });
const key = (s) => [s.a.id, s.b.id].sort().join("") + (s.red ? "!" : "");
assert.deepEqual(r.segs.map(key).sort(), ["AB", "BC!", "CD!"]);
assert.deepEqual(Object.keys(r.lag), ["C"]);
assert.ok(r.dir[1] < -0.99, "moving south");
// kyrr hópur: röð eftir línu hópsins, rautt án þess að vita hver er aftar
const still = [walker("A", 0, 0), walker("B", 500, 0), walker("C", 1000, 400)].map((w) => ({ ...w, trail: [] }));
const r2 = S.compute(still, { lagM: 300, window: 300 });
assert.equal(r2.dir, null); assert.equal(r2.segs.length, 2); assert.deepEqual(Object.keys(r2.lag), []);
// tveir kyrrir: engin lína (veit ekki ásinn)
assert.equal(S.compute(still.slice(0, 2), { lagM: 300, window: 300 }).segs.length, 0);
console.log("sweep tests ok", r2.segs.map((s) => s.a.id + s.b.id + (s.red ? "!" : "")));
// kyrr hópur með þekkta fyrri átt: C greinist aftarlega
const r3 = S.compute(still, { lagM: 300, window: 300, prevDir: r.dir });
assert.deepEqual(Object.keys(r3.lag), ["C"]);
console.log("prevDir ok");
