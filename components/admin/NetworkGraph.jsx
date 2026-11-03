"use client";
import { useMemo, useState } from "react";
import { C, monoFont } from "@/lib/theme";
import { card } from "./ui";

// Follow-network map: node size = followers, red = mass-follow flag, blue edges =
// mutual follows (a common sign of follow rings / engagement pods). Layout is a
// small force simulation run once per dataset (no dependency).
export default function NetworkGraph({ graph }) {
  const [sel, setSel] = useState(null);
  const W = 760, H = 460;
  const pos = useMemo(() => {
    const nodes = graph.nodes.map((n, i) => ({ ...n, x: W / 2 + Math.cos(i) * 200 * Math.random(), y: H / 2 + Math.sin(i) * 150 * Math.random(), vx: 0, vy: 0 }));
    const idx = new Map(nodes.map((n) => [n.id, n]));
    const edges = graph.edges.map((e) => [idx.get(e.a), idx.get(e.b)]).filter(([a, b]) => a && b);
    for (let it = 0; it < 260; it++) {
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy + 0.01, f = 2600 / d2, d = Math.sqrt(d2);
        dx /= d; dy /= d; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const [a, b] of edges) { const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01, f = (d - 70) * 0.02; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
      for (const n of nodes) { n.vx += (W / 2 - n.x) * 0.004; n.vy += (H / 2 - n.y) * 0.004; n.x = Math.min(W - 14, Math.max(14, n.x + n.vx * 0.5)); n.y = Math.min(H - 14, Math.max(14, n.y + n.vy * 0.5)); n.vx *= 0.82; n.vy *= 0.82; }
    }
    return { nodes, edges };
  }, [graph]);
  if (!graph.nodes.length) return <div style={{ ...card, color: C.muted, marginBottom: 14 }}>Not enough follow data to draw a network yet.</div>;
  const r = (n) => 5 + Math.min(14, Math.sqrt(n.followers) * 2);
  return (
    <div style={{ ...card, marginBottom: 14, padding: 10 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", maxHeight: 460 }}>
        {pos.edges.map(([a, b], i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={a.id === sel?.id || b.id === sel?.id ? C.mustard : C.line} strokeOpacity={0.9} strokeWidth={a.id === sel?.id || b.id === sel?.id ? 1.8 : 0.8} />)}
        {pos.nodes.map((n) => (
          <g key={n.id} onClick={() => setSel(n)} style={{ cursor: "pointer" }}>
            <circle cx={n.x} cy={n.y} r={r(n)} fill={n.flagged ? C.flag : C.corpblue} fillOpacity={sel?.id === n.id ? 1 : 0.8} stroke={sel?.id === n.id ? C.text : "none"} />
            {r(n) > 9 && <text x={n.x} y={n.y - r(n) - 3} textAnchor="middle" fontSize="9" fill={C.muted}>{n.id}</text>}
          </g>
        ))}
      </svg>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span><span style={{ color: C.corpblue }}>●</span> account</span><span><span style={{ color: C.flag }}>●</span> mass-follow flag (24h)</span>
        <span>{sel ? `${sel.id} · ${sel.followers} follower${sel.followers === 1 ? "" : "s"} in this view${sel.flagged ? " · flagged" : ""}` : "Tap a node for details"}</span>
      </div>
    </div>
  );
}
