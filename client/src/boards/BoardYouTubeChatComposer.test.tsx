import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BoardYouTubeChatComposer,
  YOUTUBE_LIVE_CHAT_MAX_LENGTH,
} from "./BoardYouTubeChatComposer";

const mockSendYouTubeLiveChatMessage = jest.fn();

jest.mock("./api", () => ({
  sendYouTubeLiveChatMessage: (...args: unknown[]) =>
    mockSendYouTubeLiveChatMessage(...args),
}));

describe("BoardYouTubeChatComposer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const expandComposer = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      screen.getByRole("button", { name: /Post to YouTube live chat/i }),
    );
  };

  it("shows an inline error for oversized messages", async () => {
    const user = userEvent.setup();
    render(<BoardYouTubeChatComposer churchId="church-1" />);

    await expandComposer(user);
    const messageField = screen.getByLabelText(/YouTube live chat message/i);
    fireEvent.change(messageField, {
      target: { value: "x".repeat(YOUTUBE_LIVE_CHAT_MAX_LENGTH + 1) },
    });
    await user.click(screen.getByRole("button", { name: /Send to YouTube/i }));

    expect(mockSendYouTubeLiveChatMessage).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent(
      `Message is too long (max ${YOUTUBE_LIVE_CHAT_MAX_LENGTH} characters).`,
    );
  });

  it("keeps chat text on a single line when newlines are entered", async () => {
    const user = userEvent.setup();
    render(<BoardYouTubeChatComposer churchId="church-1" />);

    await expandComposer(user);
    const messageField = screen.getByLabelText(/YouTube live chat message/i);
    fireEvent.change(messageField, {
      target: { value: "Hello\nstream" },
    });

    expect(messageField).toHaveValue("Hello stream");
  });

  it("shows loading then a success flash without closing", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    let resolveSend: ((value: unknown) => void) | undefined;
    mockSendYouTubeLiveChatMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );

    render(
      <BoardYouTubeChatComposer
        churchId="church-1"
        accountLabel="Church Live"
      />,
    );

    await expandComposer(user);
    await user.type(
      screen.getByLabelText(/YouTube live chat message/i),
      "Welcome everyone",
    );
    await user.click(screen.getByRole("button", { name: /Send to YouTube/i }));

    expect(screen.getAllByText("Sending…").length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/YouTube live chat message/i)).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Sending…/i }),
    ).toBeDisabled();

    await act(async () => {
      resolveSend?.({
        success: true,
        messageId: "msg-1",
        liveChatId: "chat-1",
        videoId: "dQw4w9WgXcQ",
        broadcastTitle: "Sunday Live",
        accountLabel: "Church Live",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Sent to YouTube live chat")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /Send to YouTube/i }),
    ).not.toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    expect(
      screen.getByLabelText(/YouTube live chat message/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/YouTube live chat message/i)).toHaveValue("");
  });

  it("sends on Enter because YouTube chat is single-line", async () => {
    const user = userEvent.setup();
    mockSendYouTubeLiveChatMessage.mockResolvedValue({
      success: true,
      messageId: "msg-2",
      liveChatId: "chat-1",
      videoId: "dQw4w9WgXcQ",
      broadcastTitle: "Sunday Live",
      accountLabel: "Church Live",
    });

    render(<BoardYouTubeChatComposer churchId="church-1" />);

    await expandComposer(user);
    const messageField = screen.getByLabelText(/YouTube live chat message/i);
    await user.type(messageField, "Hello live{Enter}");

    await waitFor(() => {
      expect(mockSendYouTubeLiveChatMessage).toHaveBeenCalledWith("church-1", {
        messageText: "Hello live",
      });
    });
    expect(screen.getByText("Sent to YouTube live chat")).toBeInTheDocument();
  });

  it("shows an inline error when sending fails", async () => {
    const user = userEvent.setup();
    mockSendYouTubeLiveChatMessage.mockRejectedValue(
      new Error("YouTube is not connected for this church."),
    );

    render(<BoardYouTubeChatComposer churchId="church-1" />);

    await expandComposer(user);
    await user.type(
      screen.getByLabelText(/YouTube live chat message/i),
      "Hello",
    );
    await user.click(screen.getByRole("button", { name: /Send to YouTube/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "YouTube is not connected for this church.",
      );
    });
    expect(screen.getByLabelText(/YouTube live chat message/i)).toHaveValue(
      "Hello",
    );
  });

  it("retries with a pasted live video URL when auto-detect fails", async () => {
    const user = userEvent.setup();
    mockSendYouTubeLiveChatMessage
      .mockRejectedValueOnce(
        new Error(
          "No active YouTube live chat was found for the connected channel. Start the stream, or paste the live video URL.",
        ),
      )
      .mockResolvedValueOnce({
        success: true,
        messageId: "msg-3",
        liveChatId: "chat-1",
        videoId: "dQw4w9WgXcQ",
        broadcastTitle: "Sunday Live",
        accountLabel: "Church Live",
      });

    render(<BoardYouTubeChatComposer churchId="church-1" />);

    await expandComposer(user);
    await user.type(
      screen.getByLabelText(/YouTube live chat message/i),
      "Hello live",
    );
    await user.click(screen.getByRole("button", { name: /Send to YouTube/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /paste the live video URL/i,
    );

    const liveVideoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    await user.type(
      screen.getByLabelText(/Live video URL \(optional\)/i),
      liveVideoUrl,
    );
    await user.click(screen.getByRole("button", { name: /Send to YouTube/i }));

    await waitFor(() => {
      expect(mockSendYouTubeLiveChatMessage).toHaveBeenNthCalledWith(
        2,
        "church-1",
        {
          messageText: "Hello live",
          videoUrl: liveVideoUrl,
        },
      );
    });
    expect(screen.getByText("Sent to YouTube live chat")).toBeInTheDocument();
  });
});
