// Pure, dependency-free WAF + bot rules, safe to import from proxy.js. Inspects the URL, query, a few headers and
// (when supplied) a request body. Conservative on purpose: rules match clear exploit shapes, not ordinary prose,
// because people post long free text here (stories, posts) and false positives block real users.
const RULES = [
  { id: "sqli", label: "SQL injection", re: /(\bunion\b[\s\S]{0,20}\bselect\b|\bselect\b[\s\S]{1,40}\bfrom\b[\s\S]{1,40}\b(information_schema|pg_catalog|sqlite_master)\b|'\s*(or|and)\s+'?\d+'?\s*=\s*'?\d+|;\s*(drop|truncate|alter)\s+table\b|\bsleep\s*\(\s*\d+\s*\)|\bpg_sleep\s*\(|\bbenchmark\s*\(|--\s*$)/i },
  { id: "xss", label: "Cross-site scripting", re: /(<\s*script\b|javascript\s*:|\bon(error|load|mouseover|focus)\s*=\s*["']?[^>\s]|<\s*iframe\b|<\s*svg[^>]*\bonload\b|document\.cookie)/i },
  { id: "traversal", label: "Path traversal", re: /(\.\.[\/\\]|%2e%2e(%2f|%5c|\/|\\)|\/etc\/(passwd|shadow)|\bboot\.ini\b|\/proc\/self\/)/i },
  { id: "cmdi", label: "Command injection", re: /(;|\||`|\$\()\s*(cat|ls|id|whoami|curl|wget|nc|bash|sh|powershell|cmd)\b/i },
  { id: "log4shell", label: "JNDI / Log4Shell", re: /\$\{\s*(jndi|env|sys|lower|upper)\s*:/i },
  { id: "ssrf", label: "SSRF probe", re: /(169\.254\.169\.254|metadata\.google\.internal|\blocalhost:\d+\/(admin|internal)|file:\/\/\/|gopher:\/\/)/i },
  { id: "scanner", label: "Known scanner path", re: /\/(\.env|\.git\/|wp-login\.php|wp-admin\/|xmlrpc\.php|phpmyadmin|\.aws\/credentials|server-status|actuator\/(env|heapdump)|\.DS_Store)/i },
];
const BAD_UA = /(sqlmap|nikto|nmap|masscan|acunetix|nessus|zgrab|dirbuster|gobuster|wpscan|havij|hydra|python-requests\/[01]\.|scrapy|httrack|libwww-perl)/i;
const GOOD_BOT = /(googlebot|bingbot|duckduckbot|applebot|yandexbot|baiduspider|slurp|facebookexternalhit|twitterbot|linkedinbot|whatsapp)/i;

export function wafInspect({ pathname = "", search = "", userAgent = "", referer = "", body = "" }) {
  let decoded = pathname + " " + search;
  try { decoded = decodeURIComponent(decoded.replace(/\+/g, " ")); } catch {}
  const hay = `${decoded} ${referer} ${String(body).slice(0, 4000)}`;
  for (const r of RULES) if (r.re.test(hay)) return { hit: true, rule: r.id, label: r.label };
  if (BAD_UA.test(userAgent) && !GOOD_BOT.test(userAgent)) return { hit: true, rule: "bad_ua", label: "Attack-tool user agent" };
  return { hit: false };
}
export const WAF_RULES = RULES.map((r) => ({ id: r.id, label: r.label })).concat([{ id: "bad_ua", label: "Attack-tool user agent" }]);
