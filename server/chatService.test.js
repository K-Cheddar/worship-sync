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
  let current = new Date("2026-08-10T16:00:00.000Z");
  return {
    service: createChatService({ now: () => new Date(current) }),
    setNow(value) {
      current = new Date(value);
    },
  };
};

test("chat day keys respect the church timezone", () => {
  const instant = new Date("2026-08-10T02:30:00.000Z");
  assert.equal(chatDayKey(instant, "UTC"), "2026-08-10");
  assert.equal(chatDayKey(instant, "America/New_York"), "2026-08-09");
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
    dayKey: "2026-08-10",
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
    dayKey: "2026-08-10",
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
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "stream-ready");
  assert.equal(events[1].type, "message-updated");
  assert.equal(events[1].message.text, "Live update");
});
