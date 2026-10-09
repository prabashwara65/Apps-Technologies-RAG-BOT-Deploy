import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { askHrQuestion, HrAskError } from "../api/Rag";
import type { HrAskFailureKind } from "../api/Rag";
import { ChatComposer } from "./ChatComposer";
import { ChatMessage } from "./ChatMessage";
import type { ChatTurn } from "./ChatMessage";
import type { FeedbackResponse } from "../api/feedback";
import { ErrorNotice } from "./ErrorNotice";
import { DocumentUploadPanel } from "./DocumentUploadPanel";
import type { Profile, ThemePreference, UserRole } from "../api/auth";
import { getSavedChat, saveChatSession } from "../api/savedChats";
import { Sidebar } from "./Sidebar";
import type { OngoingSessionChat } from "./RecentChatsDrawer";
import { SidebarAccountMenu } from "./SidebarAccountMenu";
import { ShellIcon } from "./ShellIcon";
import { BrandLogo } from "./BrandLogo";
import "../chat-shell.css";
import { EventsDrawer } from "./EventsDrawer";
import {
  extractChatTitle,
  loadActiveChat,
  loadActiveSessionId,
  loadSessionChats,
  saveActiveChat,
  saveActiveSessionId,
  saveSessionChats,
} from "../services/activeChatStorage";
import type { SessionChat } from "../services/activeChatStorage";

const TENANT_ID = "tenant-real";

interface Failure {
  kind: HrAskFailureKind;
  correlationId: string | null;
}

interface ChatWorkspaceProps {
  userRole: UserRole | undefined;
  onUnauthenticated: () => void;
  userId?: string | undefined;
  user?: Profile;
  avatarUrl?: string | null;
  content?: ReactNode;
  onOpenChat?: () => void;
  onOpenDashboard?: (() => void) | undefined;
  isDashboardActive?: boolean | undefined;
  onOpenActivity?: (() => void) | undefined;
  isActivityActive?: boolean | undefined;
  onOpenProfile?: () => void;
  onOpenUsers?: () => void;
  onThemeChange?: (theme: ThemePreference) => void;
  onLogout?: () => void;
}

export function ChatWorkspace({
  onUnauthenticated,
  userId = "default",
  userRole,
  user,
  avatarUrl = null,
  content,
  onOpenChat = () => {},
  onOpenDashboard,
  isDashboardActive = false,
  onOpenActivity,
  isActivityActive = false,
  onOpenProfile = () => {},
  onOpenUsers = () => {},
  onThemeChange = () => {},
  onLogout = () => {},
}: ChatWorkspaceProps) {
  const [sessionChats, setSessionChats] = useState<SessionChat[]>(() => loadSessionChats(userId));
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => loadActiveSessionId(userId));
  const [turns, setTurns] = useState<ChatTurn[]>(() => loadActiveChat(userId));
  const [isLoading, setIsLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const documentDetailsRef = useRef<HTMLDetailsElement>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const showingOtherContent = content !== undefined;
  const nextTurnId = useRef(turns.length);

  // Sync active ongoing turns with browser storage on every update
  useEffect(() => {
    saveActiveChat(userId, turns);
  }, [turns, userId]);

  const ongoingChatsList: OngoingSessionChat[] = useMemo(() => {
    const list: OngoingSessionChat[] = [];
    if (turns.length > 0 && activeChatId === null) {
      list.push({
        id: activeSessionId ?? "session-active",
        title: extractChatTitle(turns),
        message_count: turns.length,
        updated_at: new Date().toISOString(),
      });
    }
    for (const c of sessionChats) {
      if (c.id !== activeSessionId) {
        list.push({
          id: c.id,
          title: c.title,
          message_count: c.turns.length,
          updated_at: c.updated_at,
        });
      }
    }
    return list;
  }, [sessionChats, turns, activeChatId, activeSessionId]);

  const activeOngoingId =
    activeChatId === null
      ? (activeSessionId ?? (turns.length > 0 ? "session-active" : null))
      : null;

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript && !showingOtherContent && followLatest.current) {
      // Scroll this region only; never move the app shell or the browser page.
      transcript.scrollTop = transcript.scrollHeight;
    }
  }, [turns, isLoading, failure, showingOtherContent]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!showingOtherContent && followLatest.current) transcript.scrollTop = transcript.scrollHeight;
    });
    observer.observe(transcript);
    return () => observer.disconnect();
  }, [showingOtherContent]);

  function handleTranscriptScroll() {
    const transcript = transcriptRef.current;
    if (transcript) {
      followLatest.current = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= 64;
    }
  }

  function closeSidebar() {
    setSidebarOpen(false);
    if (sidebarOpen) menuButton.current?.focus();
  }

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth > 760) setSidebarOpen(false);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const element = sidebarRef.current;
    element?.querySelector<HTMLButtonElement>(".assistant-sidebar__close")?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setSidebarOpen(false);
        menuButton.current?.focus();
      }
      if (event.key !== "Tab" || !element) return;
      const buttons = Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
        .filter((button) => !button.closest("[hidden]"));
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [sidebarOpen]);

  function navigate(action: () => void) {
    setEventsOpen(false);
    closeSidebar();
    action();
  }

  function createTurnId(): string {
    nextTurnId.current += 1;
    return `turn-${Date.now()}-${nextTurnId.current}`;
  }

  function handleNewChat() {
    if (turns.length > 0 && activeChatId === null) {
      const id = activeSessionId ?? `session-${Date.now()}`;
      const title = extractChatTitle(turns);
      const archived: SessionChat = {
        id,
        title,
        turns,
        updated_at: new Date().toISOString(),
      };
      const next = [archived, ...sessionChats.filter((c) => c.id !== id)];
      setSessionChats(next);
      saveSessionChats(userId, next);
    }
    followLatest.current = true;
    setTurns([]);
    setActiveChatId(null);
    setActiveSessionId(null);
    saveActiveChat(userId, []);
    saveActiveSessionId(userId, null);
    setFailure(null);
    setSaveToast(null);
    navigate(onOpenChat);
  }

  function handleSavedChatDeleted(chatId: string) {
    if (chatId === activeChatId) {
      handleNewChat();
    }
  }

  function handleSelectOngoingChat(sessionId: string) {
    if (sessionId === activeSessionId && activeChatId === null) {
      navigate(onOpenChat);
      return;
    }
    if (turns.length > 0 && activeChatId === null) {
      const currentId = activeSessionId ?? `session-${Date.now()}`;
      const title = extractChatTitle(turns);
      const archived: SessionChat = {
        id: currentId,
        title,
        turns,
        updated_at: new Date().toISOString(),
      };
      const updated = [archived, ...sessionChats.filter((c) => c.id !== currentId)];
      setSessionChats(updated);
      saveSessionChats(userId, updated);
    }

    const found = sessionChats.find((c) => c.id === sessionId);
    if (!found) return;
    followLatest.current = true;
    setActiveChatId(null);
    setActiveSessionId(sessionId);
    setTurns(found.turns);
    saveActiveChat(userId, found.turns);
    saveActiveSessionId(userId, sessionId);
    navigate(onOpenChat);
  }

  function handleDeleteOngoingChat(sessionId: string) {
    const updated = sessionChats.filter((c) => c.id !== sessionId);
    setSessionChats(updated);
    saveSessionChats(userId, updated);
    if (
      activeSessionId === sessionId ||
      (activeChatId === null &&
        (sessionId === "session-active" || sessionId === activeSessionId))
    ) {
      setTurns([]);
      setActiveSessionId(null);
      saveActiveChat(userId, []);
      saveActiveSessionId(userId, null);
    }
  }

  async function handleSaveChat(targetSessionId?: string) {
    if (isSaving) return;

    let turnsToSave = turns;
    let titleToSave: string | undefined;
    let sessionIdToClear = activeSessionId;

    if (targetSessionId) {
      const found = sessionChats.find((c) => c.id === targetSessionId);
      if (found) {
        turnsToSave = found.turns;
        titleToSave = found.title;
        sessionIdToClear = targetSessionId;
      }
    } else if (activeSessionId) {
      const found = sessionChats.find((c) => c.id === activeSessionId);
      if (found) {
        titleToSave = found.title;
      }
    }

    if (turnsToSave.length === 0) return;

    setIsSaving(true);
    setSaveToast(null);

    try {
      const saved = await saveChatSession(turnsToSave, titleToSave);
      setSaveToast("Chat saved to account!");
      setHistoryRefresh((previous) => previous + 1);

      if (sessionIdToClear) {
        const updated = sessionChats.filter((c) => c.id !== sessionIdToClear);
        setSessionChats(updated);
        saveSessionChats(userId, updated);
      }

      if (!targetSessionId || targetSessionId === activeSessionId) {
        setActiveChatId(saved.id);
        setActiveSessionId(null);
        saveActiveSessionId(userId, null);
      }

      window.setTimeout(() => setSaveToast(null), 3500);
    } catch {
      setSaveToast("Failed to save chat.");
      window.setTimeout(() => setSaveToast(null), 3500);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSelectSavedChat(chatId: string) {
    setEventsOpen(false);
    try {
      setIsLoading(true);
      setFailure(null);

      const detail = await getSavedChat(chatId);

      followLatest.current = true;
      setTurns(detail.messages);
      setActiveChatId(chatId);
      setActiveSessionId(null);
      saveActiveSessionId(userId, null);
      navigate(onOpenChat);
    } catch (error) {
      const kind =
        error instanceof HrAskError ? error.kind : "unexpected";

      if (kind === "unauthenticated") {
        onUnauthenticated();
      }

      setFailure({
        kind: "unexpected",
        correlationId: null,
      });
    } finally {
      setIsLoading(false);
    }
  }

  function handleFeedbackChange(turnId: string, feedback: FeedbackResponse | null) {
    setTurns((previous) => previous.map((turn) =>
      turn.id === turnId && turn.role === "assistant" ? { ...turn, feedback } : turn));
  }

  async function handleAsk(question: string) {
    if (isLoading) {
      return;
    }

    followLatest.current = true;
    setFailure(null);
    if (activeChatId !== null) {
      setActiveChatId(null);
      const newId = `session-${Date.now()}`;
      setActiveSessionId(newId);
      saveActiveSessionId(userId, newId);
    } else if (activeSessionId === null) {
      const newId = `session-${Date.now()}`;
      setActiveSessionId(newId);
      saveActiveSessionId(userId, newId);
    }

    setTurns((previous) => [
      ...previous,
      {
        id: createTurnId(),
        role: "user",
        question,
      },
    ]);

    setIsLoading(true);

    try {
      const response = await askHrQuestion({
        question,
        tenant_id: TENANT_ID,
      });

      setTurns((previous) => [
        ...previous,
        {
          id: createTurnId(),
          role: "assistant",
          response,
          ...(response.trace_id ? { traceId: response.trace_id } : {}),
        },
      ]);
    } catch (error) {
      const kind =
        error instanceof HrAskError ? error.kind : "unexpected";

      if (kind === "unauthenticated") {
        onUnauthenticated();
      }

      setFailure(
        error instanceof HrAskError
          ? {
              kind: error.kind,
              correlationId: error.correlationId,
            }
          : {
              kind: "unexpected",
              correlationId: null,
            },
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="assistant-shell">
      {sidebarOpen ? <button type="button" className="assistant-sidebar-backdrop" aria-label="Close navigation"
        onClick={closeSidebar} /> : null}
      <Sidebar
        sidebarRef={sidebarRef}
        isOpen={sidebarOpen}
        eventsOpen={eventsOpen}
        busy={isLoading}
        activeChatId={activeChatId}
        historyRefresh={historyRefresh}
        onClose={closeSidebar}
        onOpenEvents={() => setEventsOpen((open) => !open)}
        onOpenDashboard={onOpenDashboard ? () => navigate(onOpenDashboard) : undefined}
        isDashboardActive={isDashboardActive}
        onOpenActivity={onOpenActivity ? () => navigate(onOpenActivity) : undefined}
        isActivityActive={isActivityActive}
        onNewChat={handleNewChat}
        events={<EventsDrawer isOpen={eventsOpen} onUnauthenticated={onUnauthenticated} />}
        onSelectChat={(chatId) => void handleSelectSavedChat(chatId)}
        onChatDeleted={handleSavedChatDeleted}
        ongoingChats={ongoingChatsList}
        activeOngoingId={activeOngoingId}
        onSelectOngoingChat={(id) => handleSelectOngoingChat(id)}
        onSaveOngoingChat={(id) => void handleSaveChat(id)}
        onDeleteOngoingChat={(id) => handleDeleteOngoingChat(id)}
        isSavingOngoing={isSaving}
        footer={user ? <SidebarAccountMenu user={user} avatarUrl={avatarUrl} onThemeChange={onThemeChange}
          onOpenProfile={() => navigate(onOpenProfile)} onOpenUsers={() => navigate(onOpenUsers)}
          onLogout={() => navigate(onLogout)} /> : null}
      />
      <div className="assistant-content">
        <main className={`assistant-main${turns.length === 0 ? " assistant-main--new" : ""}`} inert={sidebarOpen}>
          <BrandLogo watermark />
          <header className="assistant-header">
            <button type="button" className="shell-icon-button assistant-header__menu" ref={menuButton}
              aria-label="Open sidebar" aria-expanded={sidebarOpen} aria-controls="assistant-sidebar"
              onClick={() => setSidebarOpen(true)}><ShellIcon name="menu" /></button>
            <h1 className="assistant-header__title">{content !== undefined ? (isDashboardActive ? "Dashboard" : isActivityActive ? "Activity" : "Account") : (turns.length > 0 ? extractChatTitle(turns) : "New chat")}</h1>
            {isDashboardActive && onOpenActivity ? <button type="button" className="shell-save" onClick={() => navigate(onOpenActivity)}>Activity</button> : null}
            {content !== undefined ? <button type="button" className="shell-save" onClick={onOpenChat}>Back to chat</button> : null}
              {userRole === "admin" ? <details ref={documentDetailsRef} className="shell-documents">
                <summary>+ Add Document</summary>
                <div className="shell-documents__panel">
                  <DocumentUploadPanel
                    onUnauthenticated={onUnauthenticated}
                    onClose={() => {
                      if (documentDetailsRef.current !== null) {
                        documentDetailsRef.current.open = false;
                      }
                    }}
                  />
                </div>
              </details> : null}
          </header>
          {saveToast ? <p className="shell-toast" role="status">{saveToast}</p> : null}
          <section className={"chat shell-chat" + (turns.length === 0 ? " shell-chat--empty" : "")}
            hidden={content !== undefined} aria-label="Assistant conversation">
            <div className="chat__transcript" role="log" aria-label="Conversation"
              ref={transcriptRef} onScroll={handleTranscriptScroll}>
              {turns.length === 0 ? <section className="chat-welcome" aria-label="Get started">
                <h2 className="chat-welcome__title">What can I find for you{user?.display_name ? ", " + user.display_name.trim().split(/\s+/)[0] : ""}?</h2>
                <p className="chat-welcome__description">Answers come only from approved documents, and every claim links to the source it came from.</p>
              </section> : null}
              {turns.map((turn) => <ChatMessage key={turn.id} turn={turn} onFeedbackChange={handleFeedbackChange} />)}
              {isLoading ? <p className="message message--pending" role="status">Searching approved HR sources&hellip;</p> : null}
              {failure === null ? null : <ErrorNotice correlationId={failure.correlationId} kind={failure.kind} />}
            </div>
            <div className="shell-chat__bottom">
              {turns.length > 0 && activeChatId === null ? <div className="shell-chat__actions">
                <button type="button" className="shell-save" disabled={isSaving || isLoading}
                  onClick={() => void handleSaveChat()}><ShellIcon name="save" />{isSaving ? "Saving…" : "Save Chat"}</button>
              </div> : null}
              <ChatComposer isLoading={isLoading} onAsk={(question) => void handleAsk(question)} />
              {turns.length === 0 ? <div className="chat-suggestions" aria-label="Suggested questions">
                {[
                  ["Document Formatting Standard", "What line spacing is required?"],
                  ["Travel & Expense Policy", "How long do I have to submit expense receipts?"],
                  ["Information Security Handbook", "What are the password requirements?"],
                  ["Remote Work Guidelines", "How many remote days per week are allowed?"],
                ].map(([label, question]) => <button type="button" key={label} disabled={isLoading}
                  onClick={() => void handleAsk(question!)}><span>{question}</span><small>{label}</small></button>)}
              </div> : null}

            </div>
          </section>
          {content !== undefined ? <div className="shell-screen">{content}</div> : null}
          {turns.length > 0 && content === undefined ? <footer className="assistant-footer">Answers are drawn only from approved documents. Check the cited sources before acting.</footer> : null}
        </main>
      </div>
    </div>
  );
}