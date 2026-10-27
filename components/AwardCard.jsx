"use client";
import { Trophy } from "lucide-react";
import { C, displayFont } from "@/lib/theme";
import PostCard from "@/components/PostCard";

// Cringe Awards entries are real posts (cringe_nominated = 1, ranked by
// cringe_votes) — not a separate content type — so this just wraps
// PostCard with a rank badge rather than duplicating comment/reaction/
// vote logic in a second component.
export default function AwardCard({ award }) {
  const rankColor = award.rank === 1 ? C.mustard : award.rank === 2 ? C.muted : "#A9744C";
  return (
    <div className="flex gap-3 items-start">
      <div className="flex flex-col items-center" style={{ width: 34, flexShrink: 0, paddingTop: 14 }}>
        <div style={{ ...displayFont, fontSize: 20, color: rankColor }}>#{award.rank}</div>
        <Trophy size={13} color={rankColor} />
      </div>
      <div style={{ flex: 1 }}>
        <PostCard post={award} />
      </div>
    </div>
  );
}
