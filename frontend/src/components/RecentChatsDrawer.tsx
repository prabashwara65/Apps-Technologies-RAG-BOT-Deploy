import { useEffect, useState } from "react";
import { deleteSavedChat, listSavedChats } from "../api/savedChats";
import type { SavedChatSummary } from "../api/savedChats";
import { ShellIcon } from "./ShellIcon";

export interface OngoingSessionChat {
  id: string;
  title: string;
  message_count: number;
  updated_at: string;
}

interface RecentChatsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectChat: (chatId: string) => void;
  onChatDeleted?: ((id: string) => void) | undefined;
  variant?: "drawer" | "sidebar" | undefined;
  refreshKey?: number | undefined;
  activeChatId?: string | null | undefined;
  disabled?: boolean | undefined;
  ongoingChats?: OngoingSessionChat[] | undefined;
  activeOngoingId?: string | null | undefined;
  onSelectOngoingChat?: ((id: string) => void) | undefined;
  onSaveOngoingChat?: ((id: string) => void) | undefined;
  onDeleteOngoingChat?: ((id: string) => void) | undefined;
  isSavingOngoing?: boolean | undefined;
}

function groupChats(chats: SavedChatSummary[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(today);
  week.setDate(week.getDate() - 7);
  const groups: Record<string, SavedChatSummary[]> = { Today: [], "Previous 7 days": [], Older: [] };
  [...chats].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).forEach((chat) => {
    const date = new Date(chat.updated_at);
    const label = date >= today ? "Today" : date >= week ? "Previous 7 days" : "Older";
    groups[label]!.push(chat);
  });
  return Object.entries(groups).filter(([, items]) => items.length > 0);
}

export function RecentChatsDrawer({
  isOpen,
  onClose,
  onSelectChat,
  onChatDeleted,
  variant = "drawer",
  refreshKey = 0,
  activeChatId = null,
  disabled = false,
  ongoingChats = [],
  activeOngoingId = null,
  onSelectOngoingChat,
  onSaveOngoingChat,
  onDeleteOngoingChat,
  isSavingOngoing = false,
}: RecentChatsDrawerProps) {
  const [chats, setChats] = useState<SavedChatSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const items = await listSavedChats();
        if (!cancelled) setChats(items);
      } catch {
        if (!cancelled) setError("Chat history is temporarily unavailable.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [isOpen, refreshKey, reload]);

  useEffect(() => {
    if (!isOpen || variant !== "drawer") return;
    function escape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [isOpen, onClose, variant]);

  async function remove(chatId: string) {
    if (deleting !== null) return;
    setDeleting(chatId);
    try {
      await deleteSavedChat(chatId);
      setChats((previous) => previous.filter((chat) => chat.id !== chatId));
      setError(null);
      onChatDeleted?.(chatId);
    } catch { setError("Could not delete this chat. Try again."); }
    finally { setDeleting(null); }
  }

  if (!isOpen) return null;
  const content = <>
    <div className="chat-history__heading"><h2>Chat History</h2>
      <button type="button" className="shell-icon-button" disabled={isLoading || deleting !== null}
        aria-label="Refresh chat history" onClick={() => setReload((previous) => previous + 1)}>
        <ShellIcon name="refresh" />
      </button>
    </div>
    {error ? <p className="chat-history__error" role="alert">{error}</p> : null}

    {/* Ongoing Session Chats */}
    {ongoingChats.length > 0 ? (
      <section className="chat-history__group" aria-label="Ongoing">
        <h3>Ongoing</h3>
        <ul>
          {ongoingChats.map((chat) => (
            <li
              className={
                "chat-history__row" +
                (activeOngoingId === chat.id ? " is-active" : "")
              }
              key={chat.id}
            >
              <button
                type="button"
                className="chat-history__open"
                title={chat.title}
                disabled={disabled}
                aria-current={activeOngoingId === chat.id ? "page" : undefined}
                onClick={() => {
                  onSelectOngoingChat?.(chat.id);
                  onClose();
                }}
              >
                {chat.title}
              </button>
              {onSaveOngoingChat ? (
                <button
                  type="button"
                  className="shell-icon-button chat-history__save-btn"
                  disabled={disabled || isSavingOngoing}
                  aria-label={`Save ${chat.title}`}
                  title="Save chat to account"
                  onClick={() => onSaveOngoingChat(chat.id)}
                >
                  <ShellIcon name="save" />
                </button>
              ) : null}
              {onDeleteOngoingChat ? (
                <button
                  type="button"
                  className="shell-icon-button chat-history__delete"
                  disabled={disabled}
                  aria-label={`Discard ${chat.title}`}
                  title="Discard chat"
                  onClick={() => onDeleteOngoingChat(chat.id)}
                >
                  <ShellIcon name="delete" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    ) : null}

    {isLoading ? (
      <p className="chat-history__empty" role="status">Loading saved chats&hellip;</p>
    ) : chats.length === 0 && ongoingChats.length === 0 && !error ? (
      <p className="chat-history__empty">Your saved chats will appear here. Use Save Chat to keep a conversation.</p>
    ) : null}

    {!isLoading ? groupChats(chats).map(([label, items]) => <section className="chat-history__group" aria-label={label} key={label}>
      <h3>{label}</h3><ul>{items.map((chat) => <li className={"chat-history__row" + (activeChatId === chat.id ? " is-active" : "")} key={chat.id}>
        <button type="button" className="chat-history__open" title={chat.title} disabled={disabled || deleting === chat.id}
          aria-current={activeChatId === chat.id ? "page" : undefined}
          onClick={() => { onSelectChat(chat.id); onClose(); }}>{chat.title}</button>
        <button type="button" className="shell-icon-button chat-history__delete" disabled={disabled || deleting !== null}
          aria-label={"Delete " + chat.title} onClick={() => void remove(chat.id)}><ShellIcon name="delete" /></button>
      </li>)}</ul>
    </section>) : null}
  </>;

  if (variant === "sidebar") return <section className="chat-history" aria-label="Chat history">{content}</section>;
  return <div className="recent-chats-backdrop" role="presentation" onClick={onClose}>
    <aside className="recent-chats-drawer" role="dialog" aria-modal="true" aria-label="Recent Saved Chats" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="shell-icon-button" aria-label="Close recent chats" onClick={onClose}><ShellIcon name="close" /></button>
      {content}
    </aside>
  </div>;
}