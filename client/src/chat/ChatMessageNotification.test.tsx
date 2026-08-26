import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatMessageNotification from "./ChatMessageNotification";
import ChatReactionNotification from "./ChatReactionNotification";
import type { ChatMessage } from "./types";

const message: ChatMessage = {
  messageId: "chat_1",
  clientMessageId: "client_1",
  churchId: "church_1",
  dayKey: "2026-08-10",
  text: "Can someone confirm the next slide?",
  authorId: "user_2",
  authorName: "Jordan",
  authorSessionKind: "human",
  createdAt: Date.now(),
  reactions: [],
};

describe("ChatMessageNotification", () => {
  it("shows the sender and opens team chat", () => {
    const onOpen = jest.fn();
    const onReply = jest.fn();
    render(
      <ChatMessageNotification
        message={message}
        onOpen={onOpen}
        onReply={onReply}
      />,
    );

    expect(screen.getByText("Jordan")).toBeInTheDocument();
    expect(
      screen.getByText("Can someone confirm the next slide?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("starts reply mode and stops the toast timer", async () => {
    const user = userEvent.setup();
    const onReplyStart = jest.fn();
    render(
      <ChatMessageNotification
        message={message}
        onOpen={jest.fn()}
        onReply={jest.fn()}
        onReplyStart={onReplyStart}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reply" }));
    expect(onReplyStart).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("textbox", { name: /Reply to Jordan/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("lets operators reply inline from the popup", async () => {
    const user = userEvent.setup();
    const onOpen = jest.fn();
    const onReply = jest.fn().mockResolvedValue(true);
    render(
      <ChatMessageNotification
        message={message}
        onOpen={onOpen}
        onReply={onReply}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reply" }));
    const replyField = screen.getByRole("textbox", { name: /Reply to Jordan/i });
    await user.type(replyField, "On it");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(onReply).toHaveBeenCalledWith("On it"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps open chat available while composing a reply", async () => {
    const user = userEvent.setup();
    const onOpen = jest.fn();
    render(
      <ChatMessageNotification
        message={message}
        onOpen={onOpen}
        onReply={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reply" }));
    await user.click(screen.getByRole("button", { name: "Open chat" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows an error when the inline reply fails", async () => {
    const user = userEvent.setup();
    render(
      <ChatMessageNotification
        message={message}
        onOpen={jest.fn()}
        onReply={jest.fn().mockResolvedValue(false)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reply" }));
    await user.type(
      screen.getByRole("textbox", { name: /Reply to Jordan/i }),
      "Still here",
    );
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    expect(
      await screen.findByText("Could not send your reply. Try again."),
    ).toBeInTheDocument();
  });

  it("announces a photo without displaying it in the toast", () => {
    render(
      <ChatMessageNotification
        message={{
          ...message,
          text: "",
          attachment: {
            type: "image",
            id: "image-1",
            contentType: "image/webp",
            sizeBytes: 1200,
            thumbnailSizeBytes: 300,
            width: 1200,
            height: 800,
            thumbnailWidth: 480,
            thumbnailHeight: 320,
          },
        }}
        onOpen={jest.fn()}
        onReply={jest.fn()}
      />,
    );

    expect(screen.getByText("Sent a photo")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("ChatReactionNotification", () => {
  it("summarizes one or more reactions and opens team chat", () => {
    const onOpen = jest.fn();
    render(
      <ChatReactionNotification
        notices={[
          { actorId: "user_3", name: "Taylor", emoji: "👍" },
          { actorId: "user_4", name: "Morgan", emoji: "🙏" },
        ]}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText(/Taylor and 1 others reacted/)).toBeInTheDocument();
    expect(screen.getByText(/👍 🙏/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
