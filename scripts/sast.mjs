// Lightweight static security scan: `npm run sast`. Not a replacement for CodeQL/Semgrep in CI, but it catches the
// mistakes that most often cause real incidents here: hard-coded secrets, eval, raw HTML injection, shell exec,
// string-built SQL and disabled TLS checks. Exits 1 if any HIGH finding exists.
import fs from "node:fs";
import path from "node:path";
const RULES = [
  ["HIGH", "Hard-coded secret", /(sk_live_|sk_test_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----|xox[abp]-[A-Za-z0-9-]{10,})/],
  ["HIGH", "eval / new Function", /\b(eval\s*\(|new Function\s*\()/],
  ["HIGH", "TLS verification disabled", /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/],
  ["HIGH", "Shell execution", /child_process|\bexecSync\s*\(/],
  ["MEDIUM", "dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
  ["MEDIUM", "SQL built with template string", /\.(prepare|exec)\(\s*`[^`]*\$\{(?!.*\bplaceholders\b)/],
  ["LOW", "Math.random for tokens", /Math\.random\(\)\.toString\(36\)/],
];
const SKIP = new Set(["node_modules", ".next", ".git", "public", "scripts"]);
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|jsx|mjs|ts|tsx)$/.test(e.name)) files.push(p); } })(".");
let high = 0; const out = [];
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => { if (/sast-ignore/.test(line) || /^\s*(\/\/|\*)/.test(line)) return; for (const [sev, name, re] of RULES) if (re.test(line)) { out.push(`${sev.padEnd(6)} ${name}  ${f}:${i + 1}`); if (sev === "HIGH") high++; } });
}
console.log(out.length ? out.join("\n") : "No findings.");
console.log(`\n${files.length} files scanned, ${out.length} finding(s), ${high} high.`);
process.exit(high ? 1 : 0);
