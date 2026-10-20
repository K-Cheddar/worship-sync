import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobalInfoContext } from "../context/globalInfo";
import { ToastContext } from "../context/toastContext";
import { createMockGlobalInfo } from "../test/mocks";
import { FloatingWindowZIndexProvider } from "../components/FloatingWindow/FloatingWindowZIndexContext";
import { ChatProvider, useChat } from "./ChatContext";
import ChatWindowHost from "./ChatWindowHost";
import ChatWindow from "./ChatWindow";
import type { ChatMessage, ChatStreamEvent } from "./types";
import {
  getChatContext,
  getChatMessages,
  setChatTyping,
  streamChatEvents,
} from "./api";

jest.mock("./api", () => ({
  editChatMessage: jest.fn(),
  getChatContext: jest.fn(),
  getChatMessages: jest.fn(),
  removeChatMessage: jest.fn(),
  sendChatMessage: jest.fn(),
  setChatTyping: jest.fn(),
  streamChatEvents: jest.fn(),
  toggleChatReaction: jest.fn(),
  uploadChatImage: jest.fn(),
}));

const mockedGetChatContext = jest.mocked(getChatContext);
const mockedGetChatMessages = jest.mocked(getChatMessages);
const mockedSetChatTyping = jest.mocked(setChatTyping);
const mockedStreamChatEvents = jest.mocked(streamChatEvents);

const chatContext = {
  actorId: "user_1",
  actorName: "Alex",
  timeZone: "UTC",
  todayKey: "2026-08-10",
  retentionDays: 365,
  imageUploadsEnabled: true,
  reactionEmojis: ["👍"],
};

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  messageId: "chat_1",
  clientMessageId: "client_1",
  churchId: "church-1",
  dayKey: "2026-08-10",
  text: "Initial message",
  authorId: "user_2",
  authorName: "Jordan",
  authorSessionKind: "human",
  createdAt: 1,
  reactions: [],
  ...overrides,
});

const TypingHarness = () => {
  const chat = useChat();
  return (
    <>
      <button type="button" disabled={!chat?.context} onClick={chat?.openChat}>
        Open chat
      </button>
      <button
        type="button"
        disabled={!chat?.isOpen}
        onClick={() => chat?.updateTypingDraft(true)}
      >
        Start typing
      </button>
      <button type="button" disabled={!chat?.isOpen} onClick={chat?.closeChat}>
        Close chat
      </button>
    </>
  );
};

const MessageCountHarness = () => {
  const chat = useChat();
  return <div>{chat?.messages.length ?? 0} messages</div>;
};

const UnreadHarness = () => {
  const chat = useChat();
  const latestMessage = chat?.messages.at(-1);
  return (
    <button
      type="button"
      onClick={() => {
        if (latestMessage) chat?.markReadThrough(latestMessage.createdAt);
      }}
    >
      Mark latest read ({chat?.unreadCount ?? 0})
    </button>
  );
};

const OpenChatHarness = () => {
  const chat = useChat();
  return (
    <>
      <button type="button" onClick={chat?.openChat}>
        Open team chat
      </button>
      <div data-testid="live-unread-count">{chat?.unreadCount ?? 0}</div>
      {chat?.isOpen ? <ChatWindow /> : null}
    </>
  );
};

const FloatingOpenChatHarness = () => {
  const chat = useChat();
  return (
    <>
      <button type="button" onClick={chat?.openChat}>
        Open team chat
      </button>
      <div data-testid="live-unread-count">{chat?.unreadCount ?? 0}</div>
      <ChatWindowHost />
    </>
  );
};

const PaginationHarness = () => {
  const chat = useChat();
  return (
    <>
      <div>{chat?.hasMore ? "More available" : "History complete"}</div>
      <button type="button" onClick={() => void chat?.loadMore()}>
        Load more
      </button>
    </>
  );
};

describe("ChatProvider incoming notifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    delete window.electronAPI;
  });

  it("suppresses initial history and notifies for the next incoming message", async () => {
    let onStreamEvent: ((event: ChatStreamEvent) => void) | null = null;
    mockedGetChatContext.mockResolvedValue({ context: chatContext });
    mockedGetChatMessages.mockResolvedValue({
      context: chatContext,
      dayKey: chatContext.todayKey,
      messages: [],
      hasMore: false,
    });
    mockedStreamChatEvents.mockImplementation(
      ({ signal, onEvent }) =>
        new Promise<void>((resolve) => {
          onStreamEvent = onEvent;
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    );
    const showToast = jest.fn(() => "toast-chat");
    const requestTaskbarAttention = jest.fn().mockResolvedValue(true);
    window.electronAPI = {
      requestChatTaskbarAttention: requestTaskbarAttention,
    } as unknown as ElectronAPI;

    render(
      <MemoryRouter initialEntries={["/current-service/view"]}>
        <GlobalInfoContext.Provider
          value={createMockGlobalInfo() as never}
        >
          <ToastContext.Provider
            value={{
              showToast,
              updateToast: jest.fn(),
              removeToast: jest.fn(),
            }}
          >
            <ChatProvider>
              <div>App</div>
            </ChatProvider>
          </ToastContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(onStreamEvent).not.toBeNull());
    act(() => {
      onStreamEvent?.({
        type: "connected",
        churchId: "church-1",
        dayKey: chatContext.todayKey,
      });
      onStreamEvent?.({
        type: "initial-messages",
        dayKey: chatContext.todayKey,
        messages: [message()],
        hasMore: false,
      });
      onStreamEvent?.({ type: "stream-ready" });
    });
    expect(showToast).not.toHaveBeenCalled();
    expect(mockedGetChatMessages).not.toHaveBeenCalled();

    act(() => {
      onStreamEvent?.({
        type: "message-updated",
        message: message({
          messageId: "chat_2",
          clientMessageId: "client_2",
          text: "Ready for the next slide?",
          createdAt: 2,
        }),
      });
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "chat",
        position: "top-right",
        duration: 12_000,
      }),
    );
    expect(requestTaskbarAttention).toHaveBeenCalledWith({
      churchId: "church-1",
      actorId: "user_1",
    });

    act(() => {
      onStreamEvent?.({
        type: "message-updated",
        message: message({
          messageId: "chat_2",
          clientMessageId: "client_2",
          text: "Replayed after reconnect",
          createdAt: 2,
        }),
      });
      onStreamEvent?.({
        type: "initial-messages",
        dayKey: chatContext.todayKey,
        messages: [message()],
        hasMore: false,
      });
      onStreamEvent?.({ type: "stream-ready" });
      onStreamEvent?.({
        type: "message-updated",
        message: message({
          messageId: "chat_own",
          clientMessageId: "client_own",
          authorId: "user_1",
          createdAt: 3,
        }),
      });
      onStreamEvent?.({
        type: "message-updated",
        message: message({
          messageId: "chat_edited",
          clientMessageId: "client_edited",
          editedAt: 4,
          createdAt: 4,
        }),
      });
      onStreamEvent?.({
        type: "message-updated",
        message: message({
          messageId: "chat_deleted",
          clientMessageId: "client_deleted",
          deletedAt: 5,
          createdAt: 5,
        }),
      });
      onStreamEvent?.({
        type: "message-updated",
        message: message({
          messageId: "chat_reaction",
          clientMessageId: "client_reaction",
          createdAt: 6,
          reactions: [
            { emoji: "👍", actors: [{ actorId: "user_3", name: "Sam" }] },
          ],
        }),
      });
    });
    expect(requestTaskbarAttention).toHaveBeenCalledTimes(2);

    act(() => {
      onStreamEvent?.({
        type: "message-updated",
        message: message({
          messageId: "chat_2",
          clientMessageId: "client_2",
          createdAt: 2,
          reactions: [
            { emoji: "👍", actors: [{ actorId: "user_3", name: "Sam" }] },
          ],
        }),
      });
    });
    expect(requestTaskbarAttention).toHaveBeenCalledTimes(2);
  });

  it("shows initial unread history without flashing and clears when read", async () => {
    let onStreamEvent: ((event: ChatStreamEvent) => void) | null = null;
    const setTaskbarUnread = jest.fn().mockResolvedValue(true);
    const requestTaskbarAttention = jest.fn().mockResolvedValue(true);
    window.electronAPI = {
      setChatTaskbarUnreadState: setTaskbarUnread,
      requestChatTaskbarAttention: requestTaskbarAttention,
    } as unknown as ElectronAPI;
    mockedGetChatContext.mockResolvedValue({ context: chatContext });
    mockedGetChatMessages.mockResolvedValue({
      context: chatContext,
      dayKey: chatContext.todayKey,
      messages: [],
      hasMore: false,
    });
    mockedStreamChatEvents.mockImplementation(
      ({ signal, onEvent }) =>
        new Promise<void>((resolve) => {
          onStreamEvent = onEvent;
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    );

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalInfo() as never}>
          <ToastContext.Provider
            value={{
              showToast: jest.fn(),
              updateToast: jest.fn(),
              removeToast: jest.fn(),
            }}
          >
            <ChatProvider>
              <UnreadHarness />
            </ChatProvider>
          </ToastContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(onStreamEvent).not.toBeNull());
    act(() => {
      onStreamEvent?.({
        type: "initial-messages",
        dayKey: chatContext.todayKey,
        messages: [message()],
        hasMore: false,
      });
      onStreamEvent?.({ type: "stream-ready" });
    });

    await waitFor(() =>
      expect(setTaskbarUnread).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: { churchId: "church-1", actorId: "user_1" }, unread: true }),
      ),
    );
    expect(requestTaskbarAttention).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mark latest read (1)" }));
    await waitFor(() =>
      expect(setTaskbarUnread).toHaveBeenLastCalledWith(
        expect.objectContaining({ unread: false }),
      ),
    );
  });

  it("clears taskbar unread state on church changes and logout", async () => {
    let onStreamEvent: ((event: ChatStreamEvent) => void) | null = null;
    const setTaskbarUnread = jest.fn().mockResolvedValue(true);
    window.electronAPI = {
      setChatTaskbarUnreadState: setTaskbarUnread,
    } as unknown as ElectronAPI;
    mockedGetChatContext.mockResolvedValue({ context: chatContext });
    mockedGetChatMessages.mockResolvedValue({
      context: chatContext,
      dayKey: chatContext.todayKey,
      messages: [],
      hasMore: false,
    });
    mockedStreamChatEvents.mockImplementation(
      ({ signal, onEvent }) =>
        new Promise<void>((resolve) => {
          onStreamEvent = onEvent;
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    );

    const renderChat = (globalInfo: Record<string, unknown>) => (
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={globalInfo as never}>
          <ToastContext.Provider
            value={{
              showToast: jest.fn(),
              updateToast: jest.fn(),
              removeToast: jest.fn(),
            }}
          >
            <ChatProvider>
              <UnreadHarness />
            </ChatProvider>
          </ToastContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>
    );
    const view = render(renderChat(createMockGlobalInfo()));

    await waitFor(() => expect(onStreamEvent).not.toBeNull());
    act(() => {
      onStreamEvent?.({
        type: "initial-messages",
        dayKey: chatContext.todayKey,
        messages: [message()],
        hasMore: false,
      });
      onStreamEvent?.({ type: "stream-ready" });
    });
    await waitFor(() =>
      expect(setTaskbarUnread).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: { churchId: "church-1", actorId: "user_1" }, unread: true }),
      ),
    );

    view.rerender(renderChat(createMockGlobalInfo({ churchId: "church-2" })));
    await waitFor(() =>
      expect(setTaskbarUnread).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: { churchId: "church-2", actorId: "user_1" }, unread: false }),
      ),
    );
    expect(
      setTaskbarUnread.mock.calls.some(
        ([state]) => state.scope === null && state.unread === false,
      ),
    ).toBe(true);

    view.rerender(
      renderChat(createMockGlobalInfo({ churchId: "church-2", loginState: "idle" })),
    );
    await waitFor(() =>
      expect(setTaskbarUnread).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: null, unread: false }),
      ),
    );
  });

  it("keeps an open chat unread behind another app and reads it on focus", async () => {
    let onStreamEvent: ((event: ChatStreamEvent) => void) | null = null;
    const setTaskbarUnread = jest.fn().mockResolvedValue(true);
    const requestTaskbarAttention = jest.fn().mockResolvedValue(true);
    window.electronAPI = {
      setChatTaskbarUnreadState: setTaskbarUnread,
      requestChatTaskbarAttention: requestTaskbarAttention,
    } as unknown as ElectronAPI;
    mockedGetChatContext.mockResolvedValue({ context: chatContext });
    mockedGetChatMessages.mockResolvedValue({
      context: chatContext,
      dayKey: chatContext.todayKey,
      messages: [],
      hasMore: false,
    });
    mockedStreamChatEvents.mockImplementation(
      ({ signal, onEvent }) =>
        new Promise<void>((resolve) => {
          onStreamEvent = onEvent;
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    );

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalInfo() as never}>
          <ToastContext.Provider
            value={{
              showToast: jest.fn(),
              updateToast: jest.fn(),
              removeToast: jest.fn(),
            }}
          >
            <ChatProvider>
              <OpenChatHarness />
            </ChatProvider>
          </ToastContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(onStreamEvent).not.toBeNull());
    act(() => {
      onStreamEvent?.({
        type: "initial-messages",
        dayKey: chatContext.todayKey,
        messages: [],
        hasMore: false,
      });
      onStreamEvent?.({ type: "stream-ready" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Open team chat" }));
    act(() => window.dispatchEvent(new Event("blur")));

    const incomingMessage = message({
      messageId: "background-chat",
      clientMessageId: "client-background-chat",
      text: "Arrived while another app is active",
      createdAt: 2,
    });
    act(() => {
      onStreamEvent?.({ type: "message-updated", message: incomingMessage });
    });

    expect(await screen.findByTestId("live-unread-count")).toHaveTextContent("1");
    await waitFor(() =>
      expect(setTaskbarUnread).toHaveBeenLastCalledWith(
        expect.objectContaining({ unread: true }),
      ),
    );
    expect(requestTaskbarAttention).toHaveBeenCalledWith({
      churchId: "church-1",
      actorId: "user_1",
    });
    expect(localStorage.getItem("worshipsync-chat-read:church-1:user_1")).toBeNull();

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() =>
      expect(setTaskbarUnread).toHaveBeenLastCalledWith(
        expect.objectContaining({ unread: false }),
      ),
    );
    expect(localStorage.getItem("worshipsync-chat-read:church-1:user_1")).toBe(
      String(incomingMessage.createdAt),
    );
  });

  it("keeps incoming messages unread while the focused chat window is minimized", async () => {
    let onStreamEvent: ((event: ChatStreamEvent) => void) | null = null;
    const setTaskbarUnread = jest.fn().mockResolvedValue(true);
    window.electronAPI = {
      setChatTaskbarUnreadState: setTaskbarUnread,
    } as unknown as ElectronAPI;
    mockedGetChatContext.mockResolvedValue({ context: chatContext });
    mockedGetChatMessages.mockResolvedValue({
      context: chatContext,
      dayKey: chatContext.todayKey,
      messages: [],
      hasMore: false,
    });
    mockedStreamChatEvents.mockImplementation(
      ({ signal, onEvent }) =>
        new Promise<void>((resolve) => {
          onStreamEvent = onEvent;
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    );

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <FloatingWindowZIndexProvider>
          <GlobalInfoContext.Provider value={createMockGlobalInfo() as never}>
            <ToastContext.Provider
              value={{
                showToast: jest.fn(),
                updateToast: jest.fn(),
                removeToast: jest.fn(),
              }}
            >
              <ChatProvider>
                <FloatingOpenChatHarness />
              </ChatProvider>
            </ToastContext.Provider>
          </GlobalInfoContext.Provider>
        </FloatingWindowZIndexProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(onStreamEvent).not.toBeNull());
    act(() => {
      onStreamEvent?.({
        type: "initial-messages",
        dayKey: chatContext.todayKey,
        messages: [],
        hasMore: false,
      });
      onStreamEvent?.({ type: "stream-ready" });
    });

    fireEvent.click(screen.getByRole("button", { name: "Open team chat" }));
    await screen.findByRole("button", { name: "Minimize window" });
    act(() => window.dispatchEvent(new Event("focus")));
    fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
    await screen.findByRole("button", { name: "Restore window" });

    const incomingMessage = message({
      messageId: "minimized-chat",
      clientMessageId: "client-minimized-chat",
      text: "Arrived while chat was minimized",
      createdAt: 2,
    });
    act(() => {
      onStreamEvent?.({ type: "message-updated", message: incomingMessage });
    });

    expect(await screen.findByTestId("live-unread-count")).toHaveTextContent("1");
    await waitFor(() =>
      expect(setTaskbarUnread).toHaveBeenLastCalledWith(
        expect.objectContaining({ unread: true }),
      ),
    );
    expect(localStorage.getItem("worshipsync-chat-read:church-1:user_1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Restore window" }));
    await waitFor(() =>
      expect(setTaskbarUnread).toHaveBeenLastCalledWith(
        expect.objectContaining({ unread: false }),
      ),
    );
    expect(localStorage.getItem("worshipsync-chat-read:church-1:user_1")).toBe(
      String(incomingMessage.createdAt),
    );
  });

  it("starts and clears typing presence without blocking chat", async () => {
    mockedGetChatContext.mockResolvedValue({ context: chatContext });
    mockedGetChatMessages.mockResolvedValue({
      context: chatContext,
      dayKey: chatContext.todayKey,
      messages: [],
      hasMore: false,
    });
    mockedSetChatTyping.mockResolvedValue({
      typing: { active: true, expiresAt: Date.now() + 10_000 },
    });
    mockedStreamChatEvents.mockImplementation(
      ({ signal, onEvent }) =>
        new Promise<void>((resolve) => {
          onEvent({
            type: "initial-messages",
            dayKey: chatContext.todayKey,
            messages: [],
            hasMore: false,
          });
          onEvent({ type: "stream-ready" });
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    );

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalInfo() as never}>
          <ToastContext.Provider
            value={{
              showToast: jest.fn(),
              updateToast: jest.fn(),
              removeToast: jest.fn(),
            }}
          >
            <ChatProvider>
              <TypingHarness />
            </ChatProvider>
          </ToastContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open chat" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Start typing" }));
    await waitFor(() =>
      expect(mockedSetChatTyping).toHaveBeenCalledWith("church-1", {
        isTyping: true,
        timeZone: "UTC",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    await waitFor(() =>
      expect(mockedSetChatTyping).toHaveBeenLastCalledWith("church-1", {
        isTyping: false,
        timeZone: "UTC",
      }),
    );
  });

  it("falls back to a paged read when the live stream cannot connect", async () => {
    mockedGetChatContext.mockResolvedValue({ context: chatContext });
    mockedGetChatMessages.mockResolvedValue({
      context: chatContext,
      dayKey: chatContext.todayKey,
      messages: [message()],
      hasMore: false,
    });
    mockedStreamChatEvents.mockRejectedValue(new Error("Stream unavailable"));

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalInfo() as never}>
          <ToastContext.Provider
            value={{
              showToast: jest.fn(),
              updateToast: jest.fn(),
              removeToast: jest.fn(),
            }}
          >
            <ChatProvider>
              <MessageCountHarness />
            </ChatProvider>
          </ToastContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("1 messages")).toBeInTheDocument();
    expect(mockedGetChatMessages).toHaveBeenCalledTimes(1);
  });

  it("merges fallback history with messages received before the stream fails", async () => {
    mockedGetChatContext.mockResolvedValue({ context: chatContext });
    mockedGetChatMessages.mockResolvedValue({
      context: chatContext,
      dayKey: chatContext.todayKey,
      messages: [message({ messageId: "chat_history", createdAt: 1 })],
      hasMore: true,
    });
    mockedStreamChatEvents.mockImplementation(async ({ onEvent }) => {
      onEvent({
        type: "message-updated",
        message: message({
          messageId: "chat_live",
          clientMessageId: "client_live",
          text: "Arrived while connecting",
          createdAt: 2,
        }),
      });
      throw new Error("Stream unavailable");
    });

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalInfo() as never}>
          <ToastContext.Provider
            value={{
              showToast: jest.fn(),
              updateToast: jest.fn(),
              removeToast: jest.fn(),
            }}
          >
            <ChatProvider>
              <MessageCountHarness />
            </ChatProvider>
          </ToastContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("2 messages")).toBeInTheDocument();
    expect(mockedGetChatMessages).toHaveBeenCalledTimes(1);
  });

  it("keeps today's pagination exhausted after a reconnect snapshot", async () => {
    let onStreamEvent: ((event: ChatStreamEvent) => void) | null = null;
    mockedGetChatContext.mockResolvedValue({ context: chatContext });
    mockedGetChatMessages.mockResolvedValue({
      context: chatContext,
      dayKey: chatContext.todayKey,
      messages: [],
      hasMore: false,
    });
    mockedStreamChatEvents.mockImplementation(
      ({ signal, onEvent }) =>
        new Promise<void>((resolve) => {
          onStreamEvent = onEvent;
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    );

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalInfo() as never}>
          <ToastContext.Provider
            value={{
              showToast: jest.fn(),
              updateToast: jest.fn(),
              removeToast: jest.fn(),
            }}
          >
            <ChatProvider>
              <PaginationHarness />
            </ChatProvider>
          </ToastContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(onStreamEvent).not.toBeNull());
    act(() => {
      onStreamEvent?.({
        type: "initial-messages",
        dayKey: chatContext.todayKey,
        messages: [message()],
        hasMore: true,
      });
    });
    expect(await screen.findByText("More available")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("History complete")).toBeInTheDocument();

    act(() => {
      onStreamEvent?.({
        type: "initial-messages",
        dayKey: chatContext.todayKey,
        messages: [message()],
        hasMore: true,
      });
    });
    expect(screen.getByText("History complete")).toBeInTheDocument();
  });
});
