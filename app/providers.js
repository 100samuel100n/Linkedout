"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const PostsContext = createContext(null);

const PAGE_SIZE = 40;
const NEW_POSTS_POLL_MS = 45000;

export function PostsProvider({ children }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const newestRef = useRef(null);

  useEffect(() => {
    newestRef.current = posts[0]?.createdAt || null;
  }, [posts]);

  useEffect(() => {
    api.getPosts()
      .then((p) => { setPosts(p); setHasMore(p.length >= PAGE_SIZE); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // X-style refresh: pull the newest page again and reset the "new posts"
  // banner. Also what the banner's click calls.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const p = await api.getPosts();
      setPosts(p);
      setHasMore(p.length >= PAGE_SIZE);
      setNewCount(0);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const last = posts[posts.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      const older = await api.getPostsPage({ before: last.createdAt });
      setPosts((cur) => {
        const seen = new Set(cur.map((x) => x.id));
        return [...cur, ...older.filter((x) => !seen.has(x.id))];
      });
      setHasMore(older.length >= PAGE_SIZE);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [posts, loadingMore]);

  // Poll for newer posts while the tab is visible, and check right away
  // when the user comes back to it. Only a COUNT is fetched — the feed
  // itself is untouched until the user chooses to refresh, so posts never
  // jump around under someone who's mid-read.
  useEffect(() => {
    async function check() {
      if (document.hidden || !newestRef.current) return;
      try {
        const { count } = await api.getNewPostCount(newestRef.current);
        setNewCount(count);
      } catch { /* a missed poll is harmless — try again next tick */ }
    }
    const id = setInterval(check, NEW_POSTS_POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", check); };
  }, []);

  async function addPost(input) {
    const created = await api.createPost(input);
    setPosts((p) => [created, ...p]);
    return created;
  }

  return (
    <PostsContext.Provider value={{ posts, loading, error, addPost, hasMore, loadMore, loadingMore, refresh, refreshing, newCount }}>
      {children}
    </PostsContext.Provider>
  );
}

export function usePosts() {
  const ctx = useContext(PostsContext);
  if (!ctx) throw new Error("usePosts must be used within PostsProvider");
  return ctx;
}
