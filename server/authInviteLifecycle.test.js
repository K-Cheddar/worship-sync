process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";

import test from "node:test";
import assert from "node:assert/strict";

const {
  authHandlers,
  authRuntimeInfo,
  seedActiveHumanBearerForServerTests,
  seedPendingInviteForServerTests,
  seedRosterMemberForServerTests,
  getRosterMemberForServerTests,
  setSendEmailForServerTests,
} = await import("../authService.js");

const createReq = ({
  params = {},
  headers = {},
  session = {},
  body = {},
  query = {},
} = {}) => ({
  params,
  headers,
  session,
  body,
  query,
});

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

const previewInvite = async (token) => {
  const res = createRes();
  await authHandlers.getInvitePreview(createReq({ query: { token } }), res);
  return res;
};

test("getInvitePreview accepts a pending invite with time remaining", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const { token, churchName } = await seedPendingInviteForServerTests({
    churchId: "invite_preview_pending_church",
    email: "preview-pending@example.com",
    token: "preview-pending-token",
  });
  const res = await previewInvite(token);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.churchName, churchName);
});

test("getInvitePreview rejects a pending invite after effective expiration", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const { token } = await seedPendingInviteForServerTests({
    churchId: "invite_preview_time_expired_church",
    email: "preview-time-expired@example.com",
    token: "preview-time-expired-token",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const res = await previewInvite(token);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.errorMessage, "This invite has expired.");
});

test("getInvitePreview rejects an invite persisted as expired", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const { token } = await seedPendingInviteForServerTests({
    churchId: "invite_preview_persisted_expired_church",
    email: "preview-persisted-expired@example.com",
    token: "preview-persisted-expired-token",
    status: "expired",
  });
  const res = await previewInvite(token);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.errorMessage, "This invite has expired.");
});

test("getInvitePreview preserves revoked invite behavior", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const { token } = await seedPendingInviteForServerTests({
    churchId: "invite_preview_revoked_church",
    email: "preview-revoked@example.com",
    token: "preview-revoked-token",
    status: "revoked",
  });
  const res = await previewInvite(token);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.errorMessage, "This invite was revoked.");
});

test("a successful resend produces a valid invite preview again", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const req = { session: {} };
  const churchId = "invite_preview_resend_church";
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_preview_resend_admin",
    email: "preview-resend-admin@example.com",
    churchId,
  });
  const { inviteId } = await seedPendingInviteForServerTests({
    churchId,
    email: "preview-resend@example.com",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  let sentEmail;
  setSendEmailForServerTests(async (payload) => {
    sentEmail = payload;
  });
  try {
    const resendRes = createRes();
    await authHandlers.resendChurchInvite(
      createReq({
        params: { churchId, inviteId },
        session: req.session,
        headers: {
          authorization: `Bearer ${humanApiToken}`,
          "x-csrf-token": req.session.csrfToken,
        },
      }),
      resendRes,
    );
    assert.equal(resendRes.statusCode, 200);
    const tokenMatch = sentEmail?.textBody?.match(/\/invite\?token=([A-Za-z0-9_-]+)/);
    assert.ok(tokenMatch, "resend email should contain the replacement invite token");
    const previewRes = await previewInvite(decodeURIComponent(tokenMatch[1]));
    assert.equal(previewRes.statusCode, 200);
  } finally {
    setSendEmailForServerTests(null);
  }
});

test("listChurchInvites exposes a stale pending invite as expired", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const churchId = "invite_lifecycle_expired_church";
  await seedPendingInviteForServerTests({
    churchId,
    inviteId: "invite_expired_list",
    email: "expired-list@example.com",
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  const req = { session: {} };
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_lifecycle_admin",
    email: "admin-lifecycle@example.com",
    churchId,
  });
  const res = createRes();
  await authHandlers.listChurchInvites(
    createReq({
      params: { churchId },
      headers: { authorization: `Bearer ${humanApiToken}` },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.invites[0].status, "expired");
});

test("resendChurchInvite requires an authenticated admin", async () => {
  const res = createRes();
  await authHandlers.resendChurchInvite(
    createReq({
      params: { churchId: "invite_lifecycle_church", inviteId: "invite_1" },
    }),
    res,
  );
  assert.equal(res.statusCode, 401);
});

test("resendChurchInvite enforces church ownership before changing an invite", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const ownerReq = { session: {} };
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req: ownerReq,
    userId: "invite_lifecycle_owner",
    email: "owner@example.com",
    churchId: "invite_lifecycle_owner_church",
  });
  await seedPendingInviteForServerTests({
    churchId: "invite_lifecycle_other_church",
    inviteId: "invite_other_church",
    email: "other@example.com",
  });
  const res = createRes();
  await authHandlers.resendChurchInvite(
    createReq({
      params: {
        churchId: "invite_lifecycle_owner_church",
        inviteId: "invite_other_church",
      },
      session: ownerReq.session,
      headers: {
        authorization: `Bearer ${humanApiToken}`,
        "x-csrf-token": ownerReq.session.csrfToken,
      },
    }),
    res,
  );
  assert.equal(res.statusCode, 404);
});

test("accepted invites cannot be resent", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const req = { session: {} };
  const churchId = "invite_lifecycle_accepted_church";
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_lifecycle_accepted_admin",
    email: "accepted-admin@example.com",
    churchId,
  });
  await seedPendingInviteForServerTests({
    churchId,
    inviteId: "invite_accepted_record",
    email: "accepted@example.com",
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  const res = createRes();
  await authHandlers.resendChurchInvite(createReq({
    params: { churchId, inviteId: "invite_accepted_record" },
    session: req.session,
    headers: {
      authorization: `Bearer ${humanApiToken}`,
      "x-csrf-token": req.session.csrfToken,
    },
  }), res);
  assert.equal(res.statusCode, 400);
});

test("revoked invites cannot be resent", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const req = { session: {} };
  const churchId = "invite_lifecycle_revoked_church";
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_lifecycle_revoked_admin",
    email: "revoked-admin@example.com",
    churchId,
  });
  await seedPendingInviteForServerTests({
    churchId,
    inviteId: "invite_revoked_record",
    email: "revoked@example.com",
    status: "revoked",
  });
  const res = createRes();
  await authHandlers.resendChurchInvite(
    createReq({
      params: { churchId, inviteId: "invite_revoked_record" },
      session: req.session,
      headers: {
        authorization: `Bearer ${humanApiToken}`,
        "x-csrf-token": req.session.csrfToken,
      },
    }),
    res,
  );
  assert.equal(res.statusCode, 400);
});

test("email send failure preserves the existing invite token and expiration", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const req = { session: {} };
  const churchId = "invite_lifecycle_send_failure_church";
  const oldToken = "invite-send-failure-old-token";
  const oldExpiresAt = new Date(Date.now() + 86400000).toISOString();
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_lifecycle_send_failure_admin",
    email: "send-failure-admin@example.com",
    churchId,
  });
  const { inviteId } = await seedPendingInviteForServerTests({
    churchId,
    inviteId: "invite_send_failure_record",
    email: "send-failure@example.com",
    token: oldToken,
    expiresAt: oldExpiresAt,
  });
  setSendEmailForServerTests(async () => {
    throw new Error("delivery failed");
  });
  try {
    const res = createRes();
    await authHandlers.resendChurchInvite(
      createReq({
        params: { churchId, inviteId },
        session: req.session,
        headers: {
          authorization: `Bearer ${humanApiToken}`,
          "x-csrf-token": req.session.csrfToken,
        },
      }),
      res,
    );
    assert.equal(res.statusCode, 500);

    const listRes = createRes();
    await authHandlers.listChurchInvites(
      createReq({
        params: { churchId },
        headers: { authorization: `Bearer ${humanApiToken}` },
      }),
      listRes,
    );
    assert.equal(listRes.payload.invites[0].status, "pending");
    assert.equal(listRes.payload.invites[0].expiresAt, oldExpiresAt);

    const previewRes = createRes();
    await authHandlers.getInvitePreview(
      createReq({ query: { token: oldToken } }),
      previewRes,
    );
    assert.equal(previewRes.statusCode, 200);
  } finally {
    setSendEmailForServerTests(null);
  }
});

test("initial invite delivery failure removes the provisional invite and roster metadata", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const req = { session: {} };
  const churchId = "invite_lifecycle_initial_failure_church";
  const memberId = "invite_initial_failure_member";
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_initial_failure_admin",
    email: "initial-failure-admin@example.com",
    churchId,
  });
  await seedRosterMemberForServerTests({ memberId, churchId });
  setSendEmailForServerTests(async () => {
    throw new Error("delivery failed");
  });
  try {
    const res = createRes();
    await authHandlers.createInvite(
      createReq({
        params: { churchId },
        session: req.session,
        headers: {
          authorization: `Bearer ${humanApiToken}`,
          "x-csrf-token": req.session.csrfToken,
        },
        body: { email: "initial-failure@example.com", memberId },
      }),
      res,
    );
    assert.equal(res.statusCode, 500);

    const listRes = createRes();
    await authHandlers.listChurchInvites(
      createReq({
        params: { churchId },
        headers: { authorization: `Bearer ${humanApiToken}` },
      }),
      listRes,
    );
    assert.deepEqual(listRes.payload.invites, []);
    assert.equal(
      (await getRosterMemberForServerTests(memberId)).invitedAt,
      undefined,
    );
  } finally {
    setSendEmailForServerTests(null);
  }
});

test("successful initial invite persists sent state and roster metadata", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const req = { session: {} };
  const churchId = "invite_lifecycle_initial_success_church";
  const memberId = "invite_initial_success_member";
  const sentEmails = [];
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_initial_success_admin",
    email: "initial-success-admin@example.com",
    churchId,
  });
  await seedRosterMemberForServerTests({ memberId, churchId });
  setSendEmailForServerTests(async (payload) => sentEmails.push(payload));
  try {
    const res = createRes();
    await authHandlers.createInvite(
      createReq({
        params: { churchId },
        session: req.session,
        headers: {
          authorization: `Bearer ${humanApiToken}`,
          "x-csrf-token": req.session.csrfToken,
        },
        body: { email: "initial-success@example.com", memberId },
      }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(sentEmails.length, 1);
    assert.equal(res.payload.invite.status, "pending");
    assert.ok(res.payload.invite.lastSentAt);
    assert.ok((await getRosterMemberForServerTests(memberId)).invitedAt);
  } finally {
    setSendEmailForServerTests(null);
  }
});

test("successful resend replaces expiration and invalidates the old token", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const req = { session: {} };
  const churchId = "invite_lifecycle_success_church";
  const oldToken = "invite-success-old-token";
  const oldExpiresAt = new Date(Date.now() + 3600000).toISOString();
  const sentEmails = [];
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_lifecycle_success_admin",
    email: "success-admin@example.com",
    churchId,
  });
  const { inviteId } = await seedPendingInviteForServerTests({
    churchId,
    inviteId: "invite_success_record",
    email: "success@example.com",
    token: oldToken,
    expiresAt: oldExpiresAt,
  });
  setSendEmailForServerTests(async (payload) => {
    sentEmails.push(payload);
  });
  try {
    const res = createRes();
    await authHandlers.resendChurchInvite(
      createReq({
        params: { churchId, inviteId },
        session: req.session,
        headers: {
          authorization: `Bearer ${humanApiToken}`,
          "x-csrf-token": req.session.csrfToken,
        },
      }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(sentEmails.length, 1);

    const newToken = decodeURIComponent(
      `${sentEmails[0].textBody} ${sentEmails[0].htmlBody}`.match(
        /invite\?token=([^&\s"')]+)/,
      )[1],
    );
    const listRes = createRes();
    await authHandlers.listChurchInvites(
      createReq({
        params: { churchId },
        headers: { authorization: `Bearer ${humanApiToken}` },
      }),
      listRes,
    );
    assert.equal(listRes.payload.invites[0].status, "pending");
    assert.notEqual(listRes.payload.invites[0].expiresAt, oldExpiresAt);

    const oldPreviewRes = createRes();
    await authHandlers.getInvitePreview(
      createReq({ query: { token: oldToken } }),
      oldPreviewRes,
    );
    assert.equal(oldPreviewRes.statusCode, 404);
    const newPreviewRes = createRes();
    await authHandlers.getInvitePreview(
      createReq({ query: { token: newToken } }),
      newPreviewRes,
    );
    assert.equal(newPreviewRes.statusCode, 200);
  } finally {
    setSendEmailForServerTests(null);
  }
});

test("concurrent invite creation returns one conflict for the same email", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const req = { session: {} };
  const churchId = "invite_lifecycle_duplicate_church";
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_lifecycle_duplicate_admin",
    email: "duplicate-admin@example.com",
    churchId,
  });
  const request = () =>
    createReq({
      params: { churchId },
      session: req.session,
      headers: {
        authorization: `Bearer ${humanApiToken}`,
        "x-csrf-token": req.session.csrfToken,
      },
      body: { email: "duplicate-invite@example.com" },
    });
  const responses = [createRes(), createRes()];
  setSendEmailForServerTests(async () => {});
  try {
    await Promise.all(
      responses.map((res) => authHandlers.createInvite(request(), res)),
    );
    assert.deepEqual(
      responses.map((res) => res.statusCode).sort((a, b) => a - b),
      [200, 409],
    );
    const conflict = responses.find((res) => res.statusCode === 409);
    assert.equal(conflict.payload.existingInvite.email, "duplicate-invite@example.com");
  } finally {
    setSendEmailForServerTests(null);
  }
});

test("expired invite recovery returns the existing invite without burning create attempts", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const req = { session: {} };
  const churchId = "invite_lifecycle_expired_recovery_church";
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_lifecycle_expired_recovery_admin",
    email: "expired-recovery-admin@example.com",
    churchId,
  });
  await seedPendingInviteForServerTests({
    churchId,
    inviteId: "invite_expired_recovery",
    email: "expired-recovery@example.com",
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  const request = () =>
    createReq({
      params: { churchId },
      session: req.session,
      headers: {
        authorization: `Bearer ${humanApiToken}`,
        "x-csrf-token": req.session.csrfToken,
      },
      body: { email: "expired-recovery@example.com" },
    });
  for (let attempt = 0; attempt < 51; attempt += 1) {
    const res = createRes();
    await authHandlers.createInvite(request(), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.existingInvite.inviteId, "invite_expired_recovery");
  }
});

test("expired invites can be removed without changing accepted or revoked semantics", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const req = { session: {} };
  const churchId = "invite_lifecycle_expired_remove_church";
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_lifecycle_expired_remove_admin",
    email: "expired-remove-admin@example.com",
    churchId,
  });
  await seedPendingInviteForServerTests({
    churchId,
    inviteId: "invite_expired_remove",
    email: "expired-remove@example.com",
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  const res = createRes();
  await authHandlers.removeExpiredChurchInvite(
    createReq({
      params: { churchId, inviteId: "invite_expired_remove" },
      session: req.session,
      headers: {
        authorization: `Bearer ${humanApiToken}`,
        "x-csrf-token": req.session.csrfToken,
      },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const listRes = createRes();
  await authHandlers.listChurchInvites(
    createReq({
      params: { churchId },
      headers: { authorization: `Bearer ${humanApiToken}` },
    }),
    listRes,
  );
  assert.equal(listRes.payload.invites.length, 0);
});

test("resendChurchInvite rate-limits repeated sends to one address", { skip: authRuntimeInfo.hasFirestore }, async () => {
  const req = { session: {} };
  const churchId = "invite_lifecycle_rate_limit_church";
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req,
    userId: "invite_lifecycle_rate_limit_admin",
    email: "rate-limit-admin@example.com",
    churchId,
  });
  const { inviteId } = await seedPendingInviteForServerTests({
    churchId,
    email: "rate-limit-invite@example.com",
  });
  const request = () =>
    createReq({
      params: { churchId, inviteId },
      session: req.session,
      headers: {
        authorization: `Bearer ${humanApiToken}`,
        "x-csrf-token": req.session.csrfToken,
      },
    });
  const responses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = createRes();
    await authHandlers.resendChurchInvite(request(), res);
    responses.push(res.statusCode);
  }
  assert.deepEqual(responses, [200, 200, 200, 200, 200, 429]);
});
