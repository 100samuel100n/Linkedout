"use client";
import ErrorNote from "@/components/ErrorNote";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Plus, Lock, Sparkles } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import RoomCard from "@/components/RoomCard";
import { useAuth } from "@/app/auth-provider";
import Loading from "@/components/ui/Loading";
import Select from "@/components/ui/Select";

function CreateRoomForm({ onCreated, onCancel }) {
  const [topic, setTopic] = useState("");
  const [vibe, setVibe] = useState("Vent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!topic.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const room = await api.createRoom({ topic: topic.trim(), vibe, mode: "alias" });
      onCreated(room);
    } catch (e) {
      setError(e.status === 401 ? "Log in to start a room." : e.message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "8px 10px", fontSize: 13, width: "100%" };

  return (
    <div style={{ background: C.surface, border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 10 }} className="p-4 flex flex-col gap-2">
      <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What's this room about?" maxLength={80} style={inputStyle} />
      <Select value={vibe} onChange={(e) => setVibe(e.target.value)} style={inputStyle}>
        {["Vent", "Support", "Comedy", "Story"].map((v) => <option key={v} value={v}>{v}</option>)}
      </Select>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!topic.trim() || busy} style={{ ...monoFont, fontSize: 12, color: "#FFFFFF", background: C.mustard, border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, cursor: "pointer" }}>{busy ? "starting…" : "Start room"}</button>
        <button onClick={onCancel} style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

// Basic can't join or start; Plus can join only; Pro can do both — see
// lib/tiers.js (the actual server-side enforcement lives there; this is
// just the matching UI so someone on Basic sees an upgrade prompt
// instead of a confusing 403 after tapping a room).
function tierFor(user) {
  return user?.effectiveTier || user?.premiumTier || "basic";
}

export default function VentPage() {
  const { user } = useAuth();
  const [rooms, setRooms] = useState(null);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const [openId, setOpenId] = useState(null); // room the user just created — opens straight into it

  useEffect(() => {
    let stop = false;
    const load = () => api.getRooms().then((r) => { if (!stop) setRooms(r); }).catch((e) => { if (!stop) setError(e.message); });
    load();
    // Keep the list fresh: new sessions appear, ended ones drop off.
    const t = setInterval(load, 15000);
    return () => { stop = true; clearInterval(t); };
  }, [user?.email]);

  function handleCreated(room) {
    setRooms((rs) => [room, ...(rs || [])]);
    setOpenId(room.id);
    setShowCreate(false);
  }

  const tier = tierFor(user);
  const canCreate = tier === "pro";
  const canJoin = true; // every plan can join Vent Rooms; only starting one is OUT PRO

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2" style={{ ...monoFont, fontSize: 12, color: C.muted }}>
          <ShieldCheck size={13} /> identity hidden between participants · live audio
        </div>
        {user && !showCreate && canCreate && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1" style={{ ...monoFont, fontSize: 12, color: C.mustard, border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 20, padding: "4px 10px", background: "none", cursor: "pointer" }}>
            <Plus size={12} /> Start a room
          </button>
        )}
        {user && !canCreate && (
          <Link href="/premium" className="flex items-center gap-1" style={{ ...monoFont, fontSize: 12, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 20, padding: "4px 10px", textDecoration: "none" }}>
            <Lock size={11} /> Starting a room needs OUT PRO
          </Link>
        )}
      </div>
      {showCreate && <CreateRoomForm onCreated={handleCreated} onCancel={() => setShowCreate(false)} />}
      {error && <div style={{ ...monoFont, fontSize: 12, color: C.flag }}>couldn't load rooms: {error}</div>}
      {!rooms && !error && <Loading variant="list" />}
      {rooms && rooms.length === 0 && <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>No rooms open yet{canCreate ? " — start one." : "."}</div>}
      {rooms && rooms.map((r) => (
        <RoomCard
          key={r.id}
          room={r}
          canJoin={canJoin}
          autoJoin={r.id === openId}
          onDeleted={(id) => setRooms((rs) => (rs || []).filter((x) => x.id !== id))}
        />
      ))}
    </div>
  );
}
