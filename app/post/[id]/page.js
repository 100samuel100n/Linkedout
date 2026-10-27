"use client";
import ErrorNote from "@/components/ErrorNote";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import PostCard from "@/components/PostCard";

export default function PostDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [post, setPost] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setPost(null);
    setError(null);
    api.getPost(id).then(setPost).catch((e) => setError(e.status === 404 ? "This post isn't here anymore." : e.message));
  }, [id]);

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => router.back()}
        className="lo-tap flex items-center gap-1.5"
        style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: "none", cursor: "pointer", alignSelf: "flex-start", padding: 4, borderRadius: 8 }}
      >
        <ArrowLeft size={15} /> Back
      </button>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!post && !error && (
        <div className="flex flex-col gap-2">
          <div className="lo-skeleton" style={{ height: 140 }} />
        </div>
      )}
      {post && <PostCard post={post} detailMode />}
    </div>
  );
}
