export type ChatReactionActor = {
  actorId: string;
  name: string;
};

export type ChatReaction = {
  emoji: string;
  actors: ChatReactionActor[];
};

export type ChatMessage = {
  messageId: string;
  clientMessageId: string;
  churchId: string;
  dayKey: string;
  text: string;
  authorId: string;
  authorName: string;
  authorSessionKind: "human" | "workstation";
  createdAt: number;
  editedAt?: number;
  deletedAt?: number;
  reactions: ChatReaction[];
};

export type ChatContextInfo = {
  actorId: string;
  actorName: string;
  timeZone: string;
  todayKey: string;
  retentionDays: number;
  reactionEmojis: string[];
};

export type ChatStreamEvent =
  | { type: "connected"; churchId: string; dayKey: string }
  | { type: "stream-ready" }
  | { type: "message-updated"; message: ChatMessage }
  | { type: "stream-error"; message: string }
  | { type: string; [key: string]: unknown };
