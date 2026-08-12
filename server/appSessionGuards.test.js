import assert from "node:assert/strict";
import test from "node:test";

import { createAppSessionGuards } from "./appSessionGuards.js";

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
  };
  return res;
};

const runMiddleware = async (middleware, req) => {
  const res = createRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled, req };
};

test("requireAppSession allows authenticated non-display sessions with a database", async () => {
  const { requireAppSession } = createAppSessionGuards({
    resolveRequestBootstrap: async () => ({
      authenticated: true,
      sessionKind: "human",
      database: "rtdb_church_1",
      appAccess: "full",
      churchId: "church_1",
      user: { uid: "user_1", displayName: "Ada" },
    }),
  });

  const { res, nextCalled, req } = await runMiddleware(requireAppSession, {});
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.appSession.userId, "user_1");
  assert.equal(req.appSession.actorId, "user_1");
  assert.equal(req.appSession.username, "Ada");
  assert.equal(req.appSession.sessionKind, "human");
  assert.equal(req.appSession.access, "full");
  assert.equal(req.appSession.churchId, "church_1");
});

test("requireAppSession derives workstation chat identity from the device", async () => {
  const { requireAppSession } = createAppSessionGuards({
    resolveRequestBootstrap: async () => ({
      authenticated: true,
      sessionKind: "workstation",
      database: "rtdb_church_1",
      appAccess: "music",
      churchId: "church_1",
      role: "member",
      device: {
        deviceId: "workstation_1",
        operatorName: "Jordan",
        label: "Sanctuary",
      },
    }),
  });

  const { nextCalled, req } = await runMiddleware(requireAppSession, {});
  assert.equal(nextCalled, true);
  assert.equal(req.appSession.actorId, "workstation_1");
  assert.equal(req.appSession.username, "Jordan");
  assert.equal(req.appSession.sessionKind, "workstation");
});

test("requireMutationCsrf verifies mutating app requests", async () => {
  let checkedRequest = null;
  const guards = createAppSessionGuards({
    resolveRequestBootstrap: async () => null,
    assertRequestCsrf: async (req) => {
      checkedRequest = req;
    },
  });
  const req = { headers: { "x-csrf-token": "token" } };
  const allowed = await runMiddleware(guards.requireMutationCsrf, req);
  assert.equal(allowed.nextCalled, true);
  assert.equal(checkedRequest, req);

  const deniedGuards = createAppSessionGuards({
    resolveRequestBootstrap: async () => null,
    assertRequestCsrf: async () => {
      const error = new Error("Could not verify this request.");
      error.statusCode = 403;
      throw error;
    },
  });
  const denied = await runMiddleware(deniedGuards.requireMutationCsrf, req);
  assert.equal(denied.res.statusCode, 403);
  assert.deepEqual(denied.res.payload, {
    error: "Could not verify this request.",
  });
});

test("requireAppSession rejects unauthenticated and display sessions", async () => {
  const unauth = createAppSessionGuards({
    resolveRequestBootstrap: async () => ({ authenticated: false }),
  });
  const display = createAppSessionGuards({
    resolveRequestBootstrap: async () => ({
      authenticated: true,
      sessionKind: "display",
      database: "rtdb_church_1",
    }),
  });
  const noDb = createAppSessionGuards({
    resolveRequestBootstrap: async () => ({
      authenticated: true,
      sessionKind: "human",
      database: "",
    }),
  });
  const boom = createAppSessionGuards({
    resolveRequestBootstrap: async () => {
      throw new Error("bootstrap failed");
    },
  });

  for (const guards of [unauth, display, noDb, boom]) {
    const { res, nextCalled } = await runMiddleware(
      guards.requireAppSession,
      {},
    );
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.match(String(res.payload?.error || ""), /sign in/i);
  }
});

test("requireFullAppAccess allows full and blocks view", async () => {
  const { requireFullAppAccess } = createAppSessionGuards({
    resolveRequestBootstrap: async () => ({}),
  });

  const allowed = await runMiddleware(requireFullAppAccess, {
    appSession: { access: "full" },
  });
  assert.equal(allowed.nextCalled, true);

  const blocked = await runMiddleware(requireFullAppAccess, {
    appSession: { access: "view" },
  });
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 403);
  assert.match(String(blocked.res.payload?.error || ""), /full access/i);
});

test("requireChurchAdmin allows admins and blocks other church members", async () => {
  const { requireChurchAdmin } = createAppSessionGuards({
    resolveRequestBootstrap: async () => ({}),
  });

  const allowed = await runMiddleware(requireChurchAdmin, {
    appSession: { role: "admin" },
  });
  assert.equal(allowed.nextCalled, true);

  const blocked = await runMiddleware(requireChurchAdmin, {
    appSession: { role: "member" },
  });
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 403);
  assert.match(String(blocked.res.payload?.error || ""), /church admin/i);
});

test("requireSongAudioEditAccess allows full and music, blocks view", async () => {
  const { requireSongAudioEditAccess } = createAppSessionGuards({
    resolveRequestBootstrap: async () => ({}),
  });

  for (const access of ["full", "music"]) {
    const result = await runMiddleware(requireSongAudioEditAccess, {
      appSession: { access },
    });
    assert.equal(result.nextCalled, true);
  }

  const blocked = await runMiddleware(requireSongAudioEditAccess, {
    appSession: { access: "view" },
  });
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 403);
  assert.match(String(blocked.res.payload?.error || ""), /music access/i);
});

test("assertSongAudioChurchAccess enforces church match", () => {
  const { assertSongAudioChurchAccess } = createAppSessionGuards({
    resolveRequestBootstrap: async () => ({}),
  });

  const okRes = createRes();
  assert.equal(
    assertSongAudioChurchAccess(
      {
        appSession: { churchId: "church_1" },
        params: { churchId: "church_1" },
      },
      okRes,
    ),
    true,
  );
  assert.equal(okRes.statusCode, 200);

  const badRes = createRes();
  assert.equal(
    assertSongAudioChurchAccess(
      { appSession: { churchId: "church_1" }, params: { churchId: "other" } },
      badRes,
    ),
    false,
  );
  assert.equal(badRes.statusCode, 403);
  assert.match(String(badRes.payload?.error || ""), /church is not available/i);
});
