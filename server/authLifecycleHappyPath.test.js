/**
 * Auth lifecycle happy paths for invite preview/accept and pairing redeem.
 * Uses the in-memory auth store only (forces empty Firebase env like teamsApi).
 */
process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";

const {
  authHandlers,
  canSeedHumanBearerAuthForServerTests,
  seedActiveHumanBearerForServerTests,
  seedPendingInviteForServerTests,
  setVerifyIdTokenForServerTests,
} = await import("../authService.js");

const createSession = () => ({
  destroy(callback) {
    callback?.();
  },
  regenerate(callback) {
    delete this.auth;
    callback?.();
  },
});

const createReq = ({
  params = {},
  headers = {},
  session = createSession(),
  body = {},
  query = {},
} = {}) => ({
  params,
  headers,
  session,
  body,
  query,
});

const createRes = () => {
  const res = {
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
    set() {
      return this;
    },
  };
  return res;
};

const skipUnlessInMemoryAuth = (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("Auth happy-path tests seed in-memory auth only.");
    return true;
  }
  return false;
};

const createAdminContext = async (suffix) => {
  const session = createSession();
  const seedReq = createReq({ session });
  const { humanApiToken, churchId } = await seedActiveHumanBearerForServerTests(
    {
      req: seedReq,
      userId: `happy_admin_${suffix}`,
      email: `happy-admin-${suffix}@example.com`,
      churchId: `happy_church_${suffix}`,
      role: "admin",
      appAccess: "full",
    },
  );
  const meRes = createRes();
  await authHandlers.getAuthMe(
    createReq({
      session,
      headers: { authorization: `Bearer ${humanApiToken}` },
    }),
    meRes,
  );
  return {
    churchId,
    headers: {
      authorization: `Bearer ${humanApiToken}`,
      "x-csrf-token": String(meRes.payload?.csrfToken || ""),
    },
    session,
  };
};

const callHandler = async (
  handler,
  { context, params = {}, body = {}, query = {} },
) => {
  const res = createRes();
  await handler(
    createReq({
      params: { churchId: context.churchId, ...params },
      headers: context.headers,
      session: context.session,
      body,
      query,
    }),
    res,
  );
  return res;
};

test("getInvitePreview returns church name for a pending invite", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const { token, churchName } = await seedPendingInviteForServerTests({
    churchId: "happy_invite_preview_church",
    churchName: "Happy Preview Church",
    email: "preview-invitee@example.com",
    token: "happy-preview-token-1",
  });

  const res = createRes();
  await authHandlers.getInvitePreview(createReq({ query: { token } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.success, true);
  assert.equal(res.payload?.churchName, churchName);
});

test("acceptInvite creates membership when idToken email matches", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const email = "accept-invitee@example.com";
  const { token, churchId } = await seedPendingInviteForServerTests({
    churchId: "happy_invite_accept_church",
    churchName: "Happy Accept Church",
    email,
    token: "happy-accept-token-1",
    role: "member",
    appAccess: "view",
  });

  setVerifyIdTokenForServerTests(async (idToken) => {
    assert.equal(idToken, "test-id-token");
    return {
      uid: "firebase_uid_accept_1",
      email,
      name: "Invite Acceptor",
    };
  });

  try {
    const res = createRes();
    await authHandlers.acceptInvite(
      createReq({ body: { token, idToken: "test-id-token" } }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.success, true);
    assert.equal(res.payload?.email, email);
    assert.equal(res.payload?.churchId, churchId);
  } finally {
    setVerifyIdTokenForServerTests(null);
  }
});

test("acceptInvite rejects when idToken email does not match the invite", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const { token } = await seedPendingInviteForServerTests({
    churchId: "happy_invite_mismatch_church",
    email: "expected@example.com",
    token: "happy-mismatch-token-1",
  });

  setVerifyIdTokenForServerTests(async () => ({
    uid: "firebase_uid_mismatch",
    email: "other@example.com",
  }));

  try {
    const res = createRes();
    await authHandlers.acceptInvite(
      createReq({ body: { token, idToken: "mismatch-id-token" } }),
      res,
    );
    assert.equal(res.statusCode, 403);
    assert.match(String(res.payload?.errorMessage || ""), /different email/i);
  } finally {
    setVerifyIdTokenForServerTests(null);
  }
});

test("workstation create then redeem issues a credential", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const context = await createAdminContext("ws_cred");
  const createResPayload = await callHandler(
    authHandlers.createWorkstationPairing,
    {
      context,
      body: { label: "Booth PC", appAccess: "full", platformType: "electron" },
    },
  );
  assert.equal(createResPayload.statusCode, 200);
  assert.equal(createResPayload.payload?.success, true);
  const pairingToken = createResPayload.payload?.pairing?.token;
  assert.ok(pairingToken);

  const redeemRes = createRes();
  await authHandlers.redeemWorkstationPairing(
    createReq({ body: { token: pairingToken } }),
    redeemRes,
  );
  assert.equal(redeemRes.statusCode, 200);
  assert.equal(redeemRes.payload?.success, true);
  assert.ok(redeemRes.payload?.credential);
  assert.ok(redeemRes.payload?.device);
  assert.equal(redeemRes.payload?.sessionEstablished, undefined);
});

test("workstation redeem with platformType web establishes a session", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const context = await createAdminContext("ws_web");
  const createResPayload = await callHandler(
    authHandlers.createWorkstationPairing,
    {
      context,
      body: { label: "Web Booth", appAccess: "view", platformType: "web" },
    },
  );
  assert.equal(createResPayload.statusCode, 200);
  const pairingToken = createResPayload.payload?.pairing?.token;
  assert.ok(pairingToken);

  const redeemRes = createRes();
  await authHandlers.redeemWorkstationPairing(
    createReq({
      session: createSession(),
      body: { token: pairingToken, platformType: "web" },
    }),
    redeemRes,
  );
  assert.equal(redeemRes.statusCode, 200);
  assert.equal(redeemRes.payload?.success, true);
  assert.equal(redeemRes.payload?.sessionEstablished, true);
  assert.ok(redeemRes.payload?.bootstrap?.authenticated);
  assert.equal(redeemRes.payload?.bootstrap?.sessionKind, "workstation");

  const recoveredSession = createSession();
  const meRes = createRes();
  await authHandlers.getAuthMe(
    createReq({
      session: recoveredSession,
      headers: {
        "x-workstation-token": redeemRes.payload?.credential,
      },
    }),
    meRes,
  );
  assert.equal(meRes.statusCode, 200);
  assert.equal(meRes.payload?.authenticated, true);
  assert.equal(meRes.payload?.sessionKind, "workstation");
  assert.equal(recoveredSession.auth?.sessionKind, "workstation");
});

test("a paired workstation can view saved Service Plans but not edit them", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const context = await createAdminContext("ws_service_plans");
  const saved = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey: "svc1@2026-09-06" },
    body: {
      serviceId: "svc1",
      date: "2026-09-06",
      name: "Sunday Service",
      sections: [],
    },
  });
  assert.equal(saved.statusCode, 200);

  const createResPayload = await callHandler(
    authHandlers.createWorkstationPairing,
    {
      context,
      body: { label: "Booth iPad", appAccess: "view", platformType: "web" },
    },
  );
  const pairingToken = createResPayload.payload?.pairing?.token;
  assert.ok(pairingToken);

  const workstationSession = createSession();
  const redeemRes = createRes();
  await authHandlers.redeemWorkstationPairing(
    createReq({
      session: workstationSession,
      body: { token: pairingToken, platformType: "web" },
    }),
    redeemRes,
  );
  assert.equal(redeemRes.statusCode, 200);
  // View-only regardless of appAccess tier, for now: no Teams roster access
  // (that would leak member PII), read-only Service Plans access.
  assert.deepEqual(redeemRes.payload?.bootstrap?.permissions, {
    teams: "none",
    services: "view",
    teamScopes: {},
  });

  const listRes = createRes();
  await authHandlers.listServicePlans(
    createReq({
      session: workstationSession,
      params: { churchId: context.churchId },
    }),
    listRes,
  );
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.payload?.success, true);
  assert.deepEqual(
    listRes.payload?.servicePlans?.map((plan) => plan.planKey),
    ["svc1@2026-09-06"],
  );

  const getRes = createRes();
  await authHandlers.getServicePlan(
    createReq({
      session: workstationSession,
      params: { churchId: context.churchId, planKey: "svc1@2026-09-06" },
    }),
    getRes,
  );
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.payload?.servicePlan?.planKey, "svc1@2026-09-06");

  // Still no edit access from a workstation, even though its read access to
  // plans was just widened: saveServicePlan's CSRF check rejects the session
  // before it can reach the (human-only) services-edit permission check.
  const saveRes = createRes();
  await authHandlers.saveServicePlan(
    createReq({
      session: workstationSession,
      params: { churchId: context.churchId, planKey: "svc1@2026-09-06" },
      body: {
        serviceId: "svc1",
        date: "2026-09-06",
        name: "Edited by workstation",
        sections: [],
      },
    }),
    saveRes,
  );
  assert.equal(saveRes.statusCode, 403);
});

test("display create then redeem issues a credential", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const context = await createAdminContext("display");
  const createResPayload = await callHandler(
    authHandlers.createDisplayPairing,
    {
      context,
      body: { label: "Auditorium Projector", surfaceType: "projector" },
    },
  );
  assert.equal(createResPayload.statusCode, 200);
  assert.equal(createResPayload.payload?.success, true);
  const pairingToken = createResPayload.payload?.pairing?.token;
  assert.ok(pairingToken);

  const redeemRes = createRes();
  await authHandlers.redeemDisplayPairing(
    createReq({ body: { token: pairingToken } }),
    redeemRes,
  );
  assert.equal(redeemRes.statusCode, 200);
  assert.equal(redeemRes.payload?.success, true);
  assert.ok(redeemRes.payload?.credential);
  assert.ok(redeemRes.payload?.device);
});
