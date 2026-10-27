"use client";
import { createContext, useContext, useState } from "react";
import ComposerModal from "@/components/ComposerModal";
import { usePosts } from "./providers";

const ComposerContext = createContext(null);

// Lets any page/component (the desktop sidebar's "Post" button, the
// Feed page's inline composer trigger, etc.) open the same composer
// without each needing its own modal instance or local open/close state.
export function ComposerProvider({ children }) {
  const [open, setOpen] = useState(false);
  const { addPost } = usePosts();

  return (
    <ComposerContext.Provider value={{ open: () => setOpen(true), close: () => setOpen(false) }}>
      <ComposerModal open={open} onClose={() => setOpen(false)} onSubmit={addPost} />
      {children}
    </ComposerContext.Provider>
  );
}

export function useComposer() {
  const ctx = useContext(ComposerContext);
  if (!ctx) throw new Error("useComposer must be used within ComposerProvider");
  return ctx;
}
