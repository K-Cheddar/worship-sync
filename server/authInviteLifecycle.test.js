process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";

import test from "node:test";
import assert from "node:assert/strict";

const {
  authHandlers,
  authRuntimeInfo,
  seedActiveHumanBearerForServerTests,
  seedPendingInviteForServerTests,
} = await import("../authService.js");

const createReq = ({ params = {}, headers = {}, session = {}, body = {} } = {}) => ({
  params,
  headers,
  session,
  body,
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
  await Promise.all(
    responses.map((res) => authHandlers.createInvite(request(), res)),
  );
  assert.deepEqual(
    responses.map((res) => res.statusCode).sort((a, b) => a - b),
    [200, 409],
  );
  const conflict = responses.find((res) => res.statusCode === 409);
  assert.equal(conflict.payload.existingInvite.email, "duplicate-invite@example.com");
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
