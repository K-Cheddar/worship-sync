import { getChatMessageGroupPosition } from "./chatMessageLayout";
import type { ChatMessage } from "./types";

const message = (
  messageId: string,
  authorId: string,
  createdAt: number,
): ChatMessage => ({
  messageId,
  clientMessageId: `client-${messageId}`,
  churchId: "church-1",
  dayKey: "2026-08-11",
  text: messageId,
  authorId,
  authorName: authorId,
  authorSessionKind: "human",
  createdAt,
  reactions: [],
});

describe("getChatMessageGroupPosition", () => {
  it("groups consecutive messages from the same author within five minutes", () => {
    const messages = [
      message("one", "alex", 1_000),
      message("two", "alex", 60_000),
      message("three", "jordan", 70_000),
    ];

    expect(getChatMessageGroupPosition(messages, 0)).toEqual({
      startsGroup: true,
      endsGroup: false,
    });
    expect(getChatMessageGroupPosition(messages, 1)).toEqual({
      startsGroup: false,
      endsGroup: true,
    });
    expect(getChatMessageGroupPosition(messages, 2)).toEqual({
      startsGroup: true,
      endsGroup: true,
    });
  });

  it("starts a new group after a longer pause", () => {
    const messages = [
      message("one", "alex", 1_000),
      message("two", "alex", 301_001),
    ];

    expect(getChatMessageGroupPosition(messages, 1).startsGroup).toBe(true);
  });
});
