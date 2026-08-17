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

test("display pairing carries the display output onto the device", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const context = await createAdminContext("display_output");
  const created = await callHandler(authHandlers.createDisplayPairing, {
    context,
    body: {
      label: "Lobby Projector",
      surfaceType: "projector",
      outputId: "out_lobby",
    },
  });
  assert.equal(created.statusCode, 200);

  const redeemRes = createRes();
  await authHandlers.redeemDisplayPairing(
    createReq({ body: { token: created.payload?.pairing?.token } }),
    redeemRes,
  );
  assert.equal(redeemRes.statusCode, 200);
  assert.equal(redeemRes.payload?.device?.outputId, "out_lobby");
});

test("display pairing without an output leaves the screen unbound", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const context = await createAdminContext("display_no_output");
  const created = await callHandler(authHandlers.createDisplayPairing, {
    context,
    body: { label: "Main Projector", surfaceType: "projector" },
  });
  const redeemRes = createRes();
  await authHandlers.redeemDisplayPairing(
    createReq({ body: { token: created.payload?.pairing?.token } }),
    redeemRes,
  );
  assert.equal(redeemRes.statusCode, 200);
  assert.equal(redeemRes.payload?.device?.outputId ?? null, null);
});

test("display pairing rejects a malformed output id", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const context = await createAdminContext("display_bad_output");
  const created = await callHandler(authHandlers.createDisplayPairing, {
    context,
    body: {
      label: "Bad Projector",
      surfaceType: "projector",
      outputId: "../../etc/passwd",
    },
  });
  assert.equal(created.statusCode, 400);
});
