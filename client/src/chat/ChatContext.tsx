import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { GlobalInfoContext } from "../context/globalInfo";
import { useToast } from "../context/toastContext";
import {
  editChatMessage,
  getChatContext,
  getChatMessages,
  removeChatMessage,
  sendChatMessage,
  streamChatEvents,
  toggleChatReaction,
} from "./api";
import type { ChatContextInfo, ChatMessage, ChatStreamEvent } from "./types";
import ChatMessageNotification from "./ChatMessageNotification";

type ChatConnectionStatus = "idle" | "connecting" | "connected" | "retrying";

type ChatContextValue = {
  available: boolean;
  isOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
  context: ChatContextInfo | null;
  selectedDayKey: string;
  selectDay: (dayKey: string) => Promise<void>;
  messages: ChatMessage[];
  hasMore: boolean;
  loadMore: () => Promise<void>;
  isLoading: boolean;
  isSending: boolean;
  error: string;
  clearError: () => void;
  retry: () => void;
  connectionStatus: ChatConnectionStatus;
  unreadCount: number;
  sendMessage: (text: string) => Promise<boolean>;
  editMessage: (messageId: string, text: string) => Promise<boolean>;
  removeMessage: (messageId: string) => Promise<boolean>;
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export const isChatDisplaySurface = (pathname: string) =>
  [
    "/projector",
    "/projector-full",
    "/monitor",
    "/stream",
    "/stream-info",
    "/credits",
    "/boards/display",
  ].includes(pathname) || pathname.startsWith("/boards/present/");

const sortedMessages = (messages: ChatMessage[]) =>
  [...messages].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.messageId.localeCompare(b.messageId);
  });

const localTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const createClientMessageId = () => {
  const id = globalThis.crypto?.randomUUID?.();
  return `client-${id || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
};

export const ChatProvider = ({ children }: { children: React.ReactNode }) => {
  const globalInfo = useContext(GlobalInfoContext);
  const { showToast, removeToast } = useToast();
  const location = useLocation();
  const churchId = globalInfo?.churchId || "";
  const eligible =
    globalInfo?.loginState === "success" &&
    (globalInfo.sessionKind === "human" ||
      globalInfo.sessionKind === "workstation") &&
    Boolean(churchId) &&
    !isChatDisplaySurface(location.pathname);

  const [isOpen, setIsOpen] = useState(false);
  const [context, setContext] = useState<ChatContextInfo | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const [messagesByDay, setMessagesByDay] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [hasMoreByDay, setHasMoreByDay] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [connectionStatus, setConnectionStatus] =
    useState<ChatConnectionStatus>("idle");
  const [lastReadAt, setLastReadAt] = useState(0);
  const [retrySequence, setRetrySequence] = useState(0);
  const requestIdRef = useRef(0);
  const isOpenRef = useRef(false);
  const liveStreamReadyRef = useRef(false);
  const knownMessageIdsRef = useRef(new Set<string>());
  const chatToastIdRef = useRef<string | null>(null);
  const pendingSendRef = useRef<{ text: string; clientMessageId: string } | null>(
    null,
  );

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(
    () => () => {
      if (chatToastIdRef.current) removeToast(chatToastIdRef.current);
    },
    [removeToast],
  );

  const openChat = useCallback(() => {
    if (chatToastIdRef.current) {
      removeToast(chatToastIdRef.current);
      chatToastIdRef.current = null;
    }
    if (context) setSelectedDayKey(context.todayKey);
    setIsOpen(true);
  }, [context, removeToast]);

  const upsertMessage = useCallback((message: ChatMessage) => {
    setMessagesByDay((current) => {
      const existing = current[message.dayKey] || [];
      const index = existing.findIndex(
        (candidate) => candidate.messageId === message.messageId,
      );
      const next = [...existing];
      if (index >= 0) next[index] = message;
      else next.push(message);
      return { ...current, [message.dayKey]: sortedMessages(next) };
    });
  }, []);

  const loadDay = useCallback(
    async (dayKey: string, options: { append?: boolean } = {}) => {
      if (!churchId || !context) return;
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setError("");
      try {
        const existing = messagesByDay[dayKey] || [];
        const response = await getChatMessages(churchId, {
          dayKey,
          timeZone: context.timeZone,
          limit: 50,
          before:
            options.append && existing.length > 0
              ? existing[0].createdAt
              : undefined,
        });
        if (requestId !== requestIdRef.current) return;
        setMessagesByDay((current) => {
          const prior = options.append ? current[dayKey] || [] : [];
          const byId = new Map(
            [...response.messages, ...prior].map((message) => [
              message.messageId,
              message,
            ]),
          );
          return { ...current, [dayKey]: sortedMessages([...byId.values()]) };
        });
        setHasMoreByDay((current) => ({
          ...current,
          [dayKey]: response.hasMore,
        }));
      } catch (loadError) {
        if (requestId === requestIdRef.current) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Chat could not be loaded. Try again.",
          );
        }
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    },
    [churchId, context, messagesByDay],
  );

  useEffect(() => {
    if (!eligible) {
      requestIdRef.current += 1;
      setIsOpen(false);
      setContext(null);
      setSelectedDayKey("");
      setMessagesByDay({});
      setHasMoreByDay({});
      setConnectionStatus("idle");
      liveStreamReadyRef.current = false;
      knownMessageIdsRef.current.clear();
      if (chatToastIdRef.current) {
        removeToast(chatToastIdRef.current);
        chatToastIdRef.current = null;
      }
      return;
    }
    let cancelled = false;
    liveStreamReadyRef.current = false;
    knownMessageIdsRef.current.clear();
    setConnectionStatus("connecting");
    void getChatContext(churchId, localTimeZone())
      .then(async ({ context: nextContext }) => {
        if (cancelled) return;
        setContext(nextContext);
        setSelectedDayKey(nextContext.todayKey);
        const readKey = `worshipsync-chat-read:${churchId}:${nextContext.actorId}`;
        const storedRead = Number(localStorage.getItem(readKey)) || 0;
        setLastReadAt(storedRead);
        const response = await getChatMessages(churchId, {
          dayKey: nextContext.todayKey,
          timeZone: nextContext.timeZone,
          limit: 50,
        });
        if (cancelled) return;
        response.messages.forEach((message) =>
          knownMessageIdsRef.current.add(message.messageId),
        );
        setMessagesByDay({
          [nextContext.todayKey]: sortedMessages(response.messages),
        });
        setHasMoreByDay({ [nextContext.todayKey]: response.hasMore });
      })
      .catch((contextError) => {
        if (cancelled) return;
        setError(
          contextError instanceof Error
            ? contextError.message
            : "Chat could not be loaded. Try again.",
        );
        setConnectionStatus("retrying");
      });
    return () => {
      cancelled = true;
    };
  }, [churchId, eligible, removeToast, retrySequence]);

  useEffect(() => {
    if (!eligible || !context?.todayKey) return;
    let stopped = false;
    let abortController: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = async () => {
      if (stopped) return;
      liveStreamReadyRef.current = false;
      abortController = new AbortController();
      setConnectionStatus(attempt > 0 ? "retrying" : "connecting");
      try {
        await streamChatEvents({
          churchId,
          dayKey: context.todayKey,
          signal: abortController.signal,
          onEvent: (event: ChatStreamEvent) => {
            if (event.type === "connected") {
              attempt = 0;
              setConnectionStatus("connected");
              return;
            }
            if (event.type === "stream-ready") {
              liveStreamReadyRef.current = true;
              return;
            }
            if (event.type === "message-updated" && "message" in event) {
              const message = event.message as ChatMessage;
              const isNew = !knownMessageIdsRef.current.has(message.messageId);
              knownMessageIdsRef.current.add(message.messageId);
              upsertMessage(message);
              if (
                isNew &&
                liveStreamReadyRef.current &&
                !isOpenRef.current &&
                !message.deletedAt &&
                message.dayKey === context.todayKey &&
                message.authorId !== context.actorId
              ) {
                if (chatToastIdRef.current) {
                  removeToast(chatToastIdRef.current);
                }
                chatToastIdRef.current = showToast({
                  variant: "chat",
                  position: "top-right",
                  duration: 8000,
                  children: (toastId) => (
                    <ChatMessageNotification
                      message={message}
                      onOpen={() => {
                        removeToast(toastId);
                        chatToastIdRef.current = null;
                        openChat();
                      }}
                    />
                  ),
                });
              }
            }
            if (event.type === "stream-error") {
              setConnectionStatus("retrying");
            }
          },
        });
        if (!stopped) throw new Error("Chat stream ended.");
      } catch (streamError) {
        if (stopped || abortController.signal.aborted) return;
        attempt += 1;
        setConnectionStatus("retrying");
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
        retryTimer = setTimeout(() => void connect(), delay);
      }
    };
    void connect();
    return () => {
      stopped = true;
      abortController?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    churchId,
    context,
    eligible,
    openChat,
    removeToast,
    showToast,
    upsertMessage,
  ]);

  const todayMessages = useMemo(
    () => (context ? messagesByDay[context.todayKey] || [] : []),
    [context, messagesByDay],
  );
  const unreadCount = context
    ? todayMessages.filter(
        (message) =>
          !message.deletedAt &&
          message.authorId !== context.actorId &&
          message.createdAt > lastReadAt,
      ).length
    : 0;

  useEffect(() => {
    if (!isOpen || !context || selectedDayKey !== context.todayKey) return;
    const latest = todayMessages.at(-1)?.createdAt || Date.now();
    if (latest <= lastReadAt) return;
    const readKey = `worshipsync-chat-read:${churchId}:${context.actorId}`;
    localStorage.setItem(readKey, String(latest));
    setLastReadAt(latest);
  }, [churchId, context, isOpen, lastReadAt, selectedDayKey, todayMessages]);

  const selectDay = useCallback(
    async (dayKey: string) => {
      setSelectedDayKey(dayKey);
      if (!messagesByDay[dayKey]) await loadDay(dayKey);
    },
    [loadDay, messagesByDay],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!churchId || !context || selectedDayKey !== context.todayKey) {
        return false;
      }
      setIsSending(true);
      setError("");
      const normalizedText = text.trim();
      const pending = pendingSendRef.current;
      const clientMessageId =
        pending?.text === normalizedText
          ? pending.clientMessageId
          : createClientMessageId();
      pendingSendRef.current = { text: normalizedText, clientMessageId };
      try {
        const { message } = await sendChatMessage(churchId, {
          text: normalizedText,
          clientMessageId,
          timeZone: context.timeZone,
        });
        upsertMessage(message);
        pendingSendRef.current = null;
        return true;
      } catch (sendError) {
        setError(
          sendError instanceof Error
            ? sendError.message
            : "Your message was not sent. Try again.",
        );
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [churchId, context, selectedDayKey, upsertMessage],
  );

  const editMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!churchId) return false;
      setError("");
      try {
        const { message } = await editChatMessage(churchId, messageId, text);
        upsertMessage(message);
        return true;
      } catch (editError) {
        setError(
          editError instanceof Error
            ? editError.message
            : "The message was not updated. Try again.",
        );
        return false;
      }
    },
    [churchId, upsertMessage],
  );

  const removeMessage = useCallback(
    async (messageId: string) => {
      if (!churchId) return false;
      setError("");
      try {
        const { message } = await removeChatMessage(churchId, messageId);
        upsertMessage(message);
        return true;
      } catch (removeError) {
        setError(
          removeError instanceof Error
            ? removeError.message
            : "The message was not removed. Try again.",
        );
        return false;
      }
    },
    [churchId, upsertMessage],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!churchId) return;
      setError("");
      try {
        const { message } = await toggleChatReaction(
          churchId,
          messageId,
          emoji,
        );
        upsertMessage(message);
      } catch (reactionError) {
        setError(
          reactionError instanceof Error
            ? reactionError.message
            : "The reaction was not updated. Try again.",
        );
      }
    },
    [churchId, upsertMessage],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      available: eligible,
      isOpen,
      openChat,
      closeChat: () => setIsOpen(false),
      context,
      selectedDayKey,
      selectDay,
      messages: messagesByDay[selectedDayKey] || [],
      hasMore: Boolean(hasMoreByDay[selectedDayKey]),
      loadMore: async () => loadDay(selectedDayKey, { append: true }),
      isLoading,
      isSending,
      error,
      clearError: () => setError(""),
      retry: () => {
        setError("");
        setRetrySequence((current) => current + 1);
      },
      connectionStatus,
      unreadCount,
      sendMessage,
      editMessage,
      removeMessage,
      toggleReaction,
    }),
    [
      connectionStatus,
      context,
      eligible,
      error,
      hasMoreByDay,
      isLoading,
      isOpen,
      isSending,
      loadDay,
      messagesByDay,
      openChat,
      selectedDayKey,
      selectDay,
      sendMessage,
      editMessage,
      removeMessage,
      toggleReaction,
      unreadCount,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = () => useContext(ChatContext);
