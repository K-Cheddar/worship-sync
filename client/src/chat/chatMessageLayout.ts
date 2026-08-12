import type { ChatMessage } from "./types";

const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

const belongsToSameGroup = (
  first: ChatMessage | undefined,
  second: ChatMessage | undefined,
) =>
  Boolean(
    first &&
      second &&
      first.authorId === second.authorId &&
      Math.abs(second.createdAt - first.createdAt) <= MESSAGE_GROUP_WINDOW_MS,
  );

export const getChatMessageGroupPosition = (
  messages: ChatMessage[],
  index: number,
) => ({
  startsGroup: !belongsToSameGroup(messages[index - 1], messages[index]),
  endsGroup: !belongsToSameGroup(messages[index], messages[index + 1]),
});
