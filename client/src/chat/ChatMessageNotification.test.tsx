import { fireEvent, render, screen } from "@testing-library/react";
import ChatMessageNotification from "./ChatMessageNotification";
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
  it("shows the sender and opens team chat from the message", () => {
    const onOpen = jest.fn();
    render(<ChatMessageNotification message={message} onOpen={onOpen} />);

    expect(screen.getByText("Jordan")).toBeInTheDocument();
    expect(
      screen.getByText("Can someone confirm the next slide?"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Open team chat\. New message from Jordan/i,
      }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
