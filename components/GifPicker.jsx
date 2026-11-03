"use client";
import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";

export default function GifPicker({ onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef(null);

  useEffect(() => {
    runSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runSearch(q) {
    setLoading(true);
    api.searchGifs(q)
      .then((res) => { setConfigured(res.configured); setResults(res.results || []); })
      .catch(() => { setResults([]); })
      .finally(() => setLoading(false));
  }

  function handleType(v) {
    setQuery(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(v), 350);
  }

  return (
    <div
      style={{
        position: "absolute", bottom: "100%", left: 0, marginBottom: 8, zIndex: 20,
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16,
        padding: 10, width: 300, boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
      }}
      className="lo-toast flex flex-col gap-2"
    >
      <div className="flex items-center gap-2" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px" }}>
        <Search size={13} color={C.muted} />
        <input
          autoFocus
          value={query}
          onChange={(e) => handleType(e.target.value)}
          placeholder="Search GIFs…"
          style={{ ...monoFont, fontSize: 12, background: "none", border: "none", outline: "none", color: C.text, flex: 1 }}
        />
      </div>

      {!configured ? (
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, padding: "12px 4px", textAlign: "center" }}>
          GIF search isn't available right now.
        </div>
      ) : loading ? (
        <div className="grid grid-cols-3 gap-1.5">
          {[...Array(6)].map((_, i) => <div key={i} className="lo-skeleton" style={{ height: 70 }} />)}
        </div>
      ) : results.length === 0 ? (
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, padding: "12px 4px", textAlign: "center" }}>No GIFs found.</div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5" style={{ maxHeight: 220, overflowY: "auto" }}>
          {results.map((g) => (
            <button
              key={g.id}
              onClick={() => { onSelect(g.url); onClose?.(); }}
              className="lo-tap"
              style={{ border: "none", padding: 0, borderRadius: 6, overflow: "hidden", cursor: "pointer", background: C.surface2 }}
            >
              <img src={g.previewUrl} alt={g.title} style={{ width: "100%", height: 70, objectFit: "cover", display: "block" }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
