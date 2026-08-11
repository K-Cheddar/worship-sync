import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RestreamMessage, RestreamSession } from "../../types";
import CurrentServiceRestreamPanel from "./CurrentServiceRestreamPanel";

const mockUseRestreamSession = jest.fn();

jest.mock("../../boards/useRestreamSession", () => ({
  useRestreamSession: (...args: unknown[]) => mockUseRestreamSession(...args),
}));

jest.mock("../../boards/BoardYouTubeChatComposer", () => ({
  BoardYouTubeChatComposer: ({
    accountLabel,
  }: {
    accountLabel?: string;
  }) => <button type="button">Post to YouTube {accountLabel}</button>,
}));

const session: RestreamSession = {
  churchId: "church-1",
  database: "database-1",
  sessionId: "session-1",
  startedAt: 1_800_000_000_000,
  lastEventAt: 1_800_000_000_200,
  lastMessageAt: 1_800_000_000_200,
  messageCount: 2,
  enabled: true,
  connected: true,
  connectionState: "connected",
  accountLabel: "Sunday Restream",
  streamTitle: "Sunday Live",
  lastError: "",
  connectionIssues: [],
  activeConnectionCount: 1,
  totalConnectionCount: 1,
  platformSummary: ["YouTube"],
};

const makeMessage = (
  id: string,
  text: string,
  postedAt: number,
): RestreamMessage => ({
  id,
  churchId: "church-1",
  database: "database-1",
  sessionId: "session-1",
  platform: "YouTube",
  connectionIdentifier: "youtube-1",
  author: `Author ${id}`,
  text,
  postedAt,
  receivedAt: postedAt,
  rawEventType: "message",
  kind: "viewer_message",
  isHighlighted: false,
  hidden: false,
});

const buildRestreamState = (overrides: Record<string, unknown> = {}) => ({
  session,
  messages: [],
  isLoading: false,
  error: "",
  bestEffortOnly: false,
  oauthConfigured: true,
  isOffline: false,
  feedState: "empty",
  reload: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe("CurrentServiceRestreamPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    mockUseRestreamSession.mockReturnValue(buildRestreamState());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows Restream info, chronological chat, and the YouTube composer", () => {
    mockUseRestreamSession.mockReturnValue(
      buildRestreamState({
        messages: [
          makeMessage("newer", "Second message", 1_800_000_000_200),
          makeMessage("older", "First message", 1_800_000_000_100),
        ],
        feedState: "has_messages",
      }),
    );

    render(
      <CurrentServiceRestreamPanel
        churchId="church-1"
        youtubeConnected
        youtubeAccountLabel="Church Live"
        showToast={jest.fn()}
      />,
    );

    expect(screen.getByText("Sunday Live")).toBeInTheDocument();
    expect(screen.getByText("Sunday Restream")).toBeInTheDocument();
    expect(screen.getByText("Sources: YouTube")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();

    const messages = screen.getAllByRole("article");
    expect(within(messages[0]).getByText("First message")).toBeInTheDocument();
    expect(within(messages[1]).getByText("Second message")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Post to YouTube Church Live" }),
    ).toBeInTheDocument();
  });

  it("offers a retry when Restream cannot load", async () => {
    const user = userEvent.setup();
    const reload = jest.fn().mockResolvedValue(undefined);
    mockUseRestreamSession.mockReturnValue(
      buildRestreamState({
        session: null,
        error: "Could not load the Restream session.",
        reload,
      }),
    );

    render(
      <CurrentServiceRestreamPanel
        churchId="church-1"
        youtubeConnected={false}
        showToast={jest.fn()}
      />,
    );

    expect(
      screen.getByText("Could not load the Restream session."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("explains how to connect Restream without showing an empty-chat message", () => {
    mockUseRestreamSession.mockReturnValue(
      buildRestreamState({
        session: { ...session, enabled: false, connected: false },
      }),
    );

    render(
      <CurrentServiceRestreamPanel
        churchId="church-1"
        youtubeConnected={false}
        showToast={jest.fn()}
      />,
    );

    expect(screen.getByText("Restream is not connected.")).toBeInTheDocument();
    expect(
      screen.getByText(/Ask a church admin to connect Restream/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No Restream messages yet."),
    ).not.toBeInTheDocument();
  });

  it("counts messages received while hidden and marks them read while visible", async () => {
    const onUnreadCountChange = jest.fn();
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
    const initialMessages = [
      makeMessage("one", "First message", 1_800_000_000_100),
      makeMessage("two", "Second message", 1_800_000_000_200),
    ];
    mockUseRestreamSession.mockReturnValue(
      buildRestreamState({
        messages: initialMessages,
        feedState: "has_messages",
      }),
    );

    const { rerender } = render(
      <CurrentServiceRestreamPanel
        churchId="church-1"
        youtubeConnected={false}
        isVisible={false}
        onUnreadCountChange={onUnreadCountChange}
        showToast={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(onUnreadCountChange).toHaveBeenLastCalledWith(2);
    });
    expect(setItemSpy).not.toHaveBeenCalled();

    rerender(
      <CurrentServiceRestreamPanel
        churchId="church-1"
        youtubeConnected={false}
        isVisible
        onUnreadCountChange={onUnreadCountChange}
        showToast={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(onUnreadCountChange).toHaveBeenLastCalledWith(0);
    });
    expect(setItemSpy).not.toHaveBeenCalled();

    mockUseRestreamSession.mockReturnValue(
      buildRestreamState({
        messages: [
          ...initialMessages,
          makeMessage("three", "Third message", 1_800_000_000_300),
        ],
        feedState: "has_messages",
      }),
    );
    rerender(
      <CurrentServiceRestreamPanel
        churchId="church-1"
        youtubeConnected={false}
        isVisible
        onUnreadCountChange={onUnreadCountChange}
        showToast={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(onUnreadCountChange).toHaveBeenLastCalledWith(0);
    });
    expect(setItemSpy).not.toHaveBeenCalled();

    rerender(
      <CurrentServiceRestreamPanel
        churchId="church-1"
        youtubeConnected={false}
        isVisible={false}
        onUnreadCountChange={onUnreadCountChange}
        showToast={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(onUnreadCountChange).toHaveBeenLastCalledWith(0);
    });
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    mockUseRestreamSession.mockReturnValue(
      buildRestreamState({
        messages: [
          ...initialMessages,
          makeMessage("three", "Third message", 1_800_000_000_300),
          makeMessage("four", "Fourth message", 1_800_000_000_400),
        ],
        feedState: "has_messages",
      }),
    );
    rerender(
      <CurrentServiceRestreamPanel
        churchId="church-1"
        youtubeConnected={false}
        isVisible={false}
        onUnreadCountChange={onUnreadCountChange}
        showToast={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(onUnreadCountChange).toHaveBeenLastCalledWith(1);
    });
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the read marker across remounts and resets it for a new session", async () => {
    const readMessages = [
      makeMessage("one", "First message", 1_800_000_000_100),
      makeMessage("two", "Second message", 1_800_000_000_200),
    ];
    mockUseRestreamSession.mockReturnValue(
      buildRestreamState({ messages: readMessages, feedState: "has_messages" }),
    );

    const { unmount: unmountInitialPanel } = render(
      <CurrentServiceRestreamPanel
        churchId="church-1"
        youtubeConnected={false}
        isVisible
        onUnreadCountChange={jest.fn()}
        showToast={jest.fn()}
      />,
    );
    unmountInitialPanel();
    await waitFor(() => {
      expect(window.sessionStorage.length).toBe(1);
    });
    const storedMarker = JSON.parse(
      window.sessionStorage.getItem(
        "worshipsync:current-service-chat-read:v1:church-1",
      ) ?? "{}",
    ) as Record<string, unknown>;
    expect(storedMarker).toEqual({
      churchId: "church-1",
      sessionId: "session-1",
      receivedAt: 1_800_000_000_200,
      messageId: "two",
    });
    expect(storedMarker).not.toHaveProperty("messageIds");

    const persistedUnread = jest.fn();
    mockUseRestreamSession.mockReturnValue(
      buildRestreamState({
        messages: [
          ...readMessages,
          makeMessage("three", "Third message", 1_800_000_000_300),
        ],
        feedState: "has_messages",
      }),
    );
    const { unmount: unmountPersistedPanel } = render(
      <CurrentServiceRestreamPanel
        churchId="church-1"
        youtubeConnected={false}
        isVisible={false}
        onUnreadCountChange={persistedUnread}
        showToast={jest.fn()}
      />,
    );
    await waitFor(() => {
      expect(persistedUnread).toHaveBeenLastCalledWith(1);
    });
    unmountPersistedPanel();

    const nextSessionUnread = jest.fn();
    mockUseRestreamSession.mockReturnValue(
      buildRestreamState({
        session: { ...session, sessionId: "session-2" },
        messages: [
          {
            ...makeMessage("next-session", "New session", 1_800_000_001_000),
            sessionId: "session-2",
          },
        ],
        feedState: "has_messages",
      }),
    );
    render(
      <CurrentServiceRestreamPanel
        churchId="church-1"
        youtubeConnected={false}
        isVisible={false}
        onUnreadCountChange={nextSessionUnread}
        showToast={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(nextSessionUnread).toHaveBeenLastCalledWith(1);
    });
  });
});
