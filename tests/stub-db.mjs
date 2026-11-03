import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
export const identityDb = {
  exec: async (sql) => {
    // sqlite has no "ADD COLUMN IF NOT EXISTS" (Postgres does): run ALTERs one by one and ignore "duplicate column"
    for (const part of String(sql).split(";").map((x) => x.trim()).filter(Boolean)) {
      const q = part.replace(/ADD COLUMN IF NOT EXISTS/gi, "ADD COLUMN");
      try { db.exec(q); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
    }
  },
  prepare: (sql) => { if (/^\s*ALTER/i.test(sql)) return { run: async () => { await identityDb.exec(sql); return { changes: 0 }; } }; const st = db.prepare(sql.replace(/\bBIGINT\b/g, "INTEGER")); return { run: async (...p) => { const r = st.run(...p); return { changes: Number(r.changes) }; }, get: async (...p) => st.get(...p), all: async (...p) => st.all(...p) }; },
};
export const alerts = [];
