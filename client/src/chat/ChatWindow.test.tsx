import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ChatWindow from "./ChatWindow";
import { useChat } from "./ChatContext";
import type { ChatContextInfo, ChatMessage } from "./types";

jest.mock("./ChatContext", () => ({
  useChat: jest.fn(),
}));

const mockedUseChat = jest.mocked(useChat);

const context: ChatContextInfo = {
  actorId: "actor-1",
  actorName: "You",
  todayKey: "2026-03-11",
  timeZone: "UTC",
  retentionDays: 365,
  imageUploadsEnabled: true,
  reactionEmojis: ["👍", "🙏"],
};

const baseChat = {
  available: true,
  isOpen: true,
  openChat: jest.fn(),
  closeChat: jest.fn(),
  context,
  selectedDayKey: "2026-03-11",
  selectDay: jest.fn(),
  messages: [] as ChatMessage[],
  hasMore: false,
  loadMore: jest.fn(),
  isLoading: false,
  isSending: false,
  imageUploadProgress: null,
  error: "",
  clearError: jest.fn(),
  retry: jest.fn(),
  connectionStatus: "connected" as const,
  unreadCount: 0,
  typingUsers: [],
  updateTypingDraft: jest.fn(),
  sendMessage: jest.fn(),
  editMessage: jest.fn(),
  removeMessage: jest.fn(),
  toggleReaction: jest.fn(),
};

describe("ChatWindow", () => {
  beforeEach(() => {
    mockedUseChat.mockReset();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:selected-photo"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
  });

  it("keeps day navigation in the options menu", async () => {
    mockedUseChat.mockReturnValue(baseChat);

    render(<ChatWindow />);

    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("2026-03-11")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Earlier day" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Chat options" }));
    expect(await screen.findByDisplayValue("2026-03-11")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Earlier day" }),
    ).toBeInTheDocument();
  });

  it("keeps the options menu inside its floating window stacking context", async () => {
    mockedUseChat.mockReturnValue(baseChat);

    render(
      <div role="group" aria-label="Floating chat content">
        <ChatWindow />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Chat options" }));

    const floatingChat = screen.getByRole("group", {
      name: "Floating chat content",
    });
    expect(
      await within(floatingChat).findByDisplayValue("2026-03-11"),
    ).toBeInTheDocument();
  });

  it("offers the full chat page from the floating window menu", async () => {
    const onOpenFullPage = jest.fn();
    mockedUseChat.mockReturnValue(baseChat);

    render(<ChatWindow onOpenFullPage={onOpenFullPage} />);
    fireEvent.click(screen.getByRole("button", { name: "Chat options" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Open full chat" }),
    );

    expect(onOpenFullPage).toHaveBeenCalledTimes(1);
  });

  it("softens unavailable copy when chat is still usable", () => {
    mockedUseChat.mockReturnValue({
      ...baseChat,
      error: "Chat is unavailable. Try again.",
    });

    render(<ChatWindow />);

    expect(
      screen.getByText("Could not finish that request. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Message")).toBeInTheDocument();
  });

  it("shows a composer only for today and keeps history read-only", () => {
    const ownMessage: ChatMessage = {
      messageId: "m1",
      clientMessageId: "client-m1",
      churchId: "church-1",
      dayKey: "2026-03-10",
      authorId: "actor-1",
      authorName: "You",
      authorSessionKind: "human",
      text: "Earlier note",
      createdAt: Date.parse("2026-03-10T12:00:00.000Z"),
      reactions: [],
    };

    mockedUseChat.mockReturnValue({
      ...baseChat,
      selectedDayKey: "2026-03-10",
      messages: [ownMessage],
    });

    render(<ChatWindow />);

    expect(
      screen.getByText("History is read-only."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit message" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to today" })).toBeInTheDocument();
  });

  it("shows a blocking retry state when context failed to load", () => {
    mockedUseChat.mockReturnValue({
      ...baseChat,
      context: null,
      error: "Chat is unavailable. Try again.",
    });

    render(<ChatWindow />);

    expect(
      screen.getByText("Chat is unavailable. Try again."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Message"),
    ).not.toBeInTheDocument();
  });

  it("announces reconnecting without blocking send", () => {
    mockedUseChat.mockReturnValue({
      ...baseChat,
      connectionStatus: "retrying",
    });

    render(<ChatWindow />);

    expect(
      screen.getByLabelText(
        "Reconnecting to live updates. You can still send.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Message")).toBeInTheDocument();
  });

  it("navigates earlier days from the options menu", async () => {
    const selectDay = jest.fn();
    mockedUseChat.mockReturnValue({
      ...baseChat,
      selectDay,
    });

    render(<ChatWindow />);
    fireEvent.click(screen.getByRole("button", { name: "Chat options" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Earlier day" }),
    );
    expect(selectDay).toHaveBeenCalledWith("2026-03-10");
  });

  it("renders own and peer message chrome", () => {
    const messages: ChatMessage[] = [
      {
        messageId: "m1",
        clientMessageId: "client-m1",
        churchId: "church-1",
        dayKey: "2026-03-11",
        authorId: "actor-2",
        authorName: "Alex",
        authorSessionKind: "human",
        text: "Hello team",
        createdAt: Date.parse("2026-03-11T12:00:00.000Z"),
        reactions: [
          {
            emoji: "👍",
            actors: [{ actorId: "actor-2", name: "Alex" }],
          },
        ],
      },
      {
        messageId: "m2",
        clientMessageId: "client-m2",
        churchId: "church-1",
        dayKey: "2026-03-11",
        authorId: "actor-1",
        authorName: "You",
        authorSessionKind: "human",
        text: "Hi",
        createdAt: Date.parse("2026-03-11T12:01:00.000Z"),
        reactions: [],
      },
    ];

    mockedUseChat.mockReturnValue({
      ...baseChat,
      messages,
    });

    render(<ChatWindow />);

    const log = screen.getByRole("log", { name: "Team chat messages" });
    expect(within(log).getByText("Alex")).toBeInTheDocument();
    expect(within(log).getByText("Hello team")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit message" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toBeInTheDocument();
  });

  it("groups consecutive messages from the same teammate", () => {
    mockedUseChat.mockReturnValue({
      ...baseChat,
      messages: [
        {
          messageId: "m1",
          clientMessageId: "client-m1",
          churchId: "church-1",
          dayKey: "2026-03-11",
          authorId: "actor-2",
          authorName: "Alex",
          authorSessionKind: "human",
          text: "First message",
          createdAt: Date.parse("2026-03-11T12:00:00.000Z"),
          reactions: [],
        },
        {
          messageId: "m2",
          clientMessageId: "client-m2",
          churchId: "church-1",
          dayKey: "2026-03-11",
          authorId: "actor-2",
          authorName: "Alex",
          authorSessionKind: "human",
          text: "Second message",
          createdAt: Date.parse("2026-03-11T12:02:00.000Z"),
          reactions: [],
        },
      ],
    });

    render(<ChatWindow />);

    expect(screen.getAllByText("Alex")).toHaveLength(1);
    expect(screen.getByText("First message")).toBeInTheDocument();
    expect(screen.getByText("Second message")).toBeInTheDocument();
  });

  it("shows who is typing and updates presence from the composer", () => {
    const updateTypingDraft = jest.fn();
    mockedUseChat.mockReturnValue({
      ...baseChat,
      typingUsers: [
        { actorId: "actor-2", name: "Alex", expiresAt: Date.now() + 5_000 },
      ],
      updateTypingDraft,
    });

    render(<ChatWindow />);

    expect(
      screen.getByRole("status", { name: "Alex is typing" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Message"), {
      target: { value: "Ready" },
    });
    expect(updateTypingDraft).toHaveBeenCalledWith(true);
    fireEvent.change(screen.getByPlaceholderText("Message"), {
      target: { value: "" },
    });
    expect(updateTypingDraft).toHaveBeenLastCalledWith(false);
  });

  it("sends a selected image without requiring a caption", async () => {
    const sendMessage = jest.fn().mockResolvedValue(true);
    mockedUseChat.mockReturnValue({ ...baseChat, sendMessage });
    const file = new File(["image bytes"], "stage.png", {
      type: "image/png",
      lastModified: 123,
    });

    render(<ChatWindow />);
    fireEvent.change(screen.getByLabelText("Choose a photo"), {
      target: { files: [file] },
    });

    expect(
      await screen.findByAltText("Selected attachment"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith("", file));
    await waitFor(() =>
      expect(
        screen.queryByAltText("Selected attachment"),
      ).not.toBeInTheDocument(),
    );
  });

  it("hides photo controls when private storage is not configured", () => {
    mockedUseChat.mockReturnValue({
      ...baseChat,
      context: { ...context, imageUploadsEnabled: false },
    });
    render(<ChatWindow />);
    expect(
      screen.queryByRole("button", { name: "Add a photo" }),
    ).not.toBeInTheDocument();
  });
});
