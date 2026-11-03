"use client";
import ErrorNote from "@/components/ErrorNote";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Mic, MicOff, PhoneOff, RadioTower, Hand, Crown, UserCheck, Volume2, VolumeX,
  Lock, Unlock, X, Power, WifiOff,
} from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sounds";

// Live audio for a vent room, over LiveKit.
//
// Clean audio (what the echo/noise complaint came down to):
//  1. ONE connection per person. The old code opened a second connection
//     when someone was promoted to speaker and never closed the first, so
//     listeners heard every word twice — that was the echo. Promotion now
//     just changes the person's permission on the media server and this
//     component reacts to it in place; there is never a reconnect.
//  2. The mic is captured with the browser's echo cancellation, noise
//     suppression and auto-gain switched on explicitly, and published as
//     speech-optimised Opus (with DTX, so silence sends nothing).
//  3. Your own voice is never played back to you: local tracks are not
//     attached, and each remote track gets exactly one <audio> element.
//
// Host control is enforced on the media server (see lib/livekit.js), so a
// muted or removed person is cut off by the server, not by their own app
// choosing to comply.
const AUDIO_CAPTURE = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
};

export default function VentAudioRoom({ roomId, roomTopic, isHost = false, onLeave, onRoomEnded, onRemoved }) {
  const [status, setStatus] = useState("connecting"); // connecting | connected | reconnecting | fallback | ended | removed
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [speakerIds, setSpeakerIds] = useState([]);
  const [myRole, setMyRole] = useState(isHost ? "host" : "listener");
  const [handRaised, setHandRaised] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [locked, setLocked] = useState(false);
  const [busyHandle, setBusyHandle] = useState(null);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const [micError, setMicError] = useState(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [feed, setFeed] = useState(null); // transient "X joined" line
  const roomRef = useRef(null);
  const audioContainerRef = useRef(null);
  const prevKeysRef = useRef(null);
  const endedRef = useRef(false);
  const roleRef = useRef(myRole);
  roleRef.current = myRole;

  const flash = useCallback((text) => {
    setFeed(text);
    setTimeout(() => setFeed((f) => (f === text ? null : f)), 3200);
  }, []);

  // Poll = presence heartbeat + source of truth for roster/role/status.
  const refresh = useCallback(async () => {
    if (endedRef.current) return;
    try {
      const r = await api.getRoomParticipants(roomId);
      if (r.status === "ended") {
        endedRef.current = true;
        playSound("ended");
        roomRef.current?.disconnect();
        setStatus("ended");
        onRoomEnded?.();
        return;
      }
      if (r.removed) {
        endedRef.current = true;
        playSound("ended");
        roomRef.current?.disconnect();
        setStatus("removed");
        onRemoved?.();
        return;
      }
      setLocked(!!r.locked);
      if (r.myRole) setMyRole(r.myRole);

      // Join / leave cues, so it's obvious when someone arrives or goes.
      const keys = new Set(r.participants.map((p) => p.handle));
      if (prevKeysRef.current) {
        const joined = r.participants.filter((p) => !prevKeysRef.current.has(p.handle));
        const left = [...prevKeysRef.current].filter((k) => !keys.has(k));
        if (joined.length) { playSound("join"); flash(`${joined[0].displayLabel}${joined.length > 1 ? ` +${joined.length - 1}` : ""} joined`); }
        else if (left.length) { playSound("leave"); }
      }
      prevKeysRef.current = keys;
      setParticipants(r.participants);
    } catch { /* transient — next tick retries */ }
  }, [roomId, flash, onRoomEnded, onRemoved]);

  useEffect(() => {
    let cancelled = false;
    let room = null;

    (async () => {
      try {
        const tokenRes = await api.getRoomToken(roomId);
        if (cancelled) return;
        if (!tokenRes?.configured) { setStatus("fallback"); refresh(); return; }
        setMyRole(tokenRes.role || "listener");

        const { Room, RoomEvent, AudioPresets, Track } = await import("livekit-client");
        room = new Room({
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: AUDIO_CAPTURE,
          publishDefaults: { dtx: true, red: true, audioPreset: AudioPresets.speech },
          disconnectOnPageLeave: true,
        });
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
          if (track.kind !== Track.Kind.Audio) return;
          const id = `${participant.identity}:${track.sid}`;
          audioContainerRef.current?.querySelector(`[data-track="${id}"]`)?.remove();
          const el = track.attach();
          el.dataset.track = id;
          el.autoplay = true;
          el.muted = false;
          audioContainerRef.current?.appendChild(el);
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => setSpeakerIds(speakers.map((s) => s.identity)));
        room.on(RoomEvent.ParticipantConnected, refresh);
        room.on(RoomEvent.ParticipantDisconnected, refresh);
        room.on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudioTap(!room.canPlaybackAudio));
        room.on(RoomEvent.Reconnecting, () => setStatus("reconnecting"));
        room.on(RoomEvent.Reconnected, () => setStatus("connected"));
        room.on(RoomEvent.MediaDevicesError, () => setMicError("Couldn't access your microphone. Check browser permissions."));
        room.on(RoomEvent.Disconnected, () => { if (!endedRef.current) { setStatus((s) => (s === "connected" || s === "reconnecting" ? "ended" : s)); } });

        // The server changes our permission in place when the host gives or
        // takes the mic — react to that instead of reconnecting.
        room.on(RoomEvent.ParticipantPermissionsChanged, async (_prev, participant) => {
          if (participant !== room.localParticipant) return;
          const can = participant.permissions?.canPublish;
          if (can) {
            setMyRole((r) => (r === "host" ? r : "speaker"));
            try { await participant.setMicrophoneEnabled(true); setMuted(false); setMicError(null); }
            catch { setMicError("Couldn't access your microphone. Check browser permissions."); }
            playSound("join");
          } else {
            try { await participant.setMicrophoneEnabled(false); } catch { /* ignore */ }
            setMuted(true);
            setMyRole((r) => (r === "host" ? r : "listener"));
          }
          refresh();
        });

        await room.connect(tokenRes.url, tokenRes.jwt);
        if (cancelled) { room.disconnect(); return; }
        if (tokenRes.role === "host" || tokenRes.role === "speaker") {
          try { await room.localParticipant.setMicrophoneEnabled(true); }
          catch { setMicError("Couldn't access your microphone. Check browser permissions."); setMuted(true); }
        }
        setNeedsAudioTap(!room.canPlaybackAudio);
        setStatus("connected");
        refresh();
      } catch (e) {
        if (cancelled) return;
        if (e?.status === 410 || e?.code === "ROOM_ENDED") { endedRef.current = true; setStatus("ended"); onRoomEnded?.(); }
        else setStatus("fallback");
        refresh();
      }
    })();

    const interval = setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      room?.disconnect();
      roomRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  function toggleMute() {
    const room = roomRef.current;
    if (!room || (myRole !== "host" && myRole !== "speaker")) return;
    const next = !muted;
    room.localParticipant.setMicrophoneEnabled(!next).then(() => setMicError(null)).catch(() => setMicError("Couldn't access your microphone."));
    setMuted(next);
  }

  // Deafen = stop hearing the room (useful if you're on speakers and it's
  // feeding back into your own mic).
  function toggleDeafen() {
    const next = !deafened;
    setDeafened(next);
    audioContainerRef.current?.querySelectorAll("audio").forEach((el) => { el.muted = next; });
  }

  function enableAudio() {
    roomRef.current?.startAudio().then(() => setNeedsAudioTap(false)).catch(() => {});
  }

  async function toggleHand() {
    const next = !handRaised;
    setHandRaised(next);
    try { await api.raiseHand(roomId, next); } catch { setHandRaised(!next); }
  }

  async function hostAction(handle, fn) {
    setBusyHandle(handle);
    try {
      const res = await fn();
      if (res?.participants) setParticipants(res.participants);
    } catch (e) { flash(e.message || "That didn't work."); }
    finally { setBusyHandle(null); }
  }
  const promote = (h) => hostAction(h, () => api.promoteToSpeaker(roomId, h));
  const demote = (h) => hostAction(h, () => api.demoteToListener(roomId, h));
  const removePerson = (h) => hostAction(h, () => api.removeFromRoom(roomId, h, true));
  const muteAll = () => hostAction("all", () => api.muteAllInRoom(roomId));
  async function toggleLock() {
    try { const r = await api.updateRoom(roomId, { locked: !locked }); setLocked(!!r.locked); flash(r.locked ? "Session locked — nobody new can join" : "Session unlocked"); }
    catch (e) { flash(e.message); }
  }
  async function endSession() {
    setConfirmEnd(false);
    try {
      endedRef.current = true;
      await api.endRoom(roomId);
      roomRef.current?.disconnect();
      playSound("ended");
      setStatus("ended");
      onRoomEnded?.();
    } catch (e) { endedRef.current = false; flash(e.message || "Couldn't end the session."); }
  }

  const btn = (extra = {}) => ({ ...monoFont, fontSize: 12, color: C.text, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", ...extra });

  if (status === "fallback") {
    return (
      <div className="lo-enter flex items-center gap-2" style={{ ...monoFont, fontSize: 12, color: C.muted, background: alpha(C.corpblue, 8), border: `1px solid ${alpha(C.corpblue, 25)}`, borderRadius: 8, padding: "8px 12px" }}>
        <WifiOff size={13} /> Live audio couldn't connect right now. You're still in the room — try leaving and rejoining.
      </div>
    );
  }
  if (status === "ended") {
    return <div className="lo-enter" style={{ ...monoFont, fontSize: 12, color: C.muted, padding: "8px 0" }}>{isHost ? "You ended this session." : "The host ended this session."}</div>;
  }
  if (status === "removed") {
    return <div className="lo-enter" style={{ ...monoFont, fontSize: 12, color: C.flag, padding: "8px 0" }}>The host removed you from this session.</div>;
  }

  const canSpeak = myRole === "host" || myRole === "speaker";
  const host = myRole === "host";
  const raisedHands = participants.filter((p) => p.handRaised && p.role === "listener");
  const live = status === "connected";

  return (
    <div className="lo-enter flex flex-col gap-3" style={{ background: alpha(C.mustard, 6), border: `1px solid ${alpha(C.mustard, 30)}`, borderRadius: 12, padding: 14 }}>
      <div ref={audioContainerRef} style={{ display: "none" }} />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2" style={{ ...monoFont, fontSize: 12, color: live ? C.mustard : C.muted }}>
          <RadioTower size={13} className={status === "connecting" || status === "reconnecting" ? "lo-spin" : ""} />
          {status === "connecting" ? "Connecting to live audio…" : status === "reconnecting" ? "Reconnecting…" : `Live · you're ${host ? "hosting" : myRole === "speaker" ? "speaking" : "listening"}`}
          {locked && <span className="flex items-center gap-1" style={{ color: C.muted }}><Lock size={11} /> locked</span>}
        </div>
        <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{participants.length} in room</span>
      </div>

      {feed && <div className="lo-toast" style={{ ...monoFont, fontSize: 12, color: C.text, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "5px 12px", alignSelf: "flex-start" }}>{feed}</div>}
      {micError && <ErrorNote>{micError}</ErrorNote>}
      {needsAudioTap && (
        <button onClick={enableAudio} style={btn({ color: "#fff", background: C.mustard, border: "none", fontWeight: 700 })} className="flex items-center gap-1.5 lo-tap">
          <Volume2 size={13} /> Tap to enable sound
        </button>
      )}

      {live && (
        <>
          {host && raisedHands.length > 0 && (
            <div className="flex flex-col gap-1.5" style={{ background: alpha(C.corpblue, 8), borderRadius: 8, padding: 8 }}>
              <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase" }}>Raised hands</div>
              {raisedHands.map((p) => (
                <div key={p.handle} className="flex items-center justify-between">
                  <span style={{ fontSize: 12, color: C.text }}>{p.displayLabel}</span>
                  <button onClick={() => promote(p.handle)} disabled={busyHandle === p.handle} className="lo-tap" style={{ ...monoFont, fontSize: 12, color: "#FFFFFF", background: C.mustard, border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>give mic</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {participants.map((p) => {
              const speaking = speakerIds.includes(p.handle);
              return (
                <div key={p.handle} className="flex items-center gap-2.5" style={{ padding: "6px 8px", borderRadius: 10, background: speaking ? alpha(C.mustard, 14) : "transparent", border: `1px solid ${speaking ? alpha(C.mustard, 55) : "transparent"}`, transition: "background .2s, border-color .2s" }}>
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    {p.avatarUrl
                      ? <img src={p.avatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", boxShadow: speaking ? `0 0 0 2px ${C.mustard}` : "none" }} />
                      : <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.surface2, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 12 }}>{p.displayLabel[0]}</div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-1.5" style={{ fontSize: 12.5, color: C.text, fontWeight: 600 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayLabel}</span>
                      {p.role === "host" && <Crown size={11} color={C.mustard} />}
                      {p.role === "speaker" && <UserCheck size={11} color={C.corpblue} />}
                      {p.handRaised && p.role === "listener" && <Hand size={11} color={C.mustard} />}
                    </div>
                    <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{speaking ? "speaking…" : p.role}</div>
                  </div>
                  {host && p.role !== "host" && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => (p.role === "listener" ? promote(p.handle) : demote(p.handle))} disabled={busyHandle === p.handle} className="lo-tap" title={p.role === "listener" ? "Give mic" : "Take mic"} style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: 8, cursor: "pointer", color: C.muted, padding: 5, display: "flex" }}>
                        {p.role === "listener" ? <Mic size={12} /> : <MicOff size={12} />}
                      </button>
                      <button onClick={() => removePerson(p.handle)} disabled={busyHandle === p.handle} className="lo-tap" title="Remove from session" style={{ background: "none", border: `1px solid ${alpha(C.flag, 40)}`, borderRadius: 8, cursor: "pointer", color: C.flag, padding: 5, display: "flex" }}>
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {canSpeak ? (
              <button onClick={toggleMute} className="lo-tap flex items-center gap-1.5" style={btn(muted ? { color: C.flag, borderColor: alpha(C.flag, 50) } : {})}>
                {muted ? <MicOff size={13} /> : <Mic size={13} />} {muted ? "Unmute" : "Mute"}
              </button>
            ) : (
              <button onClick={toggleHand} className="lo-tap flex items-center gap-1.5" style={btn(handRaised ? { color: "#FFFFFF", background: C.mustard, border: `1px solid ${C.mustard}` } : {})}>
                <Hand size={13} /> {handRaised ? "Hand raised" : "Raise hand"}
              </button>
            )}
            <button onClick={toggleDeafen} className="lo-tap flex items-center gap-1.5" style={btn()} title="Stop hearing the room">
              {deafened ? <VolumeX size={13} /> : <Volume2 size={13} />} {deafened ? "Hear" : "Deafen"}
            </button>
            {!host && (
              <button onClick={() => { roomRef.current?.disconnect(); onLeave?.(); }} className="lo-tap flex items-center gap-1.5" style={btn({ color: "#FFFFFF", background: C.flag, border: "none" })}>
                <PhoneOff size={13} /> Leave
              </button>
            )}
          </div>

          {host && (
            <div className="flex flex-col gap-2" style={{ borderTop: `1px solid ${alpha(C.mustard, 25)}`, paddingTop: 10 }}>
              <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Host controls</div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={muteAll} disabled={busyHandle === "all"} className="lo-tap flex items-center gap-1.5" style={btn()}><MicOff size={13} /> Mute all</button>
                <button onClick={toggleLock} className="lo-tap flex items-center gap-1.5" style={btn()}>{locked ? <Unlock size={13} /> : <Lock size={13} />} {locked ? "Unlock" : "Lock"}</button>
                {confirmEnd ? (
                  <>
                    <button onClick={endSession} className="lo-tap flex items-center gap-1.5" style={btn({ color: "#fff", background: C.flag, border: "none", fontWeight: 700 })}><Power size={13} /> End for everyone</button>
                    <button onClick={() => setConfirmEnd(false)} className="lo-tap" style={btn({ color: C.muted })}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmEnd(true)} className="lo-tap flex items-center gap-1.5" style={btn({ color: C.flag, borderColor: alpha(C.flag, 50) })}><Power size={13} /> End session</button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
