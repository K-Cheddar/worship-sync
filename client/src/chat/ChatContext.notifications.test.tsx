import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobalInfoContext } from "../context/globalInfo";
import { ToastContext } from "../context/toastContext";
import { createMockGlobalInfo } from "../test/mocks";
import { ChatProvider, useChat } from "./ChatContext";
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

    render(
      <MemoryRouter initialEntries={["/home"]}>
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
  });

  it("does not notify for messages already visible on the full chat page", async () => {
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

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <GlobalInfoContext.Provider value={createMockGlobalInfo() as never}>
          <ToastContext.Provider
            value={{
              showToast,
              updateToast: jest.fn(),
              removeToast: jest.fn(),
            }}
          >
            <ChatProvider>
              <div>Full chat</div>
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
      onStreamEvent?.({
        type: "message-updated",
        message: message({
          messageId: "chat_visible",
          clientMessageId: "client_visible",
          createdAt: 2,
        }),
      });
    });

    expect(showToast).not.toHaveBeenCalled();
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
