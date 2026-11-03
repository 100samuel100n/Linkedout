"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";

// Same ad rules as Pulse (pinned position > weighted direct rotation > AdSense),
// shared so the Stories feed follows exactly the same admin controls.
export default function useFeedAds() {
  const { user } = useAuth();
  const [ads, setAds] = useState([]);
  const [cfg, setCfg] = useState({ adsEnabled: true, adEvery: 4, announcements: [] });
  useEffect(() => { api.getAds().then(setAds).catch(() => setAds([])); api.getFeedConfig().then(setCfg).catch(() => {}); }, []);
  const audienceOk = cfg.adAudience === "all" || !user?.isPremium;
  const masterOn = cfg.adsEnabled && audienceOk;
  const direct = masterOn && cfg.mix !== "network only" && ads.length > 0;
  const pinned = ads.filter((a) => Number.isInteger(a.position));
  const rotation = ads.filter((a) => !Number.isInteger(a.position)).flatMap((a) => Array(Math.min(10, Math.max(1, a.weight || 1))).fill(a));
  const rot = rotation.length ? rotation : ads;
  const sense = masterOn && cfg.adsense?.enabled ? cfg.adsense : null;
  function adFor(i) {
    if (direct) {
      const pin = pinned.find((a) => a.position === i + 1);
      if (pin) return { kind: "direct", ad: pin };
      if (cfg.adEvery && (i + 1) % cfg.adEvery === 0 && rot.length) return { kind: "direct", ad: rot[Math.floor(i / cfg.adEvery) % rot.length] };
    }
    if (sense && (i + 1) % sense.every === 0) return { kind: "adsense" };
    return null;
  }
  const notes = (cfg.announcements || []).filter((a) => a.audience === "all" || (a.audience === "premium" ? user?.isPremium : !user?.isPremium));
  return { cfg, sense, adFor, notes };
}
