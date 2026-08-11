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
