// Thin adapter over `pg` that mimics node:sqlite's DatabaseSync surface
// (`.prepare(sql).get(...)/.all(...)/.run(...)`, `.exec(sql)`) so the rest
// of the codebase (lib/content/db.js, lib/identity/db.js and everything
// built on them in *service.js) didn't need a line-by-line SQL rewrite —
// only `await` added at call sites, since a real network database can't
// be queried synchronously the way SQLite could.
//
// Translates SQLite's positional `?` placeholders to Postgres's `$1, $2,
// ...` so the hundreds of existing query strings didn't need touching.
// Do NOT write new queries with a literal `?` followed by other
// Postgres-only syntax (e.g. `?::jsonb`) — this adapter doesn't know the
// difference; keep placeholders plain.
import pg from "pg";

const { Pool } = pg;

function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class PreparedStatement {
  constructor(db, sql) {
    this.db = db; // the owning PgDatabase — for both .pool and ensureReady()
    this.sql = toPositional(sql);
  }

  // Returns the first row, or undefined — matches node:sqlite's .get().
  async get(...params) {
    await this.db.ensureReady();
    const res = await this.db.pool.query(this.sql, params);
    return res.rows[0];
  }

  // Returns all rows — matches node:sqlite's .all().
  async all(...params) {
    await this.db.ensureReady();
    const res = await this.db.pool.query(this.sql, params);
    return res.rows;
  }

  // Matches node:sqlite's .run(): { changes, lastInsertRowid }.
  // This schema never relies on serial/auto-increment ids (every table
  // uses a TEXT id minted with crypto.randomUUID() before the INSERT), so
  // lastInsertRowid is never actually read anywhere — it's provided only
  // for shape-compatibility, from a RETURNING id if the query happens to
  // have one.
  async run(...params) {
    await this.db.ensureReady();
    const res = await this.db.pool.query(this.sql, params);
    return { changes: res.rowCount, lastInsertRowid: res.rows[0]?.id };
  }
}

export class PgDatabase {
  constructor(pool) {
    this.pool = pool;
    this._readyPromise = null;
    this._initializer = null;
  }

  // Registers a one-time async setup step (schema creation, seed rows) to
  // run lazily before the FIRST real query — not at module-import time.
  // This matters specifically because Next.js imports every API route
  // module during `next build` (to collect route config) without ever
  // running the route — if schema setup ran at import time instead, the
  // build itself would try to open a real Postgres connection and fail
  // wherever no database is reachable (e.g. a CI/build container). See
  // lib/content/db.js / lib/identity/db.js for what gets registered here.
  setInitializer(fn) {
    this._initializer = fn;
  }

  // Called automatically by PreparedStatement's get/all/run below, so
  // every real query is preceded by schema setup exactly once per
  // process, however many times it's called or from however many
  // call sites.
  ensureReady() {
    if (!this._readyPromise) {
      this._readyPromise = this._initializer ? this._initializer() : Promise.resolve();
    }
    return this._readyPromise;
  }

  prepare(sql) {
    return new PreparedStatement(this, sql);
  }

  // Runs a (possibly multi-statement, semicolon-separated) DDL/seed
  // block. node-postgres's simple query protocol executes multi-statement
  // strings fine, same as node:sqlite's .exec() did. Deliberately does
  // NOT call ensureReady() itself — this is the primitive schema-creation
  // code uses internally (see the initializer functions in db.js), and
  // having it wait on its own readiness would deadlock.
  async exec(sql) {
    await this.pool.query(sql);
  }
}

// One pool per logical store, reused by lib/content/db.js and
// lib/identity/db.js respectively. Both default to DATABASE_URL (one
// Postgres instance, two SQL schemas — "identity" and "content" — for
// the logical separation), but each can be pointed at a genuinely
// separate Postgres instance/database via IDENTITY_DATABASE_URL /
// CONTENT_DATABASE_URL, preserving the option of true physical
// separation the old two-SQLite-file design had, for anyone who wants
// the PII store on different hardware/access controls than the content
// store. See DEPLOYMENT.md.
const pools = new Map();

export function getPool(name, { searchPath } = {}) {
  if (pools.has(name)) return pools.get(name);
  const envKey = `${name.toUpperCase()}_DATABASE_URL`;
  const connectionString = process.env[envKey] || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      `${envKey} or DATABASE_URL is not set. Set it to your Postgres ` +
        `connection string (see .env.local.example and DEPLOYMENT.md).`
    );
  }
  const pool = new Pool({
    connectionString,
    // Railway/Fly/most managed Postgres providers terminate TLS with a
    // cert that isn't in Node's default CA bundle; this matches how
    // every popular managed-Postgres quickstart configures `pg`. Set
    // PGSSL=disable for a local, non-TLS Postgres (e.g. `docker run
    // postgres` on your own machine).
    // Set PGSSL_VERIFY=true (and PG_CA_CERT to your provider's CA, if needed) to verify the database's certificate
    // and block man-in-the-middle attacks. Left off by default so existing deployments keep connecting.
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: process.env.PGSSL_VERIFY === "true", ...(process.env.PG_CA_CERT ? { ca: process.env.PG_CA_CERT } : {}) },
    max: Number(process.env.PG_POOL_MAX || 20),
    // Sets the schema as a connection STARTUP parameter, so every pooled
    // connection is already pointed at the right schema the moment it
    // opens. (The previous approach ran `SET search_path` from a "connect"
    // event handler without awaiting it, which let a real query start on
    // the same connection first — that race is what produced pg's
    // "client.query() while already executing a query" deprecation
    // warning, and could in principle run a query against the wrong
    // schema.) A schema that doesn't exist yet is fine here; it only needs
    // to exist by the time a query actually references it.
    ...(searchPath ? { options: `-c search_path=${searchPath}` } : {}),
  });
  pools.set(name, pool);
  return pool;
}
