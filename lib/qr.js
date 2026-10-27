// Dependency-free QR code generator (byte mode, error-correction level L,
// versions 1–10 → up to 271 bytes). Returns a square boolean matrix; render it
// as SVG on web or as Views on native. Used for the authenticator-app QR.
const BLOCKS = { // version: [ecc codewords per block, [data codewords per block...]]
  1: [7, [19]], 2: [10, [34]], 3: [15, [55]], 4: [20, [80]], 5: [26, [108]],
  6: [18, [68, 68]], 7: [20, [78, 78]], 8: [24, [97, 97]], 9: [30, [116, 116]], 10: [18, [68, 68, 69, 69]],
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

const EXP = new Array(512), LOG = new Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); }); g = next; } return g; }
function rsEcc(data, n) { const g = rsGen(n), res = new Array(n).fill(0); for (const d of data) { const f = d ^ res.shift(); res.push(0); if (f) g.slice(1).forEach((c, i) => { res[i] ^= mul(c, f); }); } return res; }

function codewords(bytes, version) {
  const [ecLen, sizes] = BLOCKS[version], dataCap = sizes.reduce((a, b) => a + b, 0);
  const bits = []; const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, version < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, dataCap * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataCap; pad ^= 0xec ^ 0x11) data.push(pad);
  let off = 0; const blocks = sizes.map((s) => { const d = data.slice(off, off + s); off += s; return { d, e: rsEcc(d, ecLen) }; });
  const out = []; for (let i = 0; i < Math.max(...sizes); i++) blocks.forEach((b) => { if (i < b.d.length) out.push(b.d[i]); });
  for (let i = 0; i < ecLen; i++) blocks.forEach((b) => out.push(b.e[i]));
  return out;
}

const bch = (v, poly, bitsLen) => { let r = v << bitsLen; const top = poly.toString(2).length; for (let i = r.toString(2).length - top; i >= 0; i--) if ((r >>> (i + top - 1)) & 1) r ^= poly << i; return r; };
const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0, (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

function build(cw, version, mask) {
  const n = 17 + 4 * version, M = Array.from({ length: n }, () => new Array(n).fill(false)), F = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r, c, v) => { if (r >= 0 && c >= 0 && r < n && c < n) { M[r][c] = v; F[r][c] = true; } };
  const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) { const d = Math.max(Math.abs(r - 3), Math.abs(c - 3)); set(r0 + r, c0 + c, d !== 2 && d !== 4 && r >= 0 && r <= 6 && c >= 0 && c <= 6); } };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[version];
  al.forEach((r, i) => al.forEach((c, j) => { if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return; for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1); }));
  set(n - 8, 8, true);
  // Reserve the format-info areas WITHOUT overwriting the timing pattern that crosses them at (6,8)/(8,6).
  const reserve = (r, c) => { if (!F[r][c]) set(r, c, false); };
  for (let i = 0; i < 9; i++) { reserve(8, i); reserve(i, 8); } for (let i = 0; i < 8; i++) { reserve(8, n - 1 - i); reserve(n - 1 - i, 8); }
  if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { set(i, n - 11 + j, false); set(n - 11 + j, i, false); }
  // zig-zag data placement
  const bits = []; cw.forEach((b) => { for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1); });
  let k = 0, up = true;
  for (let c = n - 1; c > 0; c -= 2) { if (c === 6) c--; for (let i = 0; i < n; i++) { const r = up ? n - 1 - i : i; for (let d = 0; d < 2; d++) { const cc = c - d; if (F[r][cc]) continue; let v = k < bits.length ? bits[k] === 1 : false; k++; if (MASKS[mask](r, cc)) v = !v; M[r][cc] = v; } } up = !up; }
  // format info (level L = 01)
  const fmt = ((bch((0b01 << 3) | mask, 0x537, 10) | (((0b01 << 3) | mask) << 10)) ^ 0x5412) & 0x7fff;
  const fb = (i) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) M[i][8] = fb(i); M[7][8] = fb(6); M[8][8] = fb(7); M[8][7] = fb(8); for (let i = 9; i < 15; i++) M[8][14 - i] = fb(i);
  for (let i = 0; i < 8; i++) M[8][n - 1 - i] = fb(i); for (let i = 8; i < 15; i++) M[n - 15 + i][8] = fb(i); M[n - 8][8] = true;
  if (version >= 7) { const vi = (version << 12) | bch(version, 0x1f25, 12); for (let i = 0; i < 18; i++) { const b = ((vi >>> i) & 1) === 1, a = Math.floor(i / 3), c = (i % 3) + n - 11; M[a][c] = b; M[c][a] = b; } }
  return M;
}
function penalty(M) {
  const n = M.length; let p = 0;
  for (let t = 0; t < 2; t++) for (let i = 0; i < n; i++) { let run = 1; for (let j = 1; j < n; j++) { const a = t ? M[j][i] : M[i][j], b = t ? M[j - 1][i] : M[i][j - 1]; if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (M[r][c] === M[r][c + 1] && M[r][c] === M[r + 1][c] && M[r][c] === M[r + 1][c + 1]) p += 3;
  const dark = M.flat().filter(Boolean).length; p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}
export function qrMatrix(text, forceMask = null) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 1; while (version <= 10 && bytes.length > BLOCKS[version][1].reduce((a, b) => a + b, 0) - (version < 10 ? 2 : 3)) version++;
  if (version > 10) throw new Error("Text too long for QR.");
  const cw = codewords(bytes, version);
  if (forceMask !== null) return build(cw, version, forceMask);
  let best = null, bp = Infinity; for (let m = 0; m < 8; m++) { const M = build(cw, version, m), p = penalty(M); if (p < bp) { bp = p; best = M; } }
  return best;
}
