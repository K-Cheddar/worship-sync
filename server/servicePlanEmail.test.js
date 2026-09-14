import test from "node:test";
import assert from "node:assert/strict";

import { createTeamsAuthHandlers } from "./teamsAuthHandlers.js";
import { renderServicePlanShareEmail } from "../email-templates/renderEmail.tsx";

const COLLECTIONS = {
  servicePlans: "servicePlans",
  churches: "churches",
};

const createRes = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
});

const createReq = ({ churchId = "church-1", body = {}, planKey = "service-1@2026-07-26" } = {}) => ({
  params: { churchId, planKey },
  headers: {},
  body,
  session: {},
});

const basePlan = {
  planId: "church-1::service-1@2026-07-26",
  churchId: "church-1",
  planKey: "service-1@2026-07-26",
  name: "Easter Sunday",
  date: "2026-07-26",
  startsAt: "2026-07-26T14:00:00.000Z",
  published: true,
  publicLinkToken: "detailed-token",
  publicGeneralLinkToken: "general-token",
  sections: [],
};

const validBody = {
  recipients: ["one@example.com", "two@example.com"],
  subject: "Easter Sunday Service Plan — July 26, 2026",
  message: "Here is the service plan.",
  // The endpoint deliberately ignores client-supplied URLs.
  shareUrl: "https://example.invalid/not-the-plan",
};

const createHarness = ({
  plan = basePlan,
  authorized = true,
  emailDeliveryConfigured = true,
  sendEmail = async () => null,
} = {}) => {
  const rateLimitCalls = [];
  const logs = [];
  const handler = createTeamsAuthHandlers({
    COLLECTIONS,
    assertCsrf: async () => undefined,
    requireServicesEditSession: async () => {
      if (!authorized) {
        const error = new Error("Services edit access required");
        error.statusCode = 403;
        throw error;
      }
      return { user: { uid: "user-1" } };
    },
    getDoc: async (collection) => {
      if (collection === COLLECTIONS.servicePlans) return plan;
      if (collection === COLLECTIONS.churches) {
        return { churchId: "church-1", name: "Grace Church" };
      }
      return null;
    },
    normalizeEmail: (value) => value.trim().toLowerCase(),
    enforceRateLimit: (options) => rateLimitCalls.push(options),
    getClientIp: () => "127.0.0.1",
    sendEmail,
    emailDeliveryConfigured,
    renderServicePlanShareEmail,
    logAuthEvent: (...args) => logs.push(args),
    httpError: (statusCode, message) => {
      const error = new Error(message);
      error.statusCode = statusCode;
      return error;
    },
  });
  return { handler: handler.sendServicePlanShareEmail, rateLimitCalls, logs };
};

const callHandler = async (harness, options = {}) => {
  const res = createRes();
  await harness.handler(createReq(options), res);
  return res;
};

test("sends an authorized Service Plan email with the trusted public URL", async () => {
  const sends = [];
  const harness = createHarness({
    sendEmail: async (payload) => sends.push(payload),
  });

  const res = await callHandler(harness, { body: validBody });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    success: true,
    sent: 2,
    failed: 0,
    failedRecipients: [],
  });
  assert.equal(sends.length, 2);
  assert.deepEqual(
    sends.map((send) => send.to).sort(),
    ["one@example.com", "two@example.com"],
  );
  assert.equal(sends[0].subject, validBody.subject);
  assert.match(sends[0].htmlBody, /https:\/\/www\.worshipsync\.net\/services\/general-token/);
  assert.match(sends[0].textBody, /https:\/\/www\.worshipsync\.net\/services\/general-token/);
  assert.doesNotMatch(sends[0].htmlBody, /example\.invalid/);
  assert.equal(harness.rateLimitCalls[0].scope, "service-plan-share-email");
});

test("rejects an unauthorized Service Plan email without sending", async () => {
  const sends = [];
  const harness = createHarness({
    authorized: false,
    sendEmail: async (payload) => sends.push(payload),
  });

  const res = await callHandler(harness, { body: validBody });

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.success, false);
  assert.equal(sends.length, 0);
});

test("rejects invalid recipients before rendering or sending", async () => {
  const sends = [];
  const harness = createHarness({
    sendEmail: async (payload) => sends.push(payload),
  });

  const res = await callHandler(harness, {
    body: { ...validBody, recipients: ["not-an-email"] },
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.errorMessage, /valid email/i);
  assert.equal(sends.length, 0);
  assert.equal(harness.rateLimitCalls.length, 0);
});

test("rejects a missing or cross-church Service Plan", async () => {
  const missing = createHarness({ plan: null });
  const missingRes = await callHandler(missing, { body: validBody });
  assert.equal(missingRes.statusCode, 404);
  assert.equal(missingRes.payload.success, false);

  const foreign = createHarness({
    plan: { ...basePlan, churchId: "church-2" },
  });
  const foreignRes = await callHandler(foreign, { body: validBody });
  assert.equal(foreignRes.statusCode, 404);
  assert.equal(foreignRes.payload.success, false);
});

test("reports partial delivery and leaves only failed recipients to retry", async () => {
  const sends = [];
  const harness = createHarness({
    sendEmail: async (payload) => {
      if (payload.to === "failed@example.com") {
        throw new Error("Provider rejected this recipient");
      }
      sends.push(payload);
    },
  });

  const res = await callHandler(harness, {
    body: {
      ...validBody,
      recipients: ["sent@example.com", "failed@example.com"],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    success: false,
    sent: 1,
    failed: 1,
    failedRecipients: ["failed@example.com"],
  });
  assert.equal(sends.length, 1);
  assert.match(harness.logs.flat().join(" "), /partial|Provider rejected/i);
});

test("rejects an unconfigured email provider without reporting success", async () => {
  const harness = createHarness({
    emailDeliveryConfigured: false,
    sendEmail: async () => {
      assert.fail("Unconfigured delivery must not call sendEmail");
    },
  });

  const res = await callHandler(harness, { body: validBody });

  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.success, false);
  assert.match(res.payload.errorMessage, /not configured/i);
});

test("returns a safe error when the email provider fails", async () => {
  const harness = createHarness({
    sendEmail: async () => {
      throw new Error("Resend request failed");
    },
  });

  const res = await callHandler(harness, { body: validBody });

  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.success, false);
  assert.match(res.payload.errorMessage, /Could not send the service plan email/i);
  assert.match(
    harness.logs.flat().join(" "),
    /service-plan\.share-email\.failed|Resend request failed/,
  );
});
