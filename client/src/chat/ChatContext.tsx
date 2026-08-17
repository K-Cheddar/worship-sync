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
  setChatTyping,
  streamChatEvents,
  toggleChatReaction,
  uploadChatImage,
} from "./api";
import type {
  ChatContextInfo,
  ChatImageUpload,
  ChatMessage,
  ChatStreamEvent,
  ChatTyper,
} from "./types";
import ChatMessageNotification from "./ChatMessageNotification";

type ChatConnectionStatus = "idle" | "connecting" | "connected" | "retrying";

const TYPING_HEARTBEAT_MS = 4_000;
const TYPING_IDLE_MS = 2_500;
const LIVE_SNAPSHOT_FALLBACK_MS = 5_000;

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
  imageUploadProgress: number | null;
  error: string;
  clearError: () => void;
  retry: () => void;
  connectionStatus: ChatConnectionStatus;
  unreadCount: number;
  typingUsers: ChatTyper[];
  updateTypingDraft: (hasText: boolean) => void;
  sendMessage: (text: string, image?: File) => Promise<boolean>;
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

export const isChatPageRoute = (pathname: string) => pathname === "/chat";

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
  const { showToast, removeToast, updateToast } = useToast();
  const location = useLocation();
  const churchId = globalInfo?.churchId || "";
  const eligible =
    globalInfo?.loginState === "success" &&
    (globalInfo.sessionKind === "human" ||
      globalInfo.sessionKind === "workstation") &&
    Boolean(churchId) &&
    !isChatDisplaySurface(location.pathname);

  const [isOpen, setIsOpen] = useState(false);
  const isChatVisible = isOpen || isChatPageRoute(location.pathname);
  const [context, setContext] = useState<ChatContextInfo | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const [messagesByDay, setMessagesByDay] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [hasMoreByDay, setHasMoreByDay] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState<number | null>(
    null,
  );
  const [error, setError] = useState("");
  const [connectionStatus, setConnectionStatus] =
    useState<ChatConnectionStatus>("idle");
  const [lastReadAt, setLastReadAt] = useState(0);
  const [retrySequence, setRetrySequence] = useState(0);
  const [typingUsers, setTypingUsers] = useState<ChatTyper[]>([]);
  const requestIdRef = useRef(0);
  const isChatVisibleRef = useRef(false);
  const liveStreamReadyRef = useRef(false);
  const initialMessagesReceivedRef = useRef(false);
  const todayFallbackRef = useRef<Promise<void> | null>(null);
  const activeRoomRef = useRef("");
  const knownMessageIdsRef = useRef(new Set<string>());
  const chatToastIdRef = useRef<string | null>(null);
  const pendingSendRef = useRef<{
    text: string;
    clientMessageId: string;
    imageFingerprint: string;
    imageUpload?: ChatImageUpload;
  } | null>(null);
  const sendMessageRef = useRef<(text: string) => Promise<boolean>>(
    async () => false,
  );
  const markReadThroughRef = useRef<(createdAt: number) => void>(() => undefined);
  const typingActiveRef = useRef(false);
  const lastTypingHeartbeatRef = useRef(0);
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isChatVisibleRef.current = isChatVisible;
  }, [isChatVisible]);

  useEffect(() => {
    pendingSendRef.current = null;
    setImageUploadProgress(null);
  }, [churchId]);

  const postTypingState = useCallback(
    (isTyping: boolean) => {
      if (!churchId || !context) return;
      void setChatTyping(churchId, {
        isTyping,
        timeZone: context.timeZone,
      }).catch(() => {
        // Typing presence is optional and must never interrupt messaging.
      });
    },
    [churchId, context],
  );

  const stopTyping = useCallback(() => {
    if (typingIdleTimerRef.current) {
      clearTimeout(typingIdleTimerRef.current);
      typingIdleTimerRef.current = null;
    }
    if (!typingActiveRef.current) return;
    typingActiveRef.current = false;
    lastTypingHeartbeatRef.current = 0;
    postTypingState(false);
  }, [postTypingState]);

  const updateTypingDraft = useCallback(
    (hasText: boolean) => {
      if (
        !hasText ||
        !isChatVisibleRef.current ||
        !context ||
        selectedDayKey !== context.todayKey
      ) {
        stopTyping();
        return;
      }

      const currentMs = Date.now();
      if (
        !typingActiveRef.current ||
        currentMs - lastTypingHeartbeatRef.current >= TYPING_HEARTBEAT_MS
      ) {
        typingActiveRef.current = true;
        lastTypingHeartbeatRef.current = currentMs;
        postTypingState(true);
      }
      if (typingIdleTimerRef.current) {
        clearTimeout(typingIdleTimerRef.current);
      }
      typingIdleTimerRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
    },
    [context, postTypingState, selectedDayKey, stopTyping],
  );

  const closeChat = useCallback(() => {
    stopTyping();
    setIsOpen(false);
  }, [stopTyping]);

  useEffect(
    () => () => {
      if (typingIdleTimerRef.current) {
        clearTimeout(typingIdleTimerRef.current);
      }
      if (typingActiveRef.current) {
        typingActiveRef.current = false;
        postTypingState(false);
      }
    },
    [postTypingState],
  );

  useEffect(() => {
    if (!typingUsers.length) return;
    const timer = setInterval(() => {
      const currentMs = Date.now();
      setTypingUsers((current) =>
        current.filter((typer) => typer.expiresAt > currentMs),
      );
    }, 1_000);
    return () => clearInterval(timer);
  }, [typingUsers.length]);

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
              : "Could not load those messages. Try again.",
          );
        }
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    },
    [churchId, context, messagesByDay],
  );

  const loadTodayFallback = useCallback(async () => {
    if (
      !churchId ||
      !context ||
      initialMessagesReceivedRef.current
    ) {
      return;
    }
    const roomKey = `${churchId}:${context.todayKey}`;
    if (activeRoomRef.current !== roomKey) return;
    if (todayFallbackRef.current) {
      await todayFallbackRef.current;
      return;
    }

    const request = getChatMessages(churchId, {
      dayKey: context.todayKey,
      timeZone: context.timeZone,
      limit: 50,
    })
      .then((response) => {
        if (
          initialMessagesReceivedRef.current ||
          activeRoomRef.current !== roomKey
        ) {
          return;
        }
        response.messages.forEach((message) =>
          knownMessageIdsRef.current.add(message.messageId),
        );
        initialMessagesReceivedRef.current = true;
        setMessagesByDay((current) => {
          const byId = new Map(
            [...(current[context.todayKey] || []), ...response.messages].map(
              (message) => [message.messageId, message],
            ),
          );
          return {
            ...current,
            [context.todayKey]: sortedMessages([...byId.values()]),
          };
        });
        setHasMoreByDay((current) => ({
          ...current,
          [context.todayKey]:
            current[context.todayKey] ?? response.hasMore,
        }));
      })
      .catch((loadError) => {
        if (
          initialMessagesReceivedRef.current ||
          activeRoomRef.current !== roomKey
        ) {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load today's messages. Try again.",
        );
      })
      .finally(() => {
        if (todayFallbackRef.current === request) {
          todayFallbackRef.current = null;
        }
        if (activeRoomRef.current === roomKey) setIsLoading(false);
      });
    todayFallbackRef.current = request;
    await request;
  }, [churchId, context]);

  useEffect(() => {
    if (!eligible) {
      requestIdRef.current += 1;
      setIsOpen(false);
      setContext(null);
      setSelectedDayKey("");
      setMessagesByDay({});
      setHasMoreByDay({});
      setIsLoading(false);
      setConnectionStatus("idle");
      setTypingUsers([]);
      liveStreamReadyRef.current = false;
      initialMessagesReceivedRef.current = false;
      todayFallbackRef.current = null;
      activeRoomRef.current = "";
      knownMessageIdsRef.current.clear();
      if (chatToastIdRef.current) {
        removeToast(chatToastIdRef.current);
        chatToastIdRef.current = null;
      }
      return;
    }
    let cancelled = false;
    liveStreamReadyRef.current = false;
    initialMessagesReceivedRef.current = false;
    todayFallbackRef.current = null;
    activeRoomRef.current = "";
    knownMessageIdsRef.current.clear();
    setContext(null);
    setMessagesByDay({});
    setHasMoreByDay({});
    setIsLoading(true);
    setError("");
    setConnectionStatus("connecting");
    void getChatContext(churchId, localTimeZone())
      .then(({ context: nextContext }) => {
        if (cancelled) return;
        setContext(nextContext);
        activeRoomRef.current = `${churchId}:${nextContext.todayKey}`;
        setSelectedDayKey(nextContext.todayKey);
        const readKey = `worshipsync-chat-read:${churchId}:${nextContext.actorId}`;
        const storedRead = Number(localStorage.getItem(readKey)) || 0;
        setLastReadAt(storedRead);
      })
      .catch((contextError) => {
        if (cancelled) return;
        setIsLoading(false);
        setError(
          contextError instanceof Error
            ? contextError.message
            : "Could not open team chat. Try again.",
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
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let reconnectRequested = false;

    const connect = async () => {
      if (stopped) return;
      reconnectRequested = false;
      liveStreamReadyRef.current = false;
      abortController = new AbortController();
      setConnectionStatus(attempt > 0 ? "retrying" : "connecting");
      fallbackTimer = setTimeout(() => {
        void loadTodayFallback();
      }, LIVE_SNAPSHOT_FALLBACK_MS);
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
            if (event.type === "initial-messages" && "messages" in event) {
              const messages = event.messages as ChatMessage[];
              initialMessagesReceivedRef.current = true;
              if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
              }
              messages.forEach((message) =>
                knownMessageIdsRef.current.add(message.messageId),
              );
              setMessagesByDay((current) => {
                const byId = new Map(
                  [...(current[context.todayKey] || []), ...messages].map(
                    (message) => [message.messageId, message],
                  ),
                );
                return {
                  ...current,
                  [context.todayKey]: sortedMessages([...byId.values()]),
                };
              });
              setHasMoreByDay((current) => ({
                ...current,
                [context.todayKey]:
                  current[context.todayKey] ?? Boolean(event.hasMore),
              }));
              setIsLoading(false);
              return;
            }
            if (event.type === "stream-ready") {
              liveStreamReadyRef.current = true;
              setIsLoading(false);
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
                !isChatVisibleRef.current &&
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
                  duration: 12_000,
                  children: (toastId) => (
                    <ChatMessageNotification
                      message={message}
                      onOpen={() => {
                        removeToast(toastId);
                        chatToastIdRef.current = null;
                        openChat();
                      }}
                      onReplyStart={() => {
                        updateToast(toastId, { persist: true });
                        markReadThroughRef.current(message.createdAt);
                      }}
                      onReply={async (text) => {
                        const sent = await sendMessageRef.current(text);
                        if (sent) {
                          removeToast(toastId);
                          chatToastIdRef.current = null;
                        }
                        return sent;
                      }}
                    />
                  ),
                });
              }
            }
            if (event.type === "typing-updated" && "typers" in event) {
              const currentMs = Date.now();
              const typers = event.typers as ChatTyper[];
              setTypingUsers(
                typers.filter(
                  (typer) =>
                    typer.actorId !== context.actorId &&
                    typer.expiresAt > currentMs,
                ),
              );
            }
            if (event.type === "stream-error") {
              setConnectionStatus("retrying");
              void loadTodayFallback();
              reconnectRequested = true;
              abortController?.abort();
            }
          },
        });
        if (!stopped) throw new Error("Chat stream ended.");
      } catch (streamError) {
        if (stopped || (abortController.signal.aborted && !reconnectRequested)) {
          return;
        }
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        void loadTodayFallback();
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
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [
    churchId,
    context,
    eligible,
    loadTodayFallback,
    openChat,
    removeToast,
    updateToast,
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
    if (!isChatVisible || !context || selectedDayKey !== context.todayKey)
      return;
    const latest = todayMessages.at(-1)?.createdAt || Date.now();
    if (latest <= lastReadAt) return;
    const readKey = `worshipsync-chat-read:${churchId}:${context.actorId}`;
    localStorage.setItem(readKey, String(latest));
    setLastReadAt(latest);
  }, [
    churchId,
    context,
    isChatVisible,
    lastReadAt,
    selectedDayKey,
    todayMessages,
  ]);

  const markReadThrough = useCallback(
    (createdAt: number) => {
      if (!churchId || !context || !createdAt) return;
      setLastReadAt((current) => {
        if (createdAt <= current) return current;
        const readKey = `worshipsync-chat-read:${churchId}:${context.actorId}`;
        localStorage.setItem(readKey, String(createdAt));
        return createdAt;
      });
    },
    [churchId, context],
  );

  useEffect(() => {
    markReadThroughRef.current = markReadThrough;
  }, [markReadThrough]);

  const selectDay = useCallback(
    async (dayKey: string) => {
      if (dayKey !== context?.todayKey) stopTyping();
      setSelectedDayKey(dayKey);
      if (!messagesByDay[dayKey]) await loadDay(dayKey);
    },
    [context?.todayKey, loadDay, messagesByDay, stopTyping],
  );

  const sendMessage = useCallback(
    async (text: string, image?: File) => {
      if (!churchId || !context) {
        return false;
      }
      const normalizedText = text.trim();
      if (!normalizedText && !image) return false;
      stopTyping();
      setIsSending(true);
      setError("");
      const imageFingerprint = image
        ? `${image.name}:${image.size}:${image.lastModified}:${image.type}`
        : "";
      const pending = pendingSendRef.current;
      const canReusePending = Boolean(
        pending?.text === normalizedText &&
        pending.imageFingerprint === imageFingerprint,
      );
      const clientMessageId = canReusePending
        ? pending!.clientMessageId
        : createClientMessageId();
      pendingSendRef.current = canReusePending
        ? pending!
        : { text: normalizedText, clientMessageId, imageFingerprint };
      try {
        let imageUpload = pendingSendRef.current?.imageUpload;
        if (image && !imageUpload) {
          setImageUploadProgress(0);
          imageUpload = await uploadChatImage(
            churchId,
            image,
            setImageUploadProgress,
          );
          if (pendingSendRef.current?.clientMessageId === clientMessageId) {
            pendingSendRef.current.imageUpload = imageUpload;
          }
        }
        const { message } = await sendChatMessage(churchId, {
          text: normalizedText,
          clientMessageId,
          timeZone: context.timeZone,
          ...(imageUpload ? { imageUpload } : {}),
        });
        upsertMessage(message);
        pendingSendRef.current = null;
        return true;
      } catch (sendError) {
        setError(
          sendError instanceof Error
            ? sendError.message
            : "Could not send your message. Try again.",
        );
        return false;
      } finally {
        setIsSending(false);
        setImageUploadProgress(null);
      }
    },
    [churchId, context, stopTyping, upsertMessage],
  );

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

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
      closeChat,
      context,
      selectedDayKey,
      selectDay,
      messages: messagesByDay[selectedDayKey] || [],
      hasMore: Boolean(hasMoreByDay[selectedDayKey]),
      loadMore: async () => loadDay(selectedDayKey, { append: true }),
      isLoading,
      isSending,
      imageUploadProgress,
      error,
      clearError: () => setError(""),
      retry: () => {
        setError("");
        setRetrySequence((current) => current + 1);
      },
      connectionStatus,
      unreadCount,
      typingUsers:
        context && selectedDayKey === context.todayKey ? typingUsers : [],
      updateTypingDraft,
      sendMessage,
      editMessage,
      removeMessage,
      toggleReaction,
    }),
    [
      connectionStatus,
      closeChat,
      context,
      eligible,
      error,
      hasMoreByDay,
      isLoading,
      isOpen,
      isSending,
      imageUploadProgress,
      loadDay,
      messagesByDay,
      openChat,
      selectedDayKey,
      selectDay,
      sendMessage,
      editMessage,
      removeMessage,
      toggleReaction,
      typingUsers,
      unreadCount,
      updateTypingDraft,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = () => useContext(ChatContext);
