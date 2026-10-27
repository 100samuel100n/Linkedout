"use client";
import ErrorNote from "@/components/ErrorNote";
import { useImpression } from "@/lib/impressions";
import VerifiedTick from "@/components/VerifiedTick";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeOff, MessageCircle, Repeat2, Share2, Trophy, Pin, Calendar, MapPin, FileText, Bookmark, Flag } from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import { Stamp, MoodPill } from "@/components/primitives";
import ReactionControl, { LikeButton } from "@/components/Reactions";
import { fmt } from "@/lib/format";
import { useDialog } from "@/components/Dialog";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import ReplyComposer from "./ReplyComposer";

function PostMedia({ post }) {
  if (!post.mediaUrl) return null;
  if (post.mediaType === "image") {
    return <img src={post.mediaUrl} alt="" style={{ width: "100%", borderRadius: 14, border: `1px solid ${C.line}`, maxHeight: 460, objectFit: "cover" }} />;
  }
  if (post.mediaType === "video") {
    return <video src={post.mediaUrl} controls style={{ width: "100%", borderRadius: 14, border: `1px solid ${C.line}`, maxHeight: 460 }} />;
  }
  if (post.mediaType === "audio") {
    return <audio src={post.mediaUrl} controls style={{ width: "100%" }} />;
  }
  if (post.mediaType === "document") {
    return (
      <a href={post.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2" style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", textDecoration: "none", color: C.text }}>
        <FileText size={16} color={C.muted} /> <span style={{ fontSize: 12.5 }}>View attached document</span>
      </a>
    );
  }
  return null;
}

function applyVote(post, index) {
  // Local, instant version of the server's vote logic: single-select moves or
  // clears your vote, multi-select toggles that option.
  const options = post.pollOptions || [];
  const mineBefore = post.myPollVotes || [];
  let mineAfter;
  if (post.multiSelect) mineAfter = mineBefore.includes(index) ? mineBefore.filter((i) => i !== index) : [...mineBefore, index];
  else mineAfter = mineBefore.includes(index) ? [] : [index];
  const votes = options.map((o) => Math.max(0, o.votes + (mineAfter.includes(o.index) ? 1 : 0) - (mineBefore.includes(o.index) ? 1 : 0)));
  const total = votes.reduce((a, b) => a + b, 0);
  return {
    ...post,
    myPollVotes: mineAfter,
    pollOptions: options.map((o, i) => ({ ...o, votes: votes[i], pct: total ? Math.round((votes[i] / total) * 100) : 0 })),
  };
}

function PollBlock({ post, onVoted }) {
  const [error, setError] = useState(null);
  const options = post.pollOptions || [];
  const myVotes = post.myPollVotes || [];
  const chain = useRef(Promise.resolve());
  const pending = useRef(0);
  const live = useRef(post);
  live.current = post;

  // Instant: the bars move on the same frame as the tap. Requests are chained
  // so they reach the server in tap order; the server's answer settles the UI
  // only once the last one lands.
  function vote(index) {
    const before = live.current;
    onVoted(applyVote(before, index));
    pending.current++;
    chain.current = chain.current.then(async () => {
      try {
        const updated = await api.votePoll(before.id, index);
        if (pending.current === 1) onVoted(updated);
      } catch (e) {
        onVoted(before);
        setError(e.status === 401 ? "Log in to vote." : e.message || "Couldn't register your vote.");
        setTimeout(() => setError(null), 4000);
      } finally { pending.current--; }
    });
  }

  return (
    <div className="flex flex-col gap-2 mt-1">
      {post.multiSelect && (
        <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>Select all that apply</div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {options.map((o) => {
        const mine = myVotes.includes(o.index);
        return (
          <button
            key={o.index}
            onClick={(e) => { e.stopPropagation(); vote(o.index); }}
            className="relative rounded overflow-hidden w-full text-left lo-tap"
            style={{ border: `1px solid ${mine ? C.mustard : C.line}`, cursor: "pointer" }}
          >
            <div style={{ width: `${o.pct}%`, background: mine ? alpha(C.mustard, 20) : alpha(C.corpblue, 20), position: "absolute", inset: 0, transition: "width 0.5s cubic-bezier(0.16, 1, 0.3, 1)" }} />
            <div className="relative flex items-center justify-between px-3 py-2" style={{ fontSize: 12.5, color: C.text }}>
              <span>{mine ? (post.multiSelect ? "☑ " : "✓ ") : ""}{o.label}</span>
              <span style={{ ...monoFont, color: C.muted }}>{o.pct}% ({o.votes})</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CommentSection({ postId, initialComments = null }) {
  const [comments, setComments] = useState(initialComments);

  useEffect(() => {
    if (initialComments) return;
    api.getComments(postId).then(setComments).catch(() => setComments([]));
  }, [postId, initialComments]);

  return (
    <div className="flex flex-col gap-3" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12, marginTop: 2 }}>
      {comments === null && (
        <div className="flex flex-col gap-2">
          <div className="lo-skeleton" style={{ height: 44 }} />
          <div className="lo-skeleton" style={{ height: 44 }} />
        </div>
      )}
      {comments?.map((c) => (
        <div key={c.id} className="lo-enter flex items-start gap-2.5">
          {c.authorHandle ? (
            <Link href={`/u/${c.authorHandle}`}>
              {c.authorAvatarUrl
                ? <img src={c.authorAvatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                : <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.surface2, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 12 }}>{c.author[0]}</div>}
            </Link>
          ) : (
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.surface2, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, flexShrink: 0 }}>
              {c.author.startsWith("Anonymous") ? <EyeOff size={13} /> : c.author[0]}
            </div>
          )}
          <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>
              {c.authorHandle
                ? <Link href={`/u/${c.authorHandle}`} style={{ fontWeight: 600, color: C.text, textDecoration: "none" }} className="hover:underline">{c.author}</Link>
                : <span style={{ fontWeight: 600, color: C.text }}>{c.author}</span>}<VerifiedTick tier={c.authorTier} size={13} />{" "}
              <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{c.time}</span>
              {c.text && <div style={{ color: C.text, marginTop: 1 }}>{c.text}</div>}
            </div>
            {c.gifUrl && <img src={c.gifUrl} alt="" style={{ maxWidth: 160, borderRadius: 8, display: "block" }} />}
            {c.mediaUrl && c.mediaType === "image" && <img src={c.mediaUrl} alt="" style={{ maxWidth: 220, borderRadius: 8, display: "block" }} />}
            {c.mediaUrl && c.mediaType === "video" && <video src={c.mediaUrl} controls style={{ maxWidth: 220, borderRadius: 8, display: "block" }} />}
            {c.mediaUrl && c.mediaType === "audio" && <audio src={c.mediaUrl} controls style={{ maxWidth: 220 }} />}
            {c.mediaUrl && c.mediaType === "document" && (
              <a href={c.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5" style={{ ...monoFont, fontSize: 12, color: C.corpblue, textDecoration: "none" }}>
                <FileText size={12} /> attachment
              </a>
            )}
            <div className="flex items-center flex-wrap" style={{ gap: 4 }}>
              <LikeButton kind="comment" postId={c.id} liked={c.myLike} count={c.likeCount} compact />
              <ReactionControl kind="comment" id={c.id} reactions={c.reactions} myReaction={c.myReaction} compact />
            </div>
          </div>
        </div>
      ))}
      <ReplyComposer postId={postId} onPosted={(c) => setComments((list) => [...(list || []), c])} />
    </div>
  );
}

function Avatar({ post, size = 34 }) {
  if (post.authorAvatarUrl) {
    return <img src={post.authorAvatarUrl} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: C.surface2,
      display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, flexShrink: 0,
    }}>
      {post.author.startsWith("Anonymous") ? <EyeOff size={size * 0.44} /> : post.author[0]}
    </div>
  );
}

function AuthorRow({ post }) {
  const name = <div style={{ color: C.text, fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", display: "inline-flex", alignItems: "center", gap: 2 }}>{post.author}<VerifiedTick tier={post.authorTier} /></div>;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        {post.authorHandle ? (
          <Link href={`/u/${post.authorHandle}`} className="lo-tap" style={{ display: "flex" }} onClick={(e) => e.stopPropagation()}>
            <Avatar post={post} />
          </Link>
        ) : (
          <Avatar post={post} />
        )}
        <div>
          {post.authorHandle ? (
            <Link href={`/u/${post.authorHandle}`} style={{ textDecoration: "none" }} onClick={(e) => e.stopPropagation()} className="hover:underline">{name}</Link>
          ) : name}
          <div className="flex items-center gap-2 mt-0.5">
            <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 500 }} title={new Date(post.createdAt).toLocaleString()}>{post.time}</span>
            <MoodPill text={post.mood} />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {post.pinned && <Pin size={13} color={C.mustard} />}
        {post.type === "parody" && <Stamp text="Parody" tone="mustard" rotate={6} />}
      </div>
    </div>
  );
}

function PostCardInner({ post: initialPost, detailMode = false }) {
  const router = useRouter();
  const { user } = useAuth();
  const [post, setPost] = useState(initialPost);
  const [shareNotice, setShareNotice] = useState(null);
  const [cringeVoting, setCringeVoting] = useState(false);

  const [bookmarkPulse, setBookmarkPulse] = useState(false);

  const dialog = useDialog();
  const handleReport = () => dialog.report({ targetType: "post", targetId: post.id });

  // Optimistic: the icon flips on the tap itself; the request settles it after.
  const bmSeq = useRef(0);
  function handleBookmark() {
    if (!user) { dialog.toast("Log in to bookmark."); return; }
    const next = !post.bookmarked, my = ++bmSeq.current;
    setPost((p) => ({ ...p, bookmarked: next }));
    if (next) { setBookmarkPulse(true); setTimeout(() => setBookmarkPulse(false), 220); }
    api.toggleBookmark(post.id)
      .then((r) => { if (my === bmSeq.current) setPost((p) => ({ ...p, bookmarked: r.bookmarked })); })
      .catch(() => { if (my === bmSeq.current) setPost((p) => ({ ...p, bookmarked: !next })); dialog.toast("Couldn't bookmark that."); });
  }

  // Reposts act on the ORIGINAL post: on a repost card that's the embedded
  // one. One tap reposts, a second tap removes it — the server guarantees
  // at most one repost per account per post.
  const repostTarget = post.repostOfPost || post;
  const rpSeq = useRef(0);
  function handleRepost(e) {
    e?.stopPropagation();
    if (!user) { dialog.toast("Log in to repost."); return; }
    const next = !repostTarget.myRepost, my = ++rpSeq.current, base = repostTarget.repostCount || 0;
    const apply = (mine, count) => setPost((p) => p.repostOfPost
      ? { ...p, repostOfPost: { ...p.repostOfPost, myRepost: mine, repostCount: count } }
      : { ...p, myRepost: mine, repostCount: count });
    apply(next, Math.max(0, base + (next ? 1 : -1)));
    api.repost(repostTarget.id, { on: next })
      .then((res) => { if (my === rpSeq.current) apply(res.reposted, res.repostCount); })
      .catch((err) => { if (my === rpSeq.current) apply(!next, base); dialog.toast(err.status === 429 ? err.message : "Couldn't repost that."); });
  }

  async function handleShare() {
    const url = `${window.location.origin}/#post-${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ text: post.text?.slice(0, 100), url });
      } else {
        await navigator.clipboard.writeText(url);
        setShareNotice("Link copied");
        setTimeout(() => setShareNotice(null), 2000);
      }
    } catch {
      // user cancelled the share sheet — not an error
    }
  }

  async function handleCringeVote() {
    if (cringeVoting) return;
    setCringeVoting(true);
    try {
      const updated = await api.voteCringe(post.id);
      setPost(updated);
    } catch {
      // quiet — cringe voting is a fun extra, not core functionality
    } finally {
      setCringeVoting(false);
    }
  }

  // A repost renders as "You reposted" + the embedded original content —
  // repostOfPost is attached server-side (see attachReactionAndPoll in
  // lib/content/service.js).
  const original = post.repostOfPost;

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, boxShadow: "var(--lo-shadow-1, 0 1px 2px rgba(2,6,20,.18))" }} className="p-4 md:p-5 flex flex-col gap-3.5">
      <div
        onClick={detailMode ? undefined : () => router.push(`/post/${post.id}`)}
        style={detailMode ? undefined : { cursor: "pointer" }}
        className="flex flex-col gap-3"
      >
      {original ? (
        <>
          <div className="flex items-center gap-2" style={{ color: C.muted, fontSize: 12 }}>
            <Repeat2 size={13} /> <span style={{ fontWeight: 600, color: C.text }}>{post.author}</span> reposted
          </div>
          {post.quoteText && <p style={{ color: C.text, fontSize: 15.5, lineHeight: 1.65 }}>{post.quoteText}</p>}
          <div style={{ border: `1px solid ${C.line}`, background: C.surface2, borderRadius: 14, padding: 14 }} className="flex flex-col gap-2">
            <AuthorRow post={original} />
            <p style={{ color: C.text, fontSize: 14.5, lineHeight: 1.6 }}>{original.text}</p>
            <PostMedia post={original} />
          </div>
        </>
      ) : (
        <>
          <AuthorRow post={post} />

          {post.title && <div style={{ ...displayFont, fontWeight: 800, fontSize: 18, lineHeight: 1.3, letterSpacing: "-0.015em", color: C.text }}>{post.title}</div>}
          <p style={{ color: C.text, fontSize: 15.5, lineHeight: 1.65, letterSpacing: "-0.003em", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{post.text}</p>

          {post.type === "event" && (post.eventAt || post.eventLocation) && (
            <div className="flex flex-col gap-1" style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: 10 }}>
              {post.eventAt && (
                <div className="flex items-center gap-2" style={{ fontSize: 12, color: C.text }}>
                  <Calendar size={13} color={C.muted} /> {new Date(post.eventAt).toLocaleString()}
                </div>
              )}
              {post.eventLocation && (
                <div className="flex items-center gap-2" style={{ fontSize: 12, color: C.text }}>
                  <MapPin size={13} color={C.muted} /> {post.eventLocation}
                </div>
              )}
            </div>
          )}

          <PostMedia post={post} />

          {post.type === "poll" && post.pollOptions && (
            <PollBlock post={post} onVoted={(u) => setPost((p) => ({ ...p, ...u }))} />
          )}
        </>
      )}
      </div>

      {post.tags?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {post.tags.map((t, i) => (
            <span key={i} style={{ fontSize: 12.5, fontWeight: 600, color: C.corpblue, background: alpha(C.corpblue, 10), borderRadius: 999, padding: "3px 10px" }}>#{t}</span>
          ))}
        </div>
      )}

      {post.cringeNominated && (
        <button
          onClick={handleCringeVote}
          disabled={cringeVoting}
          className="flex items-center gap-1.5"
          style={{ ...monoFont, fontSize: 12, color: C.mustard, background: alpha(C.mustard, 8), border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 20, padding: "4px 10px", alignSelf: "flex-start", cursor: "pointer" }}
        ><Trophy size={12} /> Cringe Awards: {fmt(post.cringeVotes)} vote{post.cringeVotes === 1 ? "" : "s"}</button>
      )}

      <div className="flex flex-col" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, gap: 8 }}>
        <ReactionControl kind="post" id={post.id} reactions={post.reactions} myReaction={post.myReaction} />
        <div className="flex items-center justify-between" style={{ color: C.muted, maxWidth: 460, marginLeft: -8 }}>
          <LikeButton postId={post.id} liked={post.myLike} count={post.likeCount} />
          <button onClick={detailMode ? undefined : () => router.push(`/post/${post.id}`)} aria-label="Replies" title="Replies" className="lo-act" style={{ cursor: detailMode ? "default" : "pointer" }}>
            <MessageCircle size={16} />{post.commentCount > 0 && <span style={{ fontSize: 13, fontWeight: 600 }}>{fmt(post.commentCount)}</span>}
          </button>
          <button onClick={handleRepost} aria-pressed={!!repostTarget.myRepost} aria-label={repostTarget.myRepost ? "Undo repost" : "Repost"} title={repostTarget.myRepost ? "Undo repost" : "Repost"} className="lo-act" style={{ color: repostTarget.myRepost ? C.green : C.muted }}>
            <Repeat2 size={16} strokeWidth={repostTarget.myRepost ? 2.6 : 2} />{repostTarget.repostCount > 0 && <span style={{ fontSize: 13, fontWeight: 600 }}>{fmt(repostTarget.repostCount)}</span>}
          </button>
          <button onClick={handleBookmark} aria-pressed={!!post.bookmarked} aria-label="Bookmark" title="Bookmark" className="lo-act" style={{ color: post.bookmarked ? C.mustard : C.muted, transform: bookmarkPulse ? "scale(1.25)" : undefined }}>
            <Bookmark size={16} fill={post.bookmarked ? C.mustard : "none"} />
          </button>
          <button onClick={handleShare} aria-label="Share" title="Share" className="lo-act"><Share2 size={16} /></button>
          {user && <button onClick={handleReport} aria-label="Report" title="Report" className="lo-act"><Flag size={16} /></button>}
        </div>
      </div>
      {shareNotice && <div className="lo-toast" style={{ ...monoFont, fontSize: 12, color: C.green, textAlign: "right" }}>{shareNotice}</div>}

      {detailMode && <CommentSection postId={post.id} />}
    </div>
  );
}


// A plain repost (no quote) shows a small "reposted" line and then the ORIGINAL as a full card, so it looks
// and behaves exactly like it does on the feed, Likes and Bookmarks (reactions, likes, replies, bookmark,
// undo-repost all act on the original). Quote reposts keep their own card with the original embedded.
export default function PostCard(props) {
  const { post, detailMode } = props;
  const viewRef = useImpression("post", detailMode ? null : post?.id); // detail pages are counted by the server
  if (post?.repostOfPost && !post.quoteText && !detailMode) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2" style={{ color: C.muted, fontSize: 12, paddingLeft: 6 }}>
          <Repeat2 size={13} /> <span style={{ fontWeight: 600, color: C.text }}>{post.author}</span> reposted
        </div>
        <PostCardInner key={post.repostOfPost.id} {...props} post={post.repostOfPost} />
      </div>
    );
  }
  if (post?.repostUnavailable) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 16, color: C.muted, fontSize: 13 }}>
        <Repeat2 size={13} style={{ display: "inline", marginRight: 6 }} /> The post you reposted is no longer available.
      </div>
    );
  }
  return <div ref={viewRef}><PostCardInner {...props} /></div>;
}
