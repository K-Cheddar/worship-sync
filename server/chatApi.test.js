import assert from "node:assert/strict";
import test from "node:test";
import { createChatHandlers } from "./chatApi.js";

const createResponse = () => ({
  statusCode: 200,
  payload: null,
  headers: {},
  writes: [],
  ended: false,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
  setHeader(name, value) {
    this.headers[name] = value;
  },
  flushHeaders() {},
  write(value) {
    this.writes.push(value);
  },
  end() {
    this.ended = true;
  },
});

const createRequest = (overrides = {}) => ({
  params: { churchId: "church_1" },
  query: {},
  body: {},
  appSession: { churchId: "church_1", actorId: "user_1" },
  on() {},
  ...overrides,
});

test("chat handlers enforce the authenticated church boundary", async () => {
  let called = false;
  const handlers = createChatHandlers({
    chatService: {
      getContext: async () => {
        called = true;
      },
    },
  });
  const res = createResponse();
  await handlers.getContext(
    createRequest({ appSession: { churchId: "church_2" } }),
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.payload, {
    error: "That church chat is not available.",
  });
  assert.equal(called, false);
});

test("chat context reports whether private image storage is configured", async () => {
  const handlers = createChatHandlers({
    chatService: {
      getContext: async () => ({ todayKey: "2026-08-10" }),
    },
    getChatImageStorage: () => ({ createUpload() {} }),
  });
  const res = createResponse();
  await handlers.getContext(createRequest(), res);
  assert.equal(res.payload.context.imageUploadsEnabled, true);

  const unavailableHandlers = createChatHandlers({
    chatService: {
      getContext: async () => ({ todayKey: "2026-08-10" }),
    },
    getChatImageStorage: () => {
      const error = new Error("not configured");
      error.statusCode = 503;
      throw error;
    },
  });
  const unavailableResponse = createResponse();
  await unavailableHandlers.getContext(createRequest(), unavailableResponse);
  assert.equal(
    unavailableResponse.payload.context.imageUploadsEnabled,
    false,
  );
});

test("createMessage forwards the signed-in session and returns the message", async () => {
  let received;
  const message = { messageId: "chat_1", text: "Hello" };
  const handlers = createChatHandlers({
    chatService: {
      createMessage: async (input) => {
        received = input;
        return message;
      },
    },
  });
  const req = createRequest({
    body: {
      text: "Hello",
      clientMessageId: "client_12345678",
      timeZone: "America/New_York",
    },
  });
  const res = createResponse();
  await handlers.createMessage(req, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.payload, { message });
  assert.equal(received.session, req.appSession);
  assert.equal(received.churchId, "church_1");
});

test("updateTyping forwards transient presence for the signed-in session", async () => {
  let received;
  const handlers = createChatHandlers({
    chatService: {
      updateTyping: async (input) => {
        received = input;
        return { active: true, expiresAt: 1234 };
      },
    },
  });
  const req = createRequest({
    body: { isTyping: true, timeZone: "America/New_York" },
  });
  const res = createResponse();

  await handlers.updateTyping(req, res);

  assert.deepEqual(res.payload, {
    typing: { active: true, expiresAt: 1234 },
  });
  assert.equal(received.session, req.appSession);
  assert.equal(received.isTyping, true);
  assert.equal(received.timeZoneHint, "America/New_York");
});

test("stream subscribes once and releases the listener when the client closes", () => {
  let onEvent;
  let unsubscribed = 0;
  let closeHandler;
  const handlers = createChatHandlers({
    chatService: {
      subscribe: (input) => {
        onEvent = input.onEvent;
        return () => {
          unsubscribed += 1;
        };
      },
    },
  });
  const req = createRequest({
    query: { dayKey: "2026-08-10" },
    on: (event, handler) => {
      if (event === "close") closeHandler = handler;
    },
  });
  const res = createResponse();
  handlers.stream(req, res);

  assert.equal(res.headers["Content-Type"], "text/event-stream");
  assert.match(res.writes[0], /"type":"connected"/);
  onEvent({ type: "message-updated", message: { messageId: "chat_1" } });
  assert.match(res.writes[1], /"messageId":"chat_1"/);

  closeHandler();
  assert.equal(unsubscribed, 1);
  assert.equal(res.ended, true);
});

test("finalizes an uploaded image before creating its chat message", async () => {
  const attachment = { type: "image", id: "image_1" };
  let completed;
  let created;
  const handlers = createChatHandlers({
    getChatImageStorage: () => ({
      completeUpload: async (input) => {
        completed = input;
        return attachment;
      },
    }),
    chatService: {
      createMessage: async (input) => {
        created = input;
        const completedAttachment = await input.completeAttachment();
        return { messageId: "chat_image_1", attachment: completedAttachment };
      },
    },
  });
  const imageUpload = { id: "upload_1", contentType: "image/png" };
  const req = createRequest({
    body: {
      text: "Stage setup",
      clientMessageId: "client_image_1234",
      timeZone: "UTC",
      imageUpload,
    },
  });
  const res = createResponse();
  let released = 0;
  res.locals = {
    releaseChatImageFinalize: () => {
      released += 1;
    },
  };

  await handlers.createMessage(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(completed.actorId, "user_1");
  assert.equal(completed.clientMessageId, "client_image_1234");
  assert.deepEqual(completed.upload, imageUpload);
  assert.equal(typeof created.completeAttachment, "function");
  assert.equal(released, 1);
});

test("creates private upload intents and authenticated image URLs", async () => {
  let uploadInput;
  let urlInput;
  const attachment = { type: "image", id: "image_1", key: "private" };
  const handlers = createChatHandlers({
    getChatImageStorage: () => ({
      createUpload: async (input) => {
        uploadInput = input;
        return { imageUpload: { id: "image_1" }, uploadUrl: "signed-put" };
      },
      getDownloadUrl: async (input) => {
        urlInput = input;
        return { url: "signed-get", expiresAt: "2026-08-10T17:00:00Z" };
      },
    }),
    chatService: {
      getImageAttachment: async () => attachment,
    },
  });
  const uploadResponse = createResponse();
  await handlers.createImageUpload(
    createRequest({
      body: {
        fileName: "photo.png",
        contentType: "image/png",
        sizeBytes: 123,
      },
    }),
    uploadResponse,
  );
  assert.equal(uploadResponse.statusCode, 201);
  assert.equal(uploadInput.actorId, "user_1");

  const urlResponse = createResponse();
  await handlers.getImageUrl(
    createRequest({
      params: {
        churchId: "church_1",
        messageId: "chat_image_1",
        variant: "thumbnail",
      },
    }),
    urlResponse,
  );
  assert.equal(urlResponse.payload.url, "signed-get");
  assert.equal(urlInput.attachment, attachment);
  assert.equal(urlInput.variant, "thumbnail");
});
