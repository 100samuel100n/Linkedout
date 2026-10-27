#!/usr/bin/env node
// Bootstrap / emergency role assignment — run by an operator with database
// access (same trust model as the break-glass and review scripts). After the
// first super_admin exists, roles are managed in the dashboard (Staff Admin).
//
//   node --env-file=.env.local scripts/make-staff.js --email you@x.com --role super_admin
//   node --env-file=.env.local scripts/make-staff.js --email you@x.com --role user      (revoke)
import { identityDb } from "../lib/identity/db.js";
import { ROLES } from "../lib/admin/roles.js";
const a = Object.fromEntries(process.argv.slice(2).reduce((o, v, i, arr) => (v.startsWith("--") ? [...o, [v.slice(2), arr[i + 1]]] : o), []));
if (!a.email || !ROLES[a.role]) { console.error(`Usage: --email <email> --role <${Object.keys(ROLES).join("|")}>`); process.exit(1); }
const r = await identityDb.prepare("UPDATE accounts SET role = ? WHERE lower(email) = lower(?)").run(a.role, a.email);
console.log(r.changes ? `${a.email} is now ${a.role}.` : "No account with that email.");
process.exit(0);
