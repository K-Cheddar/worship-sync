import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobalInfoContext } from "../context/globalInfo";
import { ToastContext } from "../context/toastContext";
import { createMockGlobalInfo } from "../test/mocks";
import { ChatProvider, useChat } from "./ChatContext";
import type { ChatContextInfo, ChatMessage, ChatStreamEvent } from "./types";
import { getChatContext, getChatMessages, streamChatEvents } from "./api";

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
const mockedStreamChatEvents = jest.mocked(streamChatEvents);

const contextFor = (todayKey: string, timeZone = "UTC"): ChatContextInfo => ({
  actorId: "user_1",
  actorName: "Alex",
  timeZone,
  todayKey,
  retentionDays: 365,
  imageUploadsEnabled: true,
  reactionEmojis: ["👍"],
});

const messageFor = (dayKey: string): ChatMessage => ({
  messageId: `chat-${dayKey}`,
  clientMessageId: `client-${dayKey}`,
  churchId: "church-1",
  dayKey,
  text: `Message for ${dayKey}`,
  authorId: "user_2",
  authorName: "Jordan",
  authorSessionKind: "human",
  createdAt: 1,
  reactions: [],
});

const ChatHarness = () => {
  const chat = useChat();
  return (
    <>
      <button type="button" onClick={chat?.openChat}>Open chat</button>
      <button type="button" onClick={() => void chat?.refreshContext()}>
        Refresh context
      </button>
      <button
        type="button"
        onClick={() => void chat?.selectDay("2026-08-03")}
      >
        Previous week
      </button>
      <div>week: {chat?.selectedDayKey}</div>
      <div>time zone: {chat?.context?.timeZone}</div>
      <div>{chat?.messages.map((message) => message.text).join(", ")}</div>
    </>
  );
};

const renderChat = () =>
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
            <ChatHarness />
          </ChatProvider>
        </ToastContext.Provider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
};

describe("ChatProvider weekly rollover", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    mockedStreamChatEvents.mockImplementation(({ signal, onEvent, dayKey }) => {
      onEvent({
        type: "initial-messages",
        dayKey,
        messages: [messageFor(dayKey)],
        hasMore: false,
      });
      return new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    });
  });

  it("switches to the current week and stream when the tab becomes visible", async () => {
    const previousWeek = contextFor("2026-08-03");
    const currentWeek = contextFor("2026-08-10");
    mockedGetChatContext
      .mockResolvedValueOnce({ context: previousWeek })
      .mockResolvedValue({ context: currentWeek });

    renderChat();

    expect(await screen.findByText(`week: ${previousWeek.todayKey}`)).toBeInTheDocument();
    await waitFor(() => expect(mockedStreamChatEvents).toHaveBeenCalledTimes(1));

    setVisibility("hidden");
    setVisibility("visible");

    expect(await screen.findByText(`week: ${currentWeek.todayKey}`)).toBeInTheDocument();
    expect(
      await screen.findByText(`Message for ${currentWeek.todayKey}`),
    ).toBeInTheDocument();
    expect(mockedStreamChatEvents).toHaveBeenCalledTimes(2);
    expect(mockedStreamChatEvents.mock.calls[1][0].dayKey).toBe(
      currentWeek.todayKey,
    );
    expect(mockedGetChatContext).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(
      await screen.findByText(`Message for ${previousWeek.todayKey}`),
    ).toBeInTheDocument();
  });

  it("does not reconnect when visibility refresh confirms the same week", async () => {
    const thisWeek = contextFor("2026-08-10");
    mockedGetChatContext.mockResolvedValue({ context: thisWeek });

    renderChat();

    expect(await screen.findByText(`week: ${thisWeek.todayKey}`)).toBeInTheDocument();
    await waitFor(() => expect(mockedStreamChatEvents).toHaveBeenCalledTimes(1));

    setVisibility("hidden");
    setVisibility("visible");

    await waitFor(() => expect(mockedGetChatContext).toHaveBeenCalledTimes(2));
    expect(mockedStreamChatEvents).toHaveBeenCalledTimes(1);
  });

  it("refreshes the context and chat stream when the church time zone changes within the same week", async () => {
    const previousContext = contextFor("2026-08-09", "UTC");
    const updatedContext = contextFor("2026-08-09", "America/New_York");
    mockedGetChatContext
      .mockResolvedValueOnce({ context: previousContext })
      .mockResolvedValueOnce({ context: updatedContext });

    renderChat();
    expect(await screen.findByText("time zone: UTC")).toBeInTheDocument();
    await waitFor(() => expect(mockedStreamChatEvents).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Refresh context" }));

    expect(await screen.findByText("time zone: America/New_York")).toBeInTheDocument();
    await waitFor(() => expect(mockedStreamChatEvents).toHaveBeenCalledTimes(2));
  });

  it("shows the current week when chat opens after rollover", async () => {
    const previousWeek = contextFor("2026-08-03");
    const currentWeek = contextFor("2026-08-10");
    mockedGetChatContext
      .mockResolvedValueOnce({ context: previousWeek })
      .mockResolvedValue({ context: currentWeek });

    renderChat();

    expect(await screen.findByText(`week: ${previousWeek.todayKey}`)).toBeInTheDocument();
    await waitFor(() => expect(mockedStreamChatEvents).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));

    expect(await screen.findByText(`week: ${currentWeek.todayKey}`)).toBeInTheDocument();
    expect(
      await screen.findByText(`Message for ${currentWeek.todayKey}`),
    ).toBeInTheDocument();
    expect(mockedStreamChatEvents).toHaveBeenCalledTimes(2);
    expect(mockedStreamChatEvents.mock.calls[1][0].dayKey).toBe(
      currentWeek.todayKey,
    );
  });

  it("uses the five-second fallback after rollover despite stale previous-week work", async () => {
    const previousWeek = contextFor("2026-08-03");
    const currentWeek = contextFor("2026-08-10");
    mockedGetChatContext
      .mockResolvedValueOnce({ context: previousWeek })
      .mockResolvedValue({ context: currentWeek });

    let previousWeekOnEvent: ((event: ChatStreamEvent) => void) | undefined;
    mockedStreamChatEvents.mockImplementation(
      ({ signal, onEvent, dayKey }) => {
        if (dayKey === previousWeek.todayKey) {
          previousWeekOnEvent = onEvent;
        }
        return new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );

    let resolvePreviousFallback!: (response: {
      context: ChatContextInfo;
      dayKey: string;
      messages: ChatMessage[];
      hasMore: boolean;
    }) => void;
    mockedGetChatMessages
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePreviousFallback = resolve;
          }),
      )
      .mockResolvedValueOnce({
        context: currentWeek,
        dayKey: currentWeek.todayKey,
        messages: [messageFor(currentWeek.todayKey)],
        hasMore: false,
      });

    renderChat();

    expect(await screen.findByText(`week: ${previousWeek.todayKey}`)).toBeInTheDocument();
    await waitFor(() => expect(mockedStreamChatEvents).toHaveBeenCalledTimes(1));

    act(() => {
      previousWeekOnEvent?.({ type: "stream-error", message: "retry" });
      previousWeekOnEvent?.({
        type: "initial-messages",
        dayKey: previousWeek.todayKey,
        messages: [messageFor(previousWeek.todayKey)],
        hasMore: false,
      });
    });
    await waitFor(() => expect(mockedGetChatMessages).toHaveBeenCalledTimes(1));

    setVisibility("hidden");
    setVisibility("visible");
    expect(await screen.findByText(`week: ${currentWeek.todayKey}`)).toBeInTheDocument();
    await waitFor(() => expect(mockedStreamChatEvents).toHaveBeenCalledTimes(2));

    act(() =>
      previousWeekOnEvent?.({
        type: "initial-messages",
        dayKey: previousWeek.todayKey,
        messages: [messageFor(previousWeek.todayKey)],
        hasMore: false,
      }),
    );

    await waitFor(() => expect(mockedGetChatMessages).toHaveBeenCalledTimes(2), {
      timeout: 6_000,
    });
    expect(
      await screen.findByText(`Message for ${currentWeek.todayKey}`),
    ).toBeInTheDocument();

    resolvePreviousFallback({
      context: previousWeek,
      dayKey: previousWeek.todayKey,
      messages: [messageFor(previousWeek.todayKey)],
      hasMore: false,
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(`week: ${currentWeek.todayKey}`)).toBeInTheDocument();
    expect(
      screen.getByText(`Message for ${currentWeek.todayKey}`),
    ).toBeInTheDocument();
  }, 10_000);
});
