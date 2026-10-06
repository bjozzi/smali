// Líkir eftir ctx.storage.sql í Durable Object með node:sqlite (Node 22+)
import { DatabaseSync } from "node:sqlite";
export function makeSql() {
  const db = new DatabaseSync(":memory:");
  return {
    exec(q, ...b) {
      const st = db.prepare(q);
      const rows = /^\s*SELECT/i.test(q) ? st.all(...b) : (st.run(...b), []);
      return { toArray: () => rows };
    },
  };
}
