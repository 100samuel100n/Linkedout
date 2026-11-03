"use client";
import Link from "next/link";
import ErrorNote from "@/components/ErrorNote";
import { useState, useEffect } from "react";
import { Users, Info, Crown, Trash2, Lock } from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import { PulseDot } from "@/components/primitives";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import VentAudioRoom from "@/components/VentAudioRoom";
import { playSound } from "@/lib/sounds";

// canJoin comes from the parent page (Basic can't join rooms, Plus and Pro
// can; the server enforces the same rule). A host always gets the full set
// of controls: enter, run, end — and once ended, delete for good.
export default function RoomCard({ room: initialRoom, canJoin = true, autoJoin = false, onDeleted, onChanged }) {
  const { user } = useAuth();
  const [room, setRoom] = useState(initialRoom);
  const [joined, setJoined] = useState(autoJoin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Pick up list refreshes (listener count, host ended it...) while not inside.
  useEffect(() => { if (!joined) setRoom(initialRoom); }, [initialRoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const ended = room.ended || room.status === "ended";
  const isHost = !!room.isHost;

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.joinRoom(room.id);
      setRoom(updated);
      setJoined(true);
      playSound("join");
    } catch (e) {
      setError(e.status === 401 ? "Log in to join." : e.message);
      if (e.code === "ROOM_ENDED") { setRoom((r) => ({ ...r, ended: true, status: "ended" })); }
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setJoined(false);
    try { setRoom(await api.leaveRoom(room.id)); } catch { /* the server times out absent people on its own */ }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteRoom(room.id);
      onDeleted?.(room.id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${ended ? C.line : isHost ? alpha(C.mustard, 40) : C.line}`, borderRadius: 12, opacity: ended ? 0.92 : 1 }} className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div style={{ minWidth: 0 }}>
          <div className="flex items-center gap-2">
            {ended ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.line, display: "inline-block", flexShrink: 0 }} /> : room.live ? <PulseDot /> : <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.line, display: "inline-block", flexShrink: 0 }} />}
            <span style={{ ...displayFont, fontSize: 15, color: C.text, overflowWrap: "anywhere" }}>{room.topic}</span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap" style={{ ...monoFont, fontSize: 12, color: C.muted }}>
            <span>{room.vibe}</span>
            {room.storyId && <Link href={`/stories/${room.storyId}`} style={{ color: C.mustard, textDecoration: "none", fontWeight: 650 }}>about a story →</Link>}
            {ended
              ? <span>ended</span>
              : <span className="flex items-center gap-1"><Users size={12} /> {room.listeners} here</span>}
            {room.locked && !ended && <span className="flex items-center gap-1"><Lock size={11} /> locked</span>}
            {isHost && <span className="flex items-center gap-1" style={{ color: C.mustard }}><Crown size={11} /> you're the host</span>}
          </div>
        </div>
      </div>

      {!ended && (
        <div className="flex items-center gap-1.5" style={{ ...monoFont, fontSize: 12, color: C.muted }}>
          <Info size={11} /> Identity stays hidden — no real names or accounts are ever shared in a room.
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {ended ? (
        isHost ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>This session is over. Delete it to remove it for good.</span>
            {confirmDelete ? (
              <>
                <button onClick={remove} disabled={busy} className="lo-tap flex items-center gap-1.5" style={{ ...monoFont, fontSize: 12, color: "#fff", background: C.flag, border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700 }}><Trash2 size={12} /> {busy ? "deleting…" : "Yes, delete"}</button>
                <button onClick={() => setConfirmDelete(false)} className="lo-tap" style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>Keep</button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="lo-tap flex items-center gap-1.5" style={{ ...monoFont, fontSize: 12, color: C.flag, background: "none", border: `1px solid ${alpha(C.flag, 45)}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}><Trash2 size={12} /> Delete session</button>
            )}
          </div>
        ) : (
          <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>The host ended this session.</div>
        )
      ) : joined ? (
        <div className="flex flex-col gap-3" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
          <VentAudioRoom
            roomId={room.id}
            roomTopic={room.topic}
            isHost={isHost}
            onLeave={leave}
            onRoomEnded={() => { setRoom((r) => ({ ...r, ended: true, status: "ended", listeners: 0 })); setJoined(false); onChanged?.(); }}
            onRemoved={() => { setJoined(false); onChanged?.(); }}
          />
          {isHost && (
            <button onClick={leave} className="lo-tap" style={{ ...monoFont, fontSize: 12, color: C.muted, background: "transparent", border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", alignSelf: "flex-start" }}>
              Step out (session stays open)
            </button>
          )}
        </div>
      ) : (
        <button onClick={join} disabled={busy || !user || (!canJoin && !isHost)} className="lo-tap" style={{ ...monoFont, fontSize: 12, color: canJoin || isHost ? "#FFFFFF" : C.muted, background: canJoin || isHost ? C.mustard : C.surface2, border: canJoin || isHost ? "none" : `1px solid ${C.line}`, borderRadius: 8, padding: "8px 14px", fontWeight: 700, alignSelf: "flex-start", cursor: (canJoin || isHost) && user ? "pointer" : "not-allowed", opacity: user ? 1 : 0.5 }}>
          {busy ? "joining…" : !user ? "Log in to join" : isHost ? "Enter your session" : canJoin ? "Join room" : "OUT+ or OUT PRO to join"}
        </button>
      )}
    </div>
  );
}
