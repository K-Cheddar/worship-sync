import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobalInfoContext } from "../context/globalInfo";
import { ToastContext } from "../context/toastContext";
import { createMockGlobalInfo } from "../test/mocks";
import { ChatProvider } from "./ChatContext";
import type { ChatMessage, ChatStreamEvent } from "./types";
import {
  getChatContext,
  getChatMessages,
  streamChatEvents,
} from "./api";

jest.mock("./api", () => ({
  editChatMessage: jest.fn(),
  getChatContext: jest.fn(),
  getChatMessages: jest.fn(),
  removeChatMessage: jest.fn(),
  sendChatMessage: jest.fn(),
  streamChatEvents: jest.fn(),
  toggleChatReaction: jest.fn(),
}));

const mockedGetChatContext = jest.mocked(getChatContext);
const mockedGetChatMessages = jest.mocked(getChatMessages);
const mockedStreamChatEvents = jest.mocked(streamChatEvents);

const chatContext = {
  actorId: "user_1",
  actorName: "Alex",
  timeZone: "UTC",
  todayKey: "2026-08-10",
  retentionDays: 365,
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

describe("ChatProvider incoming notifications", () => {
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
            value={{ showToast, removeToast: jest.fn() }}
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
      onStreamEvent?.({ type: "message-updated", message: message() });
      onStreamEvent?.({ type: "stream-ready" });
    });
    expect(showToast).not.toHaveBeenCalled();

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
        duration: 8000,
      }),
    );
  });
});
