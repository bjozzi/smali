import assert from "node:assert/strict";
import { GroupCore } from "../src/group.js";
import { tileBbox } from "../src/handler.js";
import { makeSql } from "./sqlshim.mjs";
const g = new GroupCore(makeSql());
const now = Date.now();
assert.equal(g.sync({ id: "bad" }, 0).error, "bad_id");
let s = g.sync({ id: "aaaaaaaa1", name: " Jón ", pts: [[now - 20000, 64.2, -20.5, 8], [now - 10000, 64.201, -20.501, 6]] }, 0, now);
assert.equal(s.accepted, 2); assert.equal(s.pts.aaaaaaaa1.length, 2); assert.equal(s.members[0].name, "Jón");
const cur = s.cursor;
// punktar án meta: skrifar bara punktinn
s = g.sync({ id: "bbbbbbbb2", name: "Gunna", help: true, batt: 0.4, pts: [[now - 60000, 64.3, -20.4, 20]] }, cur, now);
s = g.sync({ id: "aaaaaaaa1", pts: [[now - 30000, 64.199, -20.499, 9]] }, cur, now);
assert.equal(s.pts.bbbbbbbb2.length, 1); assert.equal(s.pts.aaaaaaaa1.length, 1);
assert.equal(s.members.find((m) => m.id === "aaaaaaaa1").lat, 64.201, "older point does not move marker");
assert.equal(s.members.find((m) => m.id === "aaaaaaaa1").name, "Jón", "name kept when meta omitted");
assert.equal(s.members.find((m) => m.id === "bbbbbbbb2").help, 1);
// cursor of hár -> allt aftur
assert.equal(g.state(9999, now).pts.aaaaaaaa1.length, 3);
// leave
g.sync({ id: "bbbbbbbb2", leave: true }, 0, now);
assert.equal(g.state(0, now).members.length, 1);
// hreinsun
assert.equal(g.cleanup(now + 4 * 86400000), 0);
assert.equal(Object.keys(g.state(0, now).pts).length, 0);
assert.equal(tileBbox(0, 0, 0), "-20037508.34,-20037508.34,20037508.34,20037508.34");
console.log("group tests ok");
