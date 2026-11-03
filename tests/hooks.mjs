// Test-only module loader: maps the "@/..." alias and swaps the Postgres client for node:sqlite so the distribution flow can run in plain node.
import path from "node:path"; import { pathToFileURL } from "node:url";
const root = path.resolve(import.meta.dirname, "..");
const stubs = { "@/lib/identity/db": "stub-db.mjs", "@/lib/flags": "stub-flags.mjs", "@/lib/session-cache": "stub-session.mjs", "@/lib/security/core": "stub-core.mjs", "@/lib/admin/enforce": "stub-enforce.mjs", "next/server": "stub-next.mjs" };
export async function resolve(spec, ctx, next) {
  if (stubs[spec]) return { url: pathToFileURL(path.join(root, "tests", stubs[spec])).href, shortCircuit: true };
  if (spec.startsWith("@/")) { const p = path.join(root, spec.slice(2)); return next(pathToFileURL(p.endsWith(".js") ? p : p + ".js").href, ctx); }
  return next(spec, ctx);
}
