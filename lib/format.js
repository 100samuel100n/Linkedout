// X-style compact counts: 999, 1K, 1.2K, 20K, 500K, 1.5M, 2B. Truncates (never
// rounds up across a boundary: 999,999 → "999K", not "1000K").
export function fmt(n) {
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (n < 1000) return String(n);
  const units = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [v, s] of units) {
    if (n >= v) {
      const x = n / v;
      const t = x >= 100 ? Math.floor(x) : Math.floor(x * 10) / 10;
      return `${String(t).replace(/\.0$/, "")}${s}`;
    }
  }
  return String(n);
}
