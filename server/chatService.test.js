import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_MESSAGE_MAX_LENGTH,
  chatDayKey,
  createChatService,
} from "./chatService.js";

const humanSession = {
  actorId: "user_1",
  userId: "user_1",
  username: "Ada",
  sessionKind: "human",
  role: "member",
};

const createService = () => {
  let current = new Date("2026-08-09T16:00:00.000Z");
  return {
    service: createChatService({ now: () => new Date(current) }),
    setNow(value) {
      current = new Date(value);
    },
  };
};

test("chat day keys are the Sunday starting the church-local week", () => {
  // 2026-08-09T02:30Z is Sunday in UTC but still Saturday the 8th in
  // America/New_York, which falls in the prior week.
  const instant = new Date("2026-08-09T02:30:00.000Z");
  assert.equal(chatDayKey(instant, "UTC"), "2026-08-09");
  assert.equal(chatDayKey(instant, "America/New_York"), "2026-08-02");
});

test("caches the church timezone before typing heartbeats", async () => {
  let reads = 0;
  let writes = 0;
  const service = createChatService({
    now: () => new Date("2026-08-09T16:00:00.000Z"),
    getFirestore: () => ({
      collection: () => ({
        doc: () => ({
          get: async () => {
            reads += 1;
            return { exists: false };
          },
          set: async () => {
            writes += 1;
          },
        }),
      }),
    }),
  });

  await service.getContext({
    churchId: "church_1",
    session: humanSession,
    timeZoneHint: "America/New_York",
  });
  await service.updateTyping({
    churchId: "church_1",
    session: humanSession,
    isTyping: true,
    timeZoneHint: "America/New_York",
  });
  await service.updateTyping({
    churchId: "church_1",
    session: humanSession,
    isTyping: false,
    timeZoneHint: "America/New_York",
  });

  assert.equal(reads, 1);
  assert.equal(writes, 1);
});

test("creates, lists, and idempotently retries a daily message", async () => {
  const { service } = createService();
  const payload = {
    churchId: "church_1",
    session: humanSession,
    text: "  Sound check is ready.  ",
    clientMessageId: "client-message-0001",
    timeZoneHint: "America/New_York",
  };

  const first = await service.createMessage(payload);
  const retry = await service.createMessage(payload);
  const result = await service.listMessages({
    churchId: "church_1",
    session: humanSession,
    dayKey: "2026-08-09",
    timeZoneHint: "UTC",
  });

  assert.equal(retry.messageId, first.messageId);
  assert.equal(first.text, "Sound check is ready.");
  assert.equal(first.authorId, "user_1");
  assert.equal(first.authorName, "Ada");
  assert.equal(result.context.timeZone, "America/New_York");
  assert.deepEqual(
    result.messages.map((message) => message.messageId),
    [first.messageId],
  );
});

test("validates message content and retained history range", async () => {
  const { service } = createService();
  await assert.rejects(
    service.createMessage({
      churchId: "church_1",
      session: humanSession,
      text: " ",
      clientMessageId: "client-message-empty",
      timeZoneHint: "UTC",
    }),
    /write a message/i,
  );
  await assert.rejects(
    service.createMessage({
      churchId: "church_1",
      session: humanSession,
      text: "x".repeat(CHAT_MESSAGE_MAX_LENGTH + 1),
      clientMessageId: "client-message-long",
      timeZoneHint: "UTC",
    }),
    /under 1,000 characters/i,
  );
  await assert.rejects(
    service.listMessages({
      churchId: "church_1",
      session: humanSession,
      dayKey: "2024-01-01",
      timeZoneHint: "UTC",
    }),
    /no longer available/i,
  );
});

test("toggles reactions without losing other actors", async () => {
  const { service } = createService();
  const message = await service.createMessage({
    churchId: "church_1",
    session: humanSession,
    text: "Ready when you are.",
    clientMessageId: "client-message-react",
    timeZoneHint: "UTC",
  });
  const secondSession = {
    ...humanSession,
    actorId: "user_2",
    userId: "user_2",
    username: "Morgan",
  };

  await service.toggleReaction({
    churchId: "church_1",
    session: humanSession,
    messageId: message.messageId,
    emoji: "👍",
  });
  const both = await service.toggleReaction({
    churchId: "church_1",
    session: secondSession,
    messageId: message.messageId,
    emoji: "👍",
  });
  const one = await service.toggleReaction({
    churchId: "church_1",
    session: humanSession,
    messageId: message.messageId,
    emoji: "👍",
  });

  assert.deepEqual(
    both.reactions[0].actors.map((actor) => actor.actorId),
    ["user_1", "user_2"],
  );
  assert.deepEqual(
    one.reactions[0].actors.map((actor) => actor.actorId),
    ["user_2"],
  );
});

test("allows authors to edit and admins to remove messages", async () => {
  const { service } = createService();
  const message = await service.createMessage({
    churchId: "church_1",
    session: humanSession,
    text: "First draft",
    clientMessageId: "client-message-edit",
    timeZoneHint: "UTC",
  });
  const edited = await service.updateMessage({
    churchId: "church_1",
    session: humanSession,
    messageId: message.messageId,
    text: "Final draft",
  });
  assert.equal(edited.text, "Final draft");
  assert.ok(edited.editedAt);

  const admin = {
    ...humanSession,
    actorId: "admin_1",
    userId: "admin_1",
    username: "Admin",
    role: "admin",
  };
  const removed = await service.deleteMessage({
    churchId: "church_1",
    session: admin,
    messageId: message.messageId,
  });
  assert.equal(removed.text, "");
  assert.ok(removed.deletedAt);
});

test("does not allow another member or church to mutate a message", async () => {
  const { service } = createService();
  const message = await service.createMessage({
    churchId: "church_1",
    session: humanSession,
    text: "Keep this",
    clientMessageId: "client-message-owned",
    timeZoneHint: "UTC",
  });
  const stranger = {
    ...humanSession,
    actorId: "user_2",
    userId: "user_2",
  };
  await assert.rejects(
    service.updateMessage({
      churchId: "church_1",
      session: stranger,
      messageId: message.messageId,
      text: "Changed",
    }),
    /only edit your own/i,
  );
  await assert.rejects(
    service.toggleReaction({
      churchId: "church_2",
      session: stranger,
      messageId: message.messageId,
      emoji: "👍",
    }),
    /not available/i,
  );
});

test("publishes memory-store changes to daily subscribers", async () => {
  const { service } = createService();
  const events = [];
  const unsubscribe = service.subscribe({
    churchId: "church_1",
    dayKey: "2026-08-09",
    onEvent: (event) => events.push(event),
  });
  await service.createMessage({
    churchId: "church_1",
    session: humanSession,
    text: "Live update",
    clientMessageId: "client-message-live",
    timeZoneHint: "UTC",
  });
  unsubscribe();
  assert.equal(events.length, 3);
  assert.equal(events[0].type, "initial-messages");
  assert.deepEqual(events[0].messages, []);
  assert.equal(events[1].type, "stream-ready");
  assert.equal(events[2].type, "message-updated");
  assert.equal(events[2].message.text, "Live update");
});

test("batches existing messages when a daily subscriber connects", async () => {
  const { service } = createService();
  await service.createMessage({
    churchId: "church_1",
    session: humanSession,
    text: "Already here",
    clientMessageId: "client-message-existing",
    timeZoneHint: "UTC",
  });
  const events = [];
  const unsubscribe = service.subscribe({
    churchId: "church_1",
    dayKey: "2026-08-09",
    onEvent: (event) => events.push(event),
  });
  await Promise.resolve();
  unsubscribe();

  assert.equal(events[0].type, "initial-messages");
  assert.deepEqual(events[0].messages.map((message) => message.text), [
    "Already here",
  ]);
  assert.equal(events[1].type, "stream-ready");
});

test("shares one Firestore live snapshot and replays its cached batch", () => {
  let snapshotHandler;
  let listenerCount = 0;
  let unsubscribeCount = 0;
  const query = {
    where() {
      return this;
    },
    orderBy() {
      return this;
    },
    limit() {
      return this;
    },
    onSnapshot(onSnapshot) {
      listenerCount += 1;
      snapshotHandler = onSnapshot;
      return () => {
        unsubscribeCount += 1;
      };
    },
  };
  const service = createChatService({
    getFirestore: () => ({ collection: () => query }),
  });
  const firstEvents = [];
  const secondEvents = [];
  const unsubscribeFirst = service.subscribe({
    churchId: "church_1",
    dayKey: "2026-08-09",
    onEvent: (event) => firstEvents.push(event),
  });
  const older = {
    id: "chat_older",
    data: () => ({
      messageId: "chat_older",
      churchId: "church_1",
      dayKey: "2026-08-09",
      text: "Older",
      authorId: "user_1",
      authorName: "Ada",
      createdAt: new Date("2026-08-09T15:00:00.000Z"),
      reactions: [],
    }),
  };
  const newer = {
    id: "chat_newer",
    data: () => ({
      ...older.data(),
      messageId: "chat_newer",
      text: "Newer",
      createdAt: new Date("2026-08-09T16:00:00.000Z"),
    }),
  };

  snapshotHandler({
    size: 2,
    docs: [newer, older],
    docChanges: () => [
      { type: "added", doc: newer },
      { type: "added", doc: older },
    ],
  });
  const unsubscribeSecond = service.subscribe({
    churchId: "church_1",
    dayKey: "2026-08-09",
    onEvent: (event) => secondEvents.push(event),
  });

  assert.equal(listenerCount, 1);
  assert.deepEqual(
    firstEvents[0].messages.map((message) => message.text),
    ["Older", "Newer"],
  );
  assert.equal(firstEvents[1].type, "stream-ready");
  assert.deepEqual(secondEvents, firstEvents);

  unsubscribeFirst();
  assert.equal(unsubscribeCount, 0);
  unsubscribeSecond();
  assert.equal(unsubscribeCount, 1);
});

test("filters and removes expired Realtime Database typing entries", async () => {
  let typingListener;
  let cleanupUpdate;
  const query = {
    where() {
      return this;
    },
    orderBy() {
      return this;
    },
    limit() {
      return this;
    },
    onSnapshot() {
      return () => {};
    },
  };
  const typingRef = {
    on(_event, listener) {
      typingListener = listener;
    },
    off() {},
    async update(value) {
      cleanupUpdate = value;
    },
  };
  const service = createChatService({
    now: () => new Date("2026-08-09T16:00:00.000Z"),
    getFirestore: () => ({ collection: () => query }),
    getRealtimeDatabase: () => ({ ref: () => typingRef }),
  });
  const events = [];
  const unsubscribe = service.subscribe({
    churchId: "church_1",
    dayKey: "2026-08-09",
    onEvent: (event) => events.push(event),
  });

  typingListener({
    val: () => ({
      expired: {
        actorId: "user_old",
        name: "Old",
        expiresAt: Date.parse("2026-08-09T15:59:59.000Z"),
      },
      active: {
        actorId: "user_2",
        name: "Morgan",
        expiresAt: Date.parse("2026-08-09T16:00:05.000Z"),
      },
    }),
  });
  await Promise.resolve();
  unsubscribe();

  assert.deepEqual(events.at(-1).typers.map((typer) => typer.name), [
    "Morgan",
  ]);
  assert.deepEqual(cleanupUpdate, { expired: null });
});

test("rate limits excessive typing traffic before it reaches Firebase", async () => {
  const { service } = createService();
  for (let index = 0; index < 12; index += 1) {
    await service.updateTyping({
      churchId: "church_1",
      session: humanSession,
      isTyping: true,
      timeZoneHint: "UTC",
    });
  }
  await assert.rejects(
    service.updateTyping({
      churchId: "church_1",
      session: humanSession,
      isTyping: true,
      timeZoneHint: "UTC",
    }),
    /arriving too quickly/i,
  );
});

test("publishes short-lived typing state without storing a message", async () => {
  const { service } = createService();
  const events = [];
  const unsubscribe = service.subscribe({
    churchId: "church_1",
    dayKey: "2026-08-09",
    onEvent: (event) => events.push(event),
  });

  await service.updateTyping({
    churchId: "church_1",
    session: humanSession,
    isTyping: true,
    timeZoneHint: "UTC",
  });
  await service.updateTyping({
    churchId: "church_1",
    session: humanSession,
    isTyping: false,
    timeZoneHint: "UTC",
  });
  unsubscribe();

  assert.equal(events[0].type, "initial-messages");
  assert.equal(events[1].type, "stream-ready");
  assert.equal(events[2].type, "typing-updated");
  assert.deepEqual(events[2].typers.map((typer) => typer.name), ["Ada"]);
  assert.equal(events[3].type, "typing-updated");
  assert.deepEqual(events[3].typers, []);
  const result = await service.listMessages({
    churchId: "church_1",
    session: humanSession,
    dayKey: "2026-08-09",
    timeZoneHint: "UTC",
  });
  assert.deepEqual(result.messages, []);
});

test("stores private image keys while serializing only safe attachment metadata", async () => {
  let removed;
  const service = createChatService({
    now: () => new Date("2026-08-09T16:00:00.000Z"),
    onAttachmentRemoved: async (value) => {
      removed = value;
    },
  });
  const attachment = {
    type: "image",
    id: "12345678-1234-4123-8123-123456789abc",
    key: "churches/church_1/chat/id/image.webp",
    thumbnailKey: "churches/church_1/chat/id/thumbnail.webp",
    contentType: "image/webp",
    sizeBytes: 1200,
    thumbnailSizeBytes: 300,
    width: 1200,
    height: 800,
    thumbnailWidth: 480,
    thumbnailHeight: 320,
  };
  const message = await service.createMessage({
    churchId: "church_1",
    session: humanSession,
    text: "",
    clientMessageId: "client_image_1234",
    timeZoneHint: "UTC",
    attachment,
  });

  assert.equal(message.text, "");
  assert.equal(message.attachment.id, attachment.id);
  assert.equal("key" in message.attachment, false);
  assert.deepEqual(
    await service.getImageAttachment({
      churchId: "church_1",
      messageId: message.messageId,
    }),
    attachment,
  );

  const edited = await service.updateMessage({
    churchId: "church_1",
    session: humanSession,
    messageId: message.messageId,
    text: "",
  });
  assert.equal(edited.text, "");

  const deleted = await service.deleteMessage({
    churchId: "church_1",
    session: humanSession,
    messageId: message.messageId,
  });
  assert.equal(deleted.attachment, undefined);
  assert.equal(removed.churchId, "church_1");
  assert.deepEqual(removed.attachment, attachment);
  await assert.rejects(
    service.getImageAttachment({
      churchId: "church_1",
      messageId: message.messageId,
    }),
    /no longer available/i,
  );
});

test("rate limits a photo message before completing its upload", async () => {
  const { service } = createService();
  for (let index = 0; index < 30; index += 1) {
    await service.createMessage({
      churchId: "church_1",
      session: humanSession,
      text: `Message ${index}`,
      clientMessageId: `client-rate-${String(index).padStart(4, "0")}`,
      timeZoneHint: "UTC",
    });
  }

  let completionCalls = 0;
  await assert.rejects(
    service.createMessage({
      churchId: "church_1",
      session: humanSession,
      text: "",
      clientMessageId: "client-rate-photo",
      timeZoneHint: "UTC",
      completeAttachment: async () => {
        completionCalls += 1;
        return null;
      },
    }),
    /too many messages/i,
  );
  assert.equal(completionCalls, 0);
});
