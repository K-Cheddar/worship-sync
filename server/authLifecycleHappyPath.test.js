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
  COLLECTIONS,
  canSeedHumanBearerAuthForServerTests,
  getDoc,
  setDoc,
  seedActiveHumanBearerForServerTests,
  seedPendingInviteForServerTests,
  setSendEmailForServerTests,
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

test("Controller None invite preserves independent permissions through acceptance and bootstrap", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const email = "accept-invitee@example.com";
  const churchId = "happy_invite_accept_church";
  const teamId = "happy_invite_worship_team";
  const secondTeamId = "happy_invite_av_team";
  await setDoc(COLLECTIONS.teams, teamId, {
    teamId,
    churchId,
    name: "Worship",
    memberIds: [],
  });
  await setDoc(COLLECTIONS.teams, secondTeamId, {
    teamId: secondTeamId,
    churchId,
    name: "AV",
    memberIds: [],
  });
  await setDoc(COLLECTIONS.teams, "happy_invite_foreign_team", {
    teamId: "happy_invite_foreign_team",
    churchId: "another_church",
    name: "Foreign team",
    memberIds: [],
  });
  const accessAdminSession = createSession();
  const { humanApiToken: accessAdminToken } =
    await seedActiveHumanBearerForServerTests({
      req: createReq({ session: accessAdminSession }),
      userId: "happy_admin_member_scope_update",
      email: "happy-admin-member-scope-update@example.com",
      churchId,
      role: "admin",
      appAccess: "full",
    });
  const accessAdminMe = createRes();
  await authHandlers.getAuthMe(
    createReq({
      session: accessAdminSession,
      headers: { authorization: `Bearer ${accessAdminToken}` },
    }),
    accessAdminMe,
  );
  const accessAdminContext = {
    churchId,
    session: accessAdminSession,
    headers: {
      authorization: `Bearer ${accessAdminToken}`,
      "x-csrf-token": String(accessAdminMe.payload?.csrfToken || ""),
    },
  };
  let inviteToken = "";
  setSendEmailForServerTests(async (payload) => {
    if (inviteToken) return;
    inviteToken = decodeURIComponent(
      `${payload.textBody} ${payload.htmlBody}`.match(
        /invite\?token=([^&\s"')]+)/,
      )[1],
    );
  });
  const createdInvite = await callHandler(authHandlers.createInvite, {
    context: accessAdminContext,
    params: { churchId },
    body: {
      email,
      role: "member",
      controllerAccess: "none",
      appAccess: "full",
      permissions: {
        teams: "none",
        services: "view",
        teamScopes: { [teamId]: "edit", [secondTeamId]: "edit" },
      },
    },
  });
  assert.equal(createdInvite.statusCode, 200);
  const inviteId = createdInvite.payload?.invite?.inviteId;
  assert.ok(inviteId);
  assert.ok(inviteToken);
  const pendingInvite = await getDoc(COLLECTIONS.invites, inviteId);
  assert.deepEqual(pendingInvite?.permissions, {
    teams: "none",
    services: "view",
    teamScopes: { [teamId]: "edit", [secondTeamId]: "edit" },
  });

  const updatedInvite = await callHandler(authHandlers.updateInviteAccess, {
    context: accessAdminContext,
    params: { inviteId },
    body: {
      role: "member",
      controllerAccess: "none",
      appAccess: "full",
      permissions: {
        teams: "none",
        services: "view",
        teamScopes: {
          [teamId]: "edit",
          [secondTeamId]: "edit",
          "foreign-or-stale-team": "edit",
          happy_invite_foreign_team: "edit",
        },
      },
    },
  });
  assert.equal(updatedInvite.statusCode, 200);
  assert.deepEqual(updatedInvite.payload?.invite?.permissions, {
    teams: "none",
    services: "view",
    teamScopes: { [teamId]: "edit", [secondTeamId]: "edit" },
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
    const session = createSession();
    const res = createRes();
    await authHandlers.acceptInvite(
      createReq({ session, body: { token: inviteToken, idToken: "test-id-token" } }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload?.success, true);
    assert.equal(res.payload?.email, email);
    assert.equal(res.payload?.churchId, churchId);

    const acceptedMembership = await getDoc(
      COLLECTIONS.memberships,
      `${churchId}_firebase_uid_accept_1`,
    );
    assert.deepEqual(acceptedMembership?.permissions, {
      teams: "none",
      services: "view",
      teamScopes: { [teamId]: "edit", [secondTeamId]: "edit" },
    });
    assert.equal(acceptedMembership?.controllerAccess, "none");
    assert.equal(acceptedMembership?.appAccess, "member");
    const memberUpdate = await callHandler(authHandlers.updateMemberAccess, {
      context: accessAdminContext,
      params: { userId: "firebase_uid_accept_1" },
      body: {
        controllerAccess: "none",
        appAccess: "full",
        permissions: {
          teams: "none",
          services: "view",
          teamScopes: {
            [teamId]: "edit",
            [secondTeamId]: "edit",
            "foreign-or-stale-team": "edit",
            happy_invite_foreign_team: "edit",
          },
        },
      },
    });
    assert.equal(memberUpdate.statusCode, 200);
    const updatedMembership = await getDoc(
      COLLECTIONS.memberships,
      `${churchId}_firebase_uid_accept_1`,
    );
    assert.deepEqual(updatedMembership?.permissions, {
      teams: "none",
      services: "view",
      teamScopes: { [teamId]: "edit", [secondTeamId]: "edit" },
    });
    session.auth = {
      sessionKind: "human",
      userId: "firebase_uid_accept_1",
      churchId,
    };
    const bootstrapRes = createRes();
    await authHandlers.getAuthMe(createReq({ session }), bootstrapRes);
    assert.deepEqual(bootstrapRes.payload?.permissions, {
      teams: "none",
      services: "view",
      teamScopes: { [teamId]: "edit", [secondTeamId]: "edit" },
    });
    assert.equal(bootstrapRes.payload?.controllerAccess, "none");
    assert.equal(bootstrapRes.payload?.appAccess, "member");
    const unchecked = await callHandler(authHandlers.updateMemberAccess, {
      context: accessAdminContext,
      params: { userId: "firebase_uid_accept_1" },
      body: {
        appAccess: "member",
        permissions: { teams: "none", services: "none", teamScopes: {} },
      },
    });
    assert.equal(unchecked.statusCode, 200);
    assert.deepEqual(
      (await getDoc(
        COLLECTIONS.memberships,
        `${churchId}_firebase_uid_accept_1`,
      ))?.permissions,
      { teams: "none", services: "none", teamScopes: {} },
    );
  } finally {
    setVerifyIdTokenForServerTests(null);
    setSendEmailForServerTests(null);
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
      sections: [
        {
          id: "worship",
          name: "Worship",
          elements: [
            {
              id: "welcome",
              type: "free",
              title: { blocks: [{ type: "paragraph", spans: [{ text: "Welcome" }] }] },
              assignedName: "Avery Volunteer",
              assignedMemberId: "member-1",
              assignees: [
                { id: "assignee-1", name: "Avery Volunteer", memberId: "member-1" },
              ],
            },
          ],
        },
      ],
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
  // Default pairing: no Teams roster access (member PII), read-only Service Plans.
  assert.deepEqual(redeemRes.payload?.bootstrap?.permissions, {
    teams: "none",
    services: "view",
    teamScopes: {},
  });
  assert.equal(
    redeemRes.payload?.bootstrap?.device?.serviceWorkspaceAccess,
    false,
  );

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
  const planElement = getRes.payload?.servicePlan?.sections?.[0]?.elements?.[0];
  assert.equal(planElement?.assignees, undefined);
  assert.equal(planElement?.assignedName, undefined);
  assert.equal(planElement?.assignedMemberId, undefined);

  const assignmentsRes = createRes();
  await authHandlers.getServicePlanAssignments(
    createReq({
      session: workstationSession,
      params: { churchId: context.churchId, planKey: "svc1@2026-09-06" },
    }),
    assignmentsRes,
  );
  assert.equal(assignmentsRes.statusCode, 200);
  assert.deepEqual(assignmentsRes.payload?.assignments, []);

  // Default workstations cannot edit plans (no booth grant), even with CSRF.
  const saveRes = createRes();
  await authHandlers.saveServicePlan(
    createReq({
      session: workstationSession,
      headers: {
        "x-csrf-token": String(redeemRes.payload?.bootstrap?.csrfToken || ""),
      },
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

  const teamsBootstrapRes = createRes();
  await authHandlers.getTeamsBootstrap(
    createReq({
      session: workstationSession,
      params: { churchId: context.churchId },
    }),
    teamsBootstrapRes,
  );
  assert.equal(teamsBootstrapRes.statusCode, 403);
});

test("a booth workstation can edit service plans and load Teams view data", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const context = await createAdminContext("ws_booth");
  const saved = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey: "svc1@2026-09-07" },
    body: {
      serviceId: "svc1",
      date: "2026-09-07",
      name: "Sunday Service",
      sections: [],
    },
  });
  assert.equal(saved.statusCode, 200);

  const createResPayload = await callHandler(
    authHandlers.createWorkstationPairing,
    {
      context,
      body: {
        label: "Booth PC",
        appAccess: "full",
        platformType: "web",
        serviceWorkspaceAccess: true,
      },
    },
  );
  const pairingToken = createResPayload.payload?.pairing?.token;
  assert.ok(pairingToken);
  assert.equal(createResPayload.payload?.pairing?.serviceWorkspaceAccess, true);

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
  assert.deepEqual(redeemRes.payload?.bootstrap?.permissions, {
    teams: "view",
    services: "edit",
    teamScopes: {},
  });
  assert.equal(
    redeemRes.payload?.bootstrap?.device?.serviceWorkspaceAccess,
    true,
  );

  const csrf = String(redeemRes.payload?.bootstrap?.csrfToken || "");
  assert.ok(csrf);

  const saveRes = createRes();
  await authHandlers.saveServicePlan(
    createReq({
      session: workstationSession,
      headers: { "x-csrf-token": csrf },
      params: { churchId: context.churchId, planKey: "svc1@2026-09-07" },
      body: {
        serviceId: "svc1",
        date: "2026-09-07",
        name: "Edited on booth",
        sections: [],
        baseRevision: saved.payload?.servicePlan?.revision ?? 1,
      },
    }),
    saveRes,
  );
  assert.equal(saveRes.statusCode, 200);
  assert.equal(saveRes.payload?.servicePlan?.name, "Edited on booth");
  assert.match(
    String(saveRes.payload?.servicePlan?.updatedByUid || ""),
    /^workstation:/,
  );

  const teamsBootstrapRes = createRes();
  await authHandlers.getTeamsBootstrap(
    createReq({
      session: workstationSession,
      params: { churchId: context.churchId },
    }),
    teamsBootstrapRes,
  );
  assert.equal(teamsBootstrapRes.statusCode, 200);
  assert.equal(teamsBootstrapRes.payload?.success, true);

  // Mic chips: booth may write assignment maps without Teams edit.
  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Worship", memberIds: [] },
  });
  const teamId = team.payload.team.teamId;
  await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId },
    body: { name: "Worship", memberIds: [], usesMicrophoneAssignments: true },
  });
  await callHandler(authHandlers.saveServicePlanMicrophones, {
    context,
    body: {
      microphones: [
        {
          id: "mic-lead",
          name: "Lead vocal",
          type: "Handheld",
          color: "#22d3ee",
        },
      ],
      audiences: [],
    },
  });
  const position = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Lead", teamId, defaultMicrophoneId: "mic-lead" },
  });
  const positionId = position.payload.position.positionId;
  const occurrenceId = "svc1@2026-09-07T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "September",
      teamId,
      startDate: "2026-09-07",
      endDate: "2026-09-07",
      serviceIds: ["svc1"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc1",
          name: "Sunday",
          startsAt: "2026-09-07T10:00:00.000Z",
          positionRequirements: [{ positionId, count: 1 }],
        },
      ],
    },
  });
  assert.equal(schedule.statusCode, 200);
  const scheduleId = schedule.payload.schedule.scheduleId;

  const micRes = createRes();
  await authHandlers.updateTeamScheduleAssignmentMicrophones(
    createReq({
      session: workstationSession,
      headers: { "x-csrf-token": csrf },
      params: { churchId: context.churchId, scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${positionId}::0`,
        microphoneIds: ["mic-lead"],
      },
    }),
    micRes,
  );
  assert.equal(micRes.statusCode, 200);
  assert.deepEqual(
    micRes.payload?.schedule?.microphoneAssignments?.[occurrenceId]?.[
      `${positionId}::0`
    ],
    ["mic-lead"],
  );
  assert.match(
    String(micRes.payload?.schedule?.updatedByUid || ""),
    /^workstation:/,
  );

  // Still no general Teams edit (e.g. create schedule) from the booth.
  const blockedSchedule = createRes();
  await authHandlers.createTeamSchedule(
    createReq({
      session: workstationSession,
      headers: { "x-csrf-token": csrf },
      params: { churchId: context.churchId },
      body: {
        name: "Should fail",
        teamId,
        startDate: "2026-09-14",
        endDate: "2026-09-14",
        serviceIds: ["svc1"],
        occurrences: [
          {
            occurrenceId: "svc1@2026-09-14T10:00:00.000Z",
            serviceId: "svc1",
            name: "Sunday",
            startsAt: "2026-09-14T10:00:00.000Z",
            positionRequirements: [{ positionId, count: 1 }],
          },
        ],
      },
    }),
    blockedSchedule,
  );
  assert.ok(
    blockedSchedule.statusCode === 401 || blockedSchedule.statusCode === 403,
    `expected auth denial, got ${blockedSchedule.statusCode}`,
  );
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

test("bootstrap normalizes legacy appAccess and prefers explicit controllerAccess", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  for (const [index, appAccess, expected] of [
    [0, "member", "none"],
    [1, "view", "view"],
    [2, "music", "music"],
    [3, "full", "full"],
  ]) {
    const userId = `legacy_access_${index}`;
    const churchId = `legacy_access_church_${index}`;
    const session = createSession();
    const { humanApiToken } = await seedActiveHumanBearerForServerTests({
      req: createReq({ session }),
      userId,
      email: `legacy-${index}@example.com`,
      churchId,
      role: "member",
      appAccess,
      permissions: {
        teams: "none",
        services: "view",
        teamScopes: { worship: "edit" },
      },
    });
    if (index === 0) {
      await setDoc(COLLECTIONS.memberships, `${churchId}_${userId}`, {
        controllerAccess: "none",
        appAccess: "full",
      }, { merge: true });
    }
    const bootstrap = createRes();
    await authHandlers.getAuthMe(createReq({
      session,
      headers: { authorization: `Bearer ${humanApiToken}` },
    }), bootstrap);
    assert.equal(bootstrap.statusCode, 200);
    assert.equal(bootstrap.payload?.controllerAccess, expected);
    assert.deepEqual(bootstrap.payload?.permissions, {
      teams: "none",
      services: "view",
      teamScopes: { worship: "edit" },
    });
    if (index === 0) assert.equal(bootstrap.payload?.appAccess, "member");
  }

  const adminUserId = "legacy_access_admin";
  const adminChurchId = "legacy_access_admin_church";
  const adminSession = createSession();
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req: createReq({ session: adminSession }),
    userId: adminUserId,
    email: "legacy-admin@example.com",
    churchId: adminChurchId,
    role: "admin",
    controllerAccess: "none",
    permissions: { teams: "none", services: "none", teamScopes: { worship: "edit" } },
  });
  const adminBootstrap = createRes();
  await authHandlers.getAuthMe(createReq({
    session: adminSession,
    headers: { authorization: `Bearer ${humanApiToken}` },
  }), adminBootstrap);
  assert.equal(adminBootstrap.payload?.controllerAccess, "full");
  assert.deepEqual(adminBootstrap.payload?.permissions, {
    teams: "edit",
    services: "edit",
    teamScopes: {},
  });
});
