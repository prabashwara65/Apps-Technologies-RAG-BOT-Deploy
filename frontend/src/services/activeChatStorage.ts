import type { ChatTurn } from "../components/ChatMessage";

export interface SessionChat {
  id: string;
  title: string;
  turns: ChatTurn[];
  updated_at: string;
}

const STORAGE_PREFIX = "oiap_active_chat_";
const SESSION_CHATS_PREFIX = "oiap_session_chats_";
const ACTIVE_SESSION_ID_PREFIX = "oiap_active_session_id_";

export function extractChatTitle(turns: ChatTurn[]): string {
  for (const turn of turns) {
    if (turn.role === "user" && turn.question && turn.question.trim()) {
      const clean = turn.question.trim().replace(/\s+/g, " ");
      return clean.length > 38 ? `${clean.slice(0, 36)}…` : clean;
    }
  }
  return "Ongoing Chat";
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

export function loadSessionChats(userId: string): SessionChat[] {
  try {
    const session = getSessionStorage();
    let raw = session?.getItem(`${SESSION_CHATS_PREFIX}${userId}`);
    if (!raw) {
      const local = getLocalStorage();
      raw = local?.getItem(`${SESSION_CHATS_PREFIX}${userId}`);
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as SessionChat[];
    }
    return [];
  } catch {
    return [];
  }
}

export function saveSessionChats(userId: string, chats: SessionChat[]): void {
  try {
    const payload = JSON.stringify(chats);
    getSessionStorage()?.setItem(`${SESSION_CHATS_PREFIX}${userId}`, payload);
    getLocalStorage()?.setItem(`${SESSION_CHATS_PREFIX}${userId}`, payload);
  } catch {
    // Ignore storage quota
  }
}

export function loadActiveChat(userId: string): ChatTurn[] {
  try {
    const session = getSessionStorage();
    let raw = session?.getItem(`${STORAGE_PREFIX}${userId}`);
    if (!raw) {
      const local = getLocalStorage();
      raw = local?.getItem(`${STORAGE_PREFIX}${userId}`);
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as ChatTurn[];
    }
    return [];
  } catch {
    return [];
  }
}

export function saveActiveChat(userId: string, turns: ChatTurn[]): void {
  try {
    if (turns.length === 0) {
      getSessionStorage()?.removeItem(`${STORAGE_PREFIX}${userId}`);
      getLocalStorage()?.removeItem(`${STORAGE_PREFIX}${userId}`);
    } else {
      const payload = JSON.stringify(turns);
      getSessionStorage()?.setItem(`${STORAGE_PREFIX}${userId}`, payload);
      getLocalStorage()?.setItem(`${STORAGE_PREFIX}${userId}`, payload);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function loadActiveSessionId(userId: string): string | null {
  try {
    return (
      getSessionStorage()?.getItem(`${ACTIVE_SESSION_ID_PREFIX}${userId}`) ||
      getLocalStorage()?.getItem(`${ACTIVE_SESSION_ID_PREFIX}${userId}`) ||
      null
    );
  } catch {
    return null;
  }
}

export function saveActiveSessionId(userId: string, id: string | null): void {
  try {
    if (!id) {
      getSessionStorage()?.removeItem(`${ACTIVE_SESSION_ID_PREFIX}${userId}`);
      getLocalStorage()?.removeItem(`${ACTIVE_SESSION_ID_PREFIX}${userId}`);
    } else {
      getSessionStorage()?.setItem(`${ACTIVE_SESSION_ID_PREFIX}${userId}`, id);
      getLocalStorage()?.setItem(`${ACTIVE_SESSION_ID_PREFIX}${userId}`, id);
    }
  } catch {
    // Ignore
  }
}

export function clearActiveChat(userId: string): void {
  try {
    getSessionStorage()?.removeItem(`${STORAGE_PREFIX}${userId}`);
    getSessionStorage()?.removeItem(`${SESSION_CHATS_PREFIX}${userId}`);
    getSessionStorage()?.removeItem(`${ACTIVE_SESSION_ID_PREFIX}${userId}`);
    getLocalStorage()?.removeItem(`${STORAGE_PREFIX}${userId}`);
    getLocalStorage()?.removeItem(`${SESSION_CHATS_PREFIX}${userId}`);
    getLocalStorage()?.removeItem(`${ACTIVE_SESSION_ID_PREFIX}${userId}`);
  } catch {
    // Ignore
  }
}
