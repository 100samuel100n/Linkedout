"use client";
import { MessagesSquare, Lock } from "lucide-react";
import { C } from "@/lib/theme";
import EmptyState from "@/components/ui/EmptyState";

export default function MessagesHome() {
  return (
    <div className="lo-card flex flex-col items-center justify-center" style={{ flex: 1 }}>
      <EmptyState icon={MessagesSquare} title="Your messages">Pick a conversation, or open someone's profile and tap Message. People choose whether to accept, so there is no unwanted inbox.</EmptyState>
      <div className="flex items-center gap-1.5" style={{ fontSize: 13, color: C.muted, paddingBottom: 24 }}><Lock size={13} /> Aliases only. Encrypted at rest. You control who can reach you.</div>
    </div>
  );
}
