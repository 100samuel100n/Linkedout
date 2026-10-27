"use client";
import Loading from "@/components/ui/Loading";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Mail } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import ConversationList from "@/components/messages/ConversationList";
import { useAuth } from "@/app/auth-provider";
import { C, monoFont, displayFont } from "@/lib/theme";

// Two panes on desktop (list + chat), one pane on phones: the list when no
// chat is open, the chat when one is.
export default function MessagesLayout({ children }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const inChat = pathname.split("/").length > 2 && pathname.split("/")[2];

  if (loading) return <Loading />;
  if (!user) {
    return (
      <EmptyState icon={Mail} title="Log in to use messages" actionLabel="Log in" href="/login">Message requests, private chats and your inbox live here.</EmptyState>
    );
  }
  return (
    <div className="flex gap-4" style={{ height: "calc(100dvh - 150px)", minHeight: 420, margin: "-4px 0" }}>
      <aside className={`${inChat ? "hidden md:flex" : "flex"} flex-col`} style={{ width: "100%", maxWidth: 320, flexShrink: 0, minHeight: 0 }}>
        <ConversationList />
      </aside>
      <section className={`${inChat ? "flex" : "hidden md:flex"} flex-col flex-1`} style={{ minWidth: 0, minHeight: 0 }}>
        {children}
      </section>
    </div>
  );
}
