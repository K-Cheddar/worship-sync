export type ChatReactionActor = {
  actorId: string;
  name: string;
};

export type ChatReaction = {
  emoji: string;
  actors: ChatReactionActor[];
};

export type ChatImageAttachment = {
  type: "image";
  id: string;
  contentType: "image/webp";
  sizeBytes: number;
  thumbnailSizeBytes: number;
  width: number;
  height: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
};

export type ChatImageUpload = {
  id: string;
  fileName: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
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
  attachment?: ChatImageAttachment;
  reactions: ChatReaction[];
};

export type ChatContextInfo = {
  actorId: string;
  actorName: string;
  timeZone: string;
  todayKey: string;
  retentionDays: number;
  imageUploadsEnabled: boolean;
  reactionEmojis: string[];
};

export type ChatTyper = {
  actorId: string;
  name: string;
  expiresAt: number;
};

export type ChatStreamEvent =
  | { type: "connected"; churchId: string; dayKey: string }
  | {
    type: "initial-messages";
    dayKey: string;
    messages: ChatMessage[];
    hasMore: boolean;
  }
  | { type: "stream-ready" }
  | { type: "message-updated"; message: ChatMessage }
  | { type: "typing-updated"; typers: ChatTyper[] }
  | { type: "stream-error"; message: string }
  | { type: string; [key: string]: unknown };
