process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
// Force the in-memory auth store so this integration suite runs in every
// environment. Locally a developer's .env Firebase credentials would otherwise
// flip canSeedHumanBearerAuthForServerTests() to false and skip every test. We
// set the vars to empty (not delete) so the `import "dotenv/config"` inside
// authService.js cannot repopulate them from .env.
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
// Same treatment for Resend, and for the same reason: with a developer's real
// key loaded from .env this suite makes live API calls to a third party — slow,
// flaky, and capable of actually mailing someone. Blank means `sendEmail` logs
// instead of sending, which is what a test should exercise.
process.env.RESEND_API_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { smsConsentIdForChurchPhone } from "./smsConsent.js";
import { isPublicSharePathname } from "../client/src/utils/publicSharePathRedirect.ts";

import { addTeamsSseClient, removeTeamsSseClient } from "../server/teamsSse.js";
import {
  addServiceFlowSseClient,
  removeServiceFlowSseClient,
} from "../server/serviceFlowSse.js";

const {
  authHandlers,
  COLLECTIONS,
  canSeedHumanBearerAuthForServerTests,
  getDoc,
  seedActiveHumanBearerForServerTests,
  seedChurchServiceTimesForServerTests,
  seedSmsConsentForServerTests,
  queryDocs,
  resolveRequestBootstrap,
  assertServerCsrf,
  recoverPendingIntakeSubmissionDigests,
  setIntakeDigestSchedulingFailureForServerTests,
  setIntakeNotifyRecipientsForServerTests,
  setSendEmailForServerTests,
  setAuthReadObserverForServerTests,
  setDoc,
} = await import("../authService.js");
import { createAppSessionGuards } from "./appSessionGuards.js";
import {
  createFakeSmsProvider,
  setSmsProviderForServerTests,
} from "./smsProvider.js";

// Minimal stand-in for an SSE response: captures the `data:` frames the teams
// broadcaster writes. Shares the same teamsSse.js singleton the handlers use.
const createSseClient = () => {
  const writes = [];
  return {
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
    events() {
      return writes
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice("data: ".length).trim()));
    },
  };
};

const createSession = () => ({
  destroy(callback) {
    callback?.();
  },
});

// Assignment cells are object-shaped: { primaryMemberId, shadows }.
const getMemberId = (cell) => cell?.primaryMemberId || "";

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
    send(payload) {
      this.body = payload;
      return this;
    },
    set() {
      return this;
    },
    clearCookie() {
      return this;
    },
  };
  return res;
};

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

const skipUnlessInMemoryAuth = (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("Teams API tests seed in-memory auth only.");
    return true;
  }
  return false;
};

const createHumanContext = async (
  suffix,
  {
    userId = `teams_api_admin_${suffix}`,
    email = `teams-api-${suffix}@example.com`,
    churchId = `teams_api_church_${suffix}`,
    role = "admin",
    appAccess = "full",
    permissions,
  } = {},
) => {
  const session = createSession();
  const seedReq = createReq({ session });
  const { humanApiToken, churchId: seededChurchId } =
    await seedActiveHumanBearerForServerTests({
      req: seedReq,
      userId,
      email,
      churchId,
      role,
      appAccess,
      permissions,
    });
  const meRes = createRes();
  await authHandlers.getAuthMe(
    createReq({
      session,
      headers: { authorization: `Bearer ${humanApiToken}` },
    }),
    meRes,
  );
  return {
    churchId: seededChurchId,
    headers: {
      authorization: `Bearer ${humanApiToken}`,
      "x-csrf-token": String(meRes.payload?.csrfToken || ""),
    },
    session,
  };
};

const createAdminContext = async (suffix) => createHumanContext(suffix);

test("restored paired workstation can reach the Canva imports mutation guard", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;

  const humanContext = await createAdminContext("workstation_csrf_restore");
  const pairing = await callHandler(authHandlers.createWorkstationPairing, {
    context: humanContext,
    body: {
      label: "Canva import workstation",
      platformType: "web",
      appAccess: "full",
    },
  });
  assert.equal(pairing.statusCode, 200);
  const pairedSession = createSession();
  const redeemed = createRes();
  await authHandlers.redeemWorkstationPairing(
    createReq({
      session: pairedSession,
      body: { token: pairing.payload.pairing.token, platformType: "web" },
    }),
    redeemed,
  );
  assert.equal(redeemed.statusCode, 200);
  const workstationToken = redeemed.payload.credential;

  const guards = createAppSessionGuards({
    resolveRequestBootstrap,
    assertRequestCsrf: assertServerCsrf,
  });
  const restoredSession = {
    auth: { sessionKind: "workstation", deviceId: "stale-device" },
    csrfToken: "stale-csrf-token",
    regenerate(callback) {
      delete this.auth;
      delete this.csrfToken;
      callback();
    },
  };
  const restoredReq = createReq({
    params: { churchId: humanContext.churchId },
    headers: {
      "x-workstation-token": workstationToken,
      "x-csrf-token": "stale-csrf-token",
    },
    session: restoredSession,
  });
  restoredReq.originalUrl = `/api/churches/${humanContext.churchId}/canva/imports`;

  let canvaImportRouteReached = false;
  const res = createRes();
  const invoke = async (middleware, req = restoredReq, response = res) => {
    let nextCalled = false;
    await middleware(req, response, (error) => {
      assert.equal(error, undefined);
      nextCalled = true;
    });
    return nextCalled;
  };

  assert.equal(await invoke(guards.requireAppSession), true);
  assert.equal(restoredReq.appSession.sessionKind, "workstation");
  assert.equal(restoredReq.appSession.workstationTokenProvided, true);
  assert.equal(restoredSession.csrfToken === "stale-csrf-token", false);
  assert.equal(await invoke(guards.requireFullAppAccess), true);
  canvaImportRouteReached = await invoke(guards.requireMutationCsrf);
  assert.equal(canvaImportRouteReached, true);

  // A paired workstation's cookie remains CSRF protected when the explicit
  // workstation credential is absent.
  const cookieOnlyReq = createReq({
    headers: {},
    session: { ...restoredSession, csrfToken: "current-csrf" },
  });
  cookieOnlyReq.session.auth = {
    sessionKind: "workstation",
    churchId: humanContext.churchId,
    deviceId: restoredSession.auth.deviceId,
    issuedAt: Date.now(),
  };
  const cookieOnlyRes = createRes();
  const cookieOnlyAuthenticated = await invoke(
    guards.requireAppSession,
    cookieOnlyReq,
    cookieOnlyRes,
  );
  const cookieOnlyNextCalled = await invoke(
    guards.requireMutationCsrf,
    cookieOnlyReq,
    cookieOnlyRes,
  );
  assert.equal(cookieOnlyAuthenticated, true);
  assert.equal(cookieOnlyNextCalled, false);
  assert.equal(cookieOnlyRes.statusCode, 403);

  // Human bearer credentials retain precedence when both credentials are sent.
  const mixedHeaders = {
    ...humanContext.headers,
    "x-workstation-token": workstationToken,
  };
  const mixedReq = createReq({
    params: { churchId: humanContext.churchId },
    headers: mixedHeaders,
    session: humanContext.session,
  });
  const mixedRes = createRes();
  assert.equal(await invoke(guards.requireAppSession, mixedReq, mixedRes), true);
  assert.equal(mixedReq.appSession.sessionKind, "human");
  assert.equal(
    await invoke(guards.requireMutationCsrf, mixedReq, mixedRes),
    true,
  );

  delete mixedReq.headers["x-csrf-token"];
  const mixedMissingCsrfRes = createRes();
  const mixedMissingCsrfNextCalled = await invoke(
    guards.requireMutationCsrf,
    mixedReq,
    mixedMissingCsrfRes,
  );
  assert.equal(mixedMissingCsrfNextCalled, false);
  assert.equal(mixedMissingCsrfRes.statusCode, 403);
});

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

const previewMemberCsv = async (context, csv, settings = {}) => {
  const inspected = await callHandler(authHandlers.inspectPortableImport, {
    context, body: { type: "members", csv },
  });
  const preview = await callHandler(authHandlers.previewPortableImport, {
    context, body: { type: "members", csv, mapping: inspected.payload.mapping, ...settings },
  });
  return { ...preview, previewCsv: csv, previewCsvHash: hashPortableCsv(csv), mapping: inspected.payload.mapping };
};
const hashPortableCsv = (csv) => createHash("sha256").update(csv).digest("hex");

// positions are team-owned, so set up a team first, then its positions (with teamId),
// then members, then attach the members to the team roster.
const seedTeam = async (
  context,
  { teamName = "Team", positions = [], members = [] } = {},
) => {
  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: teamName, memberIds: [] },
  });
  const teamId = team.payload.team.teamId;
  const positionIds = {};
  for (const position of positions) {
    const res = await callHandler(authHandlers.createTeamPosition, {
      context,
      body: { name: position.name, icon: position.icon, teamId },
    });
    positionIds[position.name] = res.payload.position.positionId;
  }
  const memberIds = {};
  for (const member of members) {
    const res = await callHandler(authHandlers.createTeamRosterMember, {
      context,
      body: {
        firstName: member.firstName,
        lastName: member.lastName,
        positionIds: (member.positions || []).map((name) => positionIds[name]),
        blockoutDates: member.blockoutDates || [],
        recurringAvailability: member.recurringAvailability,
      },
    });
    memberIds[member.firstName] = res.payload.member.memberId;
  }
  if (Object.keys(memberIds).length > 0) {
    await callHandler(authHandlers.updateTeam, {
      context,
      params: { teamId },
      body: { name: teamName, memberIds: Object.values(memberIds) },
    });
  }
  return { teamId, positionIds, memberIds };
};

test("getTeamsBootstrap requires an authenticated Teams session", async () => {
  const res = createRes();
  await authHandlers.getTeamsBootstrap(
    createReq({ params: { churchId: "church_test" } }),
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload?.success, false);
});

test("team mutation responses preserve the stable CSRF mismatch code", async () => {
  const res = createRes();
  await authHandlers.createTeam(
    createReq({
      params: { churchId: "church_test" },
      session: {
        ...createSession(),
        auth: { sessionKind: "workstation" },
        csrfToken: "expected-csrf",
      },
      body: { name: "Blocked Team", memberIds: [] },
    }),
    res,
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload?.errorMessage, "Could not verify this request.");
  assert.equal(res.payload?.code, "AUTH_CSRF_MISMATCH");
});

test("teams bootstrap allows view permission but mutations require edit", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const adminContext = await createAdminContext("permissions");
  await callHandler(authHandlers.createTeam, {
    context: adminContext,
    body: { name: "Sunday Team", memberIds: [] },
  });

  const viewerContext = await createHumanContext("permissions_viewer", {
    userId: "teams_api_viewer_permissions",
    email: "teams-api-viewer-permissions@example.com",
    churchId: adminContext.churchId,
    role: "member",
    appAccess: "view",
    permissions: { teams: "view" },
  });

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context: viewerContext,
  });
  assert.equal(bootstrap.statusCode, 200);
  assert.equal(bootstrap.payload.success, true);
  assert.equal(bootstrap.payload.teams.length, 1);

  const create = await callHandler(authHandlers.createTeam, {
    context: viewerContext,
    body: { name: "Blocked Team", memberIds: [] },
  });
  assert.equal(create.statusCode, 403);
  assert.equal(create.payload.success, false);
});

test("generated schedule ensure reuses a compatible custom schedule", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("generated_schedule_ensure");
  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Media",
    positions: [{ name: "Camera" }],
    members: [
      { firstName: "Alex", lastName: "Rivera", positions: ["Camera"] },
      { firstName: "Blair", lastName: "Rivera", positions: ["Camera"] },
    ],
  });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "service-sabbath",
        name: "Sabbath Service",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
        positionRequirements: [
          { positionId: positionIds.Camera, count: 3, minLevelId: "lead" },
        ],
      },
    ],
  });
  const body = {
    name: "October 2026",
    teamId,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    timeZone: "UTC",
    serviceIds: ["service-sabbath"],
    occurrences: [
      {
        occurrenceId: "service-sabbath@2026-10-03T10:00:00.000Z",
        serviceId: "service-sabbath",
        name: "Sabbath Service",
        startsAt: "2026-10-03T10:00:00.000Z",
        positionRequirements: [{ positionId: positionIds.Camera, count: 2 }],
      },
    ],
  };
  const [first, second] = await Promise.all([
    callHandler(authHandlers.ensureTeamScheduleForPeriod, { context, body }),
    callHandler(authHandlers.ensureTeamScheduleForPeriod, { context, body }),
  ]);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(
    first.payload.schedule.scheduleId,
    second.payload.schedule.scheduleId,
  );
  assert.equal(first.payload.schedule.source, "generated-period");
  assert.deepEqual(first.payload.schedule.occurrences[0].positionRequirements, [
    { positionId: positionIds.Camera, count: 3, minLevelId: "lead" },
  ]);
  const schedules = await queryDocs("teamSchedules", [
    { field: "churchId", value: context.churchId },
  ]);
  assert.equal(
    schedules.filter((schedule) => schedule.generatedPeriodKey).length,
    1,
  );
  const assignment = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: first.payload.schedule.scheduleId },
      body: {
        serviceId: body.occurrences[0].occurrenceId,
        positionSlotKey: `${positionIds.Camera}::0`,
        memberId: memberIds.Alex,
        serviceDate: "2026-10-03",
      },
    },
  );
  assert.equal(assignment.statusCode, 200);
  assert.equal(
    assignment.payload.schedule.assignments[body.occurrences[0].occurrenceId][
      `${positionIds.Camera}::0`
    ].primaryMemberId,
    memberIds.Alex,
  );

  const equivalentLegacyId = "legacy-equivalent-october";
  await setDoc("teamSchedules", equivalentLegacyId, {
    ...first.payload.schedule,
    scheduleId: equivalentLegacyId,
    source: undefined,
    generatedPeriodKey: undefined,
  });
  const preferred = await callHandler(
    authHandlers.ensureTeamScheduleForPeriod,
    {
      context,
      body,
    },
  );
  assert.equal(preferred.statusCode, 200);
  assert.equal(
    preferred.payload.schedule.scheduleId,
    first.payload.schedule.scheduleId,
  );

  const otherTeam = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Audio", memberIds: [] },
  });
  const metadataUpdate = await callHandler(authHandlers.updateTeamSchedule, {
    context,
    params: { scheduleId: first.payload.schedule.scheduleId },
    body: {
      ...body,
      description: "Metadata remains editable.",
      assignments: assignment.payload.schedule.assignments,
      microphoneAssignments: assignment.payload.schedule.microphoneAssignments,
      iemAssignments: assignment.payload.schedule.iemAssignments,
      additionalPositionSlots:
        assignment.payload.schedule.additionalPositionSlots,
    },
  });
  assert.equal(metadataUpdate.statusCode, 200);
  assert.equal(
    metadataUpdate.payload.schedule.description,
    "Metadata remains editable.",
  );
  assert.equal(
    metadataUpdate.payload.schedule.generatedPeriodKey,
    first.payload.schedule.generatedPeriodKey,
  );

  const hiddenOccurrence = {
    occurrenceId: "hidden-sabbath@2026-10-10T10:00:00.000Z",
    serviceId: "service-sabbath",
    name: "Hidden Sabbath Service",
    startsAt: "2026-10-10T10:00:00.000Z",
    positionRequirements: [{ positionId: positionIds.Camera, count: 1 }],
  };
  const persistedBeforeBatch = await getDoc(
    "teamSchedules",
    metadataUpdate.payload.schedule.scheduleId,
  );
  const preservedMicrophoneAssignments = {
    [body.occurrences[0].occurrenceId]: {
      [`${positionIds.Camera}::0`]: ["microphone-existing"],
    },
  };
  const preservedIemAssignments = {
    [body.occurrences[0].occurrenceId]: {
      [`${positionIds.Camera}::0`]: ["iem-existing"],
    },
  };
  const preservedAdditionalSlots = {
    [body.occurrences[0].occurrenceId]: [`${positionIds.Camera}::2`],
  };
  await setDoc("teamSchedules", metadataUpdate.payload.schedule.scheduleId, {
    occurrences: [...persistedBeforeBatch.occurrences, hiddenOccurrence],
    assignments: {
      ...persistedBeforeBatch.assignments,
      [hiddenOccurrence.occurrenceId]: {
        [`${positionIds.Camera}::0`]: { primaryMemberId: memberIds.Alex },
      },
    },
    microphoneAssignments: preservedMicrophoneAssignments,
    iemAssignments: preservedIemAssignments,
    additionalPositionSlots: preservedAdditionalSlots,
  }, { merge: true });

  const batchAssignment = await callHandler(
    authHandlers.updateTeamScheduleAssignmentsBatch,
    {
      context,
      params: { scheduleId: metadataUpdate.payload.schedule.scheduleId },
      body: {
        changes: [{
          serviceId: body.occurrences[0].occurrenceId,
          positionSlotKey: `${positionIds.Camera}::1`,
          serviceDate: "2026-10-03",
          expectedCell: "",
          assignment: { primaryMemberId: memberIds.Blair },
        }],
      },
    },
  );
  assert.equal(batchAssignment.statusCode, 200);
  assert.deepEqual(
    batchAssignment.payload.schedule.occurrences.map((item) => item.occurrenceId),
    [body.occurrences[0].occurrenceId, hiddenOccurrence.occurrenceId],
  );
  assert.deepEqual(
    batchAssignment.payload.schedule.assignments[hiddenOccurrence.occurrenceId],
    { [`${positionIds.Camera}::0`]: { primaryMemberId: memberIds.Alex } },
  );
  assert.equal(
    batchAssignment.payload.schedule.assignments[body.occurrences[0].occurrenceId][`${positionIds.Camera}::1`].primaryMemberId,
    memberIds.Blair,
  );
  assert.deepEqual(batchAssignment.payload.schedule.microphoneAssignments, preservedMicrophoneAssignments);
  assert.deepEqual(batchAssignment.payload.schedule.iemAssignments, preservedIemAssignments);
  assert.deepEqual(batchAssignment.payload.schedule.additionalPositionSlots, preservedAdditionalSlots);

  const generatedSchedule = metadataUpdate.payload.schedule;
  const updateBody = {
    name: generatedSchedule.name,
    description: generatedSchedule.description,
    teamId: generatedSchedule.teamId,
    startDate: generatedSchedule.startDate,
    endDate: generatedSchedule.endDate,
    serviceIds: generatedSchedule.serviceIds,
    occurrences: generatedSchedule.occurrences,
    assignments: generatedSchedule.assignments,
  };
  const changedTeam = await callHandler(authHandlers.updateTeamSchedule, {
    context,
    params: { scheduleId: generatedSchedule.scheduleId },
    body: { ...updateBody, teamId: otherTeam.payload.team.teamId },
  });
  assert.equal(changedTeam.statusCode, 409);
  const changedRange = await callHandler(authHandlers.updateTeamSchedule, {
    context,
    params: { scheduleId: generatedSchedule.scheduleId },
    body: { ...updateBody, startDate: "2026-11-01", endDate: "2026-11-30" },
  });
  assert.equal(changedRange.statusCode, 409);
  const changedServices = await callHandler(authHandlers.updateTeamSchedule, {
    context,
    params: { scheduleId: generatedSchedule.scheduleId },
    body: { ...updateBody, serviceIds: ["service-sabbath", "another-service"] },
  });
  assert.equal(changedServices.statusCode, 409);
  const changedOccurrences = await callHandler(
    authHandlers.updateTeamSchedule,
    {
      context,
      params: { scheduleId: generatedSchedule.scheduleId },
      body: {
        ...updateBody,
        occurrences: generatedSchedule.occurrences.map((occurrence) => ({
          ...occurrence,
          occurrenceId: "unrelated-occurrence",
        })),
      },
    },
  );
  assert.equal(changedOccurrences.statusCode, 409);

  const legacyContext = await createAdminContext(
    "generated_schedule_legacy_reuse",
  );
  const legacyTeam = await seedTeam(legacyContext, { teamName: "Media" });
  seedChurchServiceTimesForServerTests({
    churchId: legacyContext.churchId,
    services: [
      {
        id: "service-sabbath",
        name: "Sabbath Service",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
      },
    ],
  });
  const legacy = await callHandler(authHandlers.createTeamSchedule, {
    context: legacyContext,
    body: { ...body, teamId: legacyTeam.teamId },
  });
  const reused = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context: legacyContext,
    body: { ...body, teamId: legacyTeam.teamId },
  });
  assert.equal(reused.statusCode, 200);
  assert.equal(reused.payload.created, false);
  assert.equal(
    reused.payload.schedule.scheduleId,
    legacy.payload.schedule.scheduleId,
  );
  assert.equal(reused.payload.schedule.source, "custom");
});

test("generated schedule ensure keeps a partial populated custom schedule as an alternate", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("generated_schedule_custom_populated_reuse");
  const { teamId } = await seedTeam(context, { teamName: "Media" });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "service-sabbath",
        name: "Sabbath Service",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
      },
    ],
  });
  const occurrence = {
    occurrenceId: "service-sabbath@2026-10-03T10:00:00.000Z",
    serviceId: "service-sabbath",
    name: "Sabbath Service",
    startsAt: "2026-10-03T10:00:00.000Z",
    positionRequirements: [],
  };
  const populatedCustomId = "populated-custom-october";
  await setDoc("teamSchedules", populatedCustomId, {
    scheduleId: populatedCustomId,
    churchId: context.churchId,
    teamId,
    name: "October staffing",
    startDate: "2026-10-03",
    endDate: "2026-10-03",
    serviceIds: ["service-sabbath"],
    source: "custom",
    occurrences: [occurrence],
    assignments: {
      [occurrence.occurrenceId]: {
        "camera::0": { primaryMemberId: "existing-member", shadows: [] },
      },
    },
  });
  const generatedKey = createHash("sha256")
    .update(`${context.churchId}\u0000${teamId}\u00002026-10-01\u00002026-10-31`)
    .digest("hex");
  const emptyGeneratedId = `generated_${generatedKey}`;
  await setDoc("teamSchedules", emptyGeneratedId, {
    scheduleId: emptyGeneratedId,
    churchId: context.churchId,
    teamId,
    name: "October generated",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    serviceIds: ["service-sabbath"],
    source: "generated-period",
    generatedPeriodKey: generatedKey,
    occurrences: [occurrence],
    assignments: {},
  });

  const result = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body: {
      name: "October 2026",
      teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      timeZone: "UTC",
      serviceIds: ["service-sabbath"],
      visibleOccurrenceIds: [occurrence.occurrenceId],
      occurrences: [occurrence],
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.created, false);
  assert.equal(result.payload.schedule.scheduleId, emptyGeneratedId);
  assert.equal(result.payload.schedule.startDate, "2026-10-01");
});

test("generated schedule ensure prefers an exact period over a broader custom schedule", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("generated_schedule_custom_generated_ambiguous");
  const { teamId } = await seedTeam(context, { teamName: "Media" });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "service-sabbath",
        name: "Sabbath Service",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
      },
    ],
  });
  const occurrence = {
    occurrenceId: "service-sabbath@2026-10-03T10:00:00.000Z",
    serviceId: "service-sabbath",
    name: "Sabbath Service",
    startsAt: "2026-10-03T10:00:00.000Z",
    positionRequirements: [],
  };
  const generatedKey = createHash("sha256")
    .update(`${context.churchId}\u0000${teamId}\u00002026-10-01\u00002026-10-31`)
    .digest("hex");
  const generatedId = `generated_${generatedKey}`;
  const staffing = (memberId) => ({
    [occurrence.occurrenceId]: {
      "camera::0": { primaryMemberId: memberId, shadows: [] },
    },
  });
  const sharedSchedule = {
    churchId: context.churchId,
    teamId,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    serviceIds: ["service-sabbath"],
    occurrences: [occurrence],
  };
  await setDoc("teamSchedules", generatedId, {
    ...sharedSchedule,
    scheduleId: generatedId,
    source: "generated-period",
    generatedPeriodKey: generatedKey,
    assignments: staffing("generated-member"),
  });
  await setDoc("teamSchedules", "custom-october", {
    ...sharedSchedule,
    scheduleId: "custom-october",
    source: "custom",
    startDate: "2026-09-01",
    endDate: "2026-11-30",
    assignments: staffing("custom-member"),
  });

  const result = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body: {
      name: "October 2026",
      teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      timeZone: "UTC",
      serviceIds: ["service-sabbath"],
      visibleOccurrenceIds: [occurrence.occurrenceId],
      occurrences: [occurrence],
      preferredScheduleId: "custom-october",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.schedule.scheduleId, generatedId);
});

test("generated schedule ensure yields to a populated custom period", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("generated_schedule_populated_custom");
  const { teamId, positionIds } = await seedTeam(context, {
    teamName: "Praise Team",
    positions: [{ name: "Vocal" }],
  });
  const vocalId = positionIds.Vocal;
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [{
      id: "worship-experience",
      name: "Worship Experience",
      reccurence: "weekly",
      dayOfWeek: 6,
      time: "11:00",
      positionRequirements: [{ positionId: vocalId, count: 1 }],
    }],
  });
  const occurrence = {
    occurrenceId: "worship-experience@2026-10-03T11:00:00.000Z",
    serviceId: "worship-experience",
    name: "Worship Experience",
    startsAt: "2026-10-03T11:00:00.000Z",
    positionRequirements: [{ positionId: vocalId, count: 1 }],
  };
  const body = {
    name: "October 2026",
    teamId,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    timeZone: "UTC",
    serviceIds: ["worship-experience"],
    occurrences: [occurrence],
  };
  const generated = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body,
  });
  assert.equal(generated.statusCode, 200);
  assert.equal(generated.payload.created, true);
  const customId = "custom-october-praise";
  await setDoc("teamSchedules", customId, {
    scheduleId: customId,
    churchId: context.churchId,
    teamId,
    name: "Custom October",
    startDate: body.startDate,
    endDate: body.endDate,
    serviceIds: body.serviceIds,
    source: "custom",
    occurrences: [occurrence],
    assignments: {
      [occurrence.occurrenceId]: {
        [`${vocalId}::0`]: { primaryMemberId: "existing-vocal", shadows: [] },
      },
    },
  });

  const reused = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body,
  });

  assert.equal(reused.statusCode, 200);
  assert.equal(reused.payload.created, false);
  assert.equal(reused.payload.schedule.scheduleId, customId);
  assert.equal(
    reused.payload.schedule.assignments[occurrence.occurrenceId][`${vocalId}::0`]
      .primaryMemberId,
    "existing-vocal",
  );
});

test("generated schedule ensure merges combined-service requirements from current services", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext(
    "generated_schedule_combined_requirements",
  );
  const { teamId, positionIds } = await seedTeam(context, {
    teamName: "Media",
    positions: [{ name: "Camera" }, { name: "Audio" }],
  });
  const cameraId = positionIds.Camera;
  const audioId = positionIds.Audio;
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "combined-a",
        name: "First",
        serviceGroupId: "combined",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
        positionRequirements: [
          { positionId: cameraId, count: 1, minLevelId: "basic" },
        ],
      },
      {
        id: "combined-b",
        name: "Second",
        serviceGroupId: "combined",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
        positionRequirements: [
          { positionId: cameraId, count: 3, minLevelId: "lead" },
          { positionId: audioId, count: 1 },
        ],
      },
    ],
  });
  const result = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body: {
      name: "October 2026",
      teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      timeZone: "UTC",
      serviceIds: ["combined-a", "combined-b"],
      occurrences: [
        {
          occurrenceId: "group:combined@2026-10-03",
          serviceId: "combined-a",
          serviceIds: ["combined-a", "combined-b"],
          groupId: "combined",
          name: "First & Second",
          startsAt: "2026-10-03T10:00:00.000Z",
          positionRequirements: [{ positionId: cameraId, count: 1 }],
        },
      ],
    },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    result.payload.schedule.occurrences[0].positionRequirements,
    [
      { positionId: cameraId, count: 3, minLevelId: "lead" },
      { positionId: audioId, count: 1 },
    ],
  );
});

test("generated schedule ensure reuses an older rolling record by date coverage despite occurrence drift", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("generated_schedule_rolling_reuse");
  const { teamId, positionIds } = await seedTeam(context, {
    teamName: "Media",
    positions: [{ name: "Camera" }],
  });
  const cameraId = positionIds.Camera;
  const occurrenceId = "service-sabbath@2026-10-03T10:00:00.000Z";
  const savedOccurrenceId = "service-sabbath@2026-10-03T09:00:00.000Z";
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "service-sabbath",
        name: "Sabbath Service",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
        positionRequirements: [{ positionId: cameraId, count: 1 }],
      },
    ],
  });
  const oldKey = createHash("sha256")
    .update(`${teamId}\u00002026-09-29\u00002026-10-31`)
    .digest("hex");
  const oldScheduleId = `generated_${oldKey}`;
  await setDoc("teamSchedules", oldScheduleId, {
    scheduleId: oldScheduleId,
    churchId: context.churchId,
    name: "Sep 29 – Oct 31",
    teamId,
    startDate: "2026-09-29",
    endDate: "2026-10-31",
    serviceIds: ["service-sabbath"],
    source: "generated-period",
    generatedPeriodKey: oldKey,
    occurrences: [
      {
        occurrenceId: savedOccurrenceId,
        serviceId: "service-sabbath",
        name: "Sabbath Service",
        startsAt: "2026-10-03T10:00:00.000Z",
        positionRequirements: [{ positionId: cameraId, count: 1 }],
      },
    ],
    assignments: {
      [savedOccurrenceId]: {
        [`${cameraId}::0`]: { primaryMemberId: "existing-member", shadows: [] },
      },
    },
  });
  const result = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body: {
      name: "October 2026",
      teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      timeZone: "UTC",
      serviceIds: ["service-sabbath"],
      visibleStartDate: "2026-10-03",
      visibleEndDate: "2026-10-03",
      occurrences: [
        {
          occurrenceId,
          serviceId: "service-sabbath",
          name: "Sabbath Service",
          startsAt: "2026-10-03T10:00:00.000Z",
          positionRequirements: [{ positionId: cameraId, count: 1 }],
        },
      ],
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.created, false);
  assert.equal(result.payload.schedule.scheduleId, oldScheduleId);
  assert.equal(result.payload.schedule.occurrences[0].occurrenceId, savedOccurrenceId);
  assert.equal(
    result.payload.schedule.assignments[savedOccurrenceId][`${cameraId}::0`]
      .primaryMemberId,
    "existing-member",
  );
});

test("Upcoming ensure creates the full period instead of reusing a partial generated schedule", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("upcoming_october_partial_generated_bounds");
  const { teamId } = await seedTeam(context, { teamName: "Media" });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [{
      id: "service-sabbath",
      name: "Sabbath Service",
      reccurence: "weekly",
      dayOfWeek: 6,
      time: "10:00",
    }],
  });
  const occurrence = {
    occurrenceId: "service-sabbath@2026-10-03T10:00:00.000Z",
    serviceId: "service-sabbath",
    name: "Sabbath Service",
    startsAt: "2026-10-03T10:00:00.000Z",
    positionRequirements: [],
  };
  const oldScheduleId = "generated_old-rolling-key";
  const assignments = {
    [occurrence.occurrenceId]: {
      "camera::0": { primaryMemberId: "existing-member", shadows: [] },
    },
  };
  await setDoc("teamSchedules", oldScheduleId, {
    scheduleId: oldScheduleId,
    churchId: context.churchId,
    teamId,
    name: "Old generated schedule",
    startDate: "2026-09-29",
    endDate: "2026-10-05",
    serviceIds: ["service-sabbath"],
    source: "generated-period",
    generatedPeriodKey: "old-rolling-key",
    occurrences: [occurrence],
    assignments,
  });
  const generatedKey = createHash("sha256")
    .update(`${context.churchId}\u0000${teamId}\u00002026-10-01\u00002026-10-31`)
    .digest("hex");

  const result = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body: {
      name: "October 2026",
      teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      visibleStartDate: "2026-10-01",
      visibleEndDate: "2026-10-31",
      legacyOccurrenceDate: "2026-10-03",
      preferredScheduleId: oldScheduleId,
      timeZone: "UTC",
      serviceIds: ["service-sabbath"],
      visibleOccurrenceIds: [occurrence.occurrenceId],
      occurrences: [occurrence],
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.created, true);
  assert.equal(result.payload.schedule.scheduleId, `generated_${generatedKey}`);
  assert.equal(result.payload.schedule.startDate, "2026-10-01");
  assert.equal(result.payload.schedule.endDate, "2026-10-31");
  assert.deepEqual((await getDoc("teamSchedules", oldScheduleId)).assignments, assignments);
});

test("Upcoming ensure creates the full December period beside a partial custom schedule", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("upcoming_december_partial_bounds");
  const { teamId, positionIds } = await seedTeam(context, {
    teamName: "Media",
    positions: [{ name: "Camera" }],
  });
  const cameraId = positionIds.Camera;
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [{
      id: "service-sabbath",
      name: "Sabbath Service",
      reccurence: "weekly",
      dayOfWeek: 6,
      time: "10:00",
      positionRequirements: [{ positionId: cameraId, count: 1 }],
    }],
  });
  const occurrence = {
    occurrenceId: "service-sabbath@2026-12-05T10:00:00.000Z",
    serviceId: "service-sabbath",
    name: "Sabbath Service",
    startsAt: "2026-12-05T10:00:00.000Z",
    positionRequirements: [{ positionId: cameraId, count: 1 }],
  };
  const savedScheduleId = "saved-december-5-to-28";
  await setDoc("teamSchedules", savedScheduleId, {
    scheduleId: savedScheduleId,
    churchId: context.churchId,
    name: "December staffing",
    teamId,
    startDate: "2026-12-05",
    endDate: "2026-12-28",
    serviceIds: ["service-sabbath"],
    source: "custom",
    occurrences: [occurrence],
    assignments: {
      [occurrence.occurrenceId]: {
        [`${cameraId}::0`]: { primaryMemberId: "existing-member", shadows: [] },
      },
    },
  });

  const result = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body: {
      name: "December 2026",
      teamId,
      startDate: "2026-12-01",
      endDate: "2026-12-31",
      visibleStartDate: "2026-12-05",
      visibleEndDate: "2026-12-05",
      legacyOccurrenceDate: "2026-12-05",
      timeZone: "UTC",
      serviceIds: ["service-sabbath"],
      visibleOccurrenceIds: [occurrence.occurrenceId],
      occurrences: [occurrence],
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.created, true);
  assert.equal(result.payload.schedule.startDate, "2026-12-01");
  assert.equal(result.payload.schedule.endDate, "2026-12-31");
  assert.notEqual(result.payload.schedule.scheduleId, savedScheduleId);
  assert.equal((await getDoc("teamSchedules", savedScheduleId)).assignments[occurrence.occurrenceId][`${cameraId}::0`].primaryMemberId, "existing-member");
});

test("generated schedule ensure preserves an incomplete saved schedule and creates current rows", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("custom_schedule_occurrence_drift");
  const { teamId } = await seedTeam(context, { teamName: "Media" });
  const currentOccurrences = [3, 4, 10, 11, 17, 24, 31].map((day, index) => {
    const date = `2026-10-${String(day).padStart(2, "0")}`;
    const serviceId = `current-service-${index + 1}`;
    return {
      occurrenceId: `${serviceId}@${date}T11:00:00.000Z`,
      serviceId,
      name: `Current Service ${index + 1}`,
      startsAt: `${date}T11:00:00.000Z`,
      positionRequirements: [],
    };
  });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: currentOccurrences.map((occurrence) => ({
      id: occurrence.serviceId,
      name: occurrence.name,
      reccurence: "one_time",
      dateTimeISO: occurrence.startsAt,
    })),
  });
  const savedOccurrenceIds = [3, 10, 17, 24, 31].map((day) =>
    `old-service@2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
  );
  const customScheduleId = "custom-october-media";
  const existingAssignment = { "position::0": { primaryMemberId: "existing-member", shadows: [] } };
  await setDoc("teamSchedules", customScheduleId, {
    scheduleId: customScheduleId,
    churchId: context.churchId,
    name: "October 2026",
    teamId,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    serviceIds: ["old-service"],
    source: "custom",
    occurrences: savedOccurrenceIds.map((occurrenceId, index) => ({
      occurrenceId,
      serviceId: "old-service",
      name: "Old Sabbath Service",
      startsAt: `2026-10-${String([3, 10, 17, 24, 31][index]).padStart(2, "0")}T10:00:00.000Z`,
      positionRequirements: [],
    })),
    assignments: { [savedOccurrenceIds[0]]: existingAssignment },
  });

  const result = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body: {
      name: "October 2026",
      teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      timeZone: "UTC",
      serviceIds: currentOccurrences.map((occurrence) => occurrence.serviceId),
      visibleStartDate: "2026-10-01",
      visibleEndDate: "2026-10-31",
      occurrences: currentOccurrences,
    },
  });
  const generatedKey = createHash("sha256")
    .update(`${context.churchId}\u0000${teamId}\u00002026-10-01\u00002026-10-31`)
    .digest("hex");

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.created, true);
  assert.equal(result.payload.schedule.scheduleId, `generated_${generatedKey}`);
  assert.equal(result.payload.schedule.occurrences.length, currentOccurrences.length);
  assert.deepEqual(result.payload.schedule.serviceIds, currentOccurrences.map((occurrence) => occurrence.serviceId));
  assert.deepEqual(result.payload.schedule.assignments, {});
  assert.ok(await getDoc("teamSchedules", `generated_${generatedKey}`));
  assert.deepEqual(
    (await getDoc("teamSchedules", customScheduleId)).assignments[savedOccurrenceIds[0]],
    existingAssignment,
  );
});

test("generated schedule ensure reuses only an equivalent source-less legacy period", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext(
    "generated_schedule_equivalent_legacy",
  );
  const { teamId } = await seedTeam(context, { teamName: "Media" });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "service-sabbath",
        name: "Sabbath Service",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
      },
    ],
  });
  const occurrence = {
    occurrenceId: "service-sabbath@2026-10-03T10:00:00.000Z",
    serviceId: "service-sabbath",
    name: "Sabbath Service",
    startsAt: "2026-10-03T10:00:00.000Z",
    positionRequirements: [],
  };
  const legacyId = "source-less-equivalent-october";
  await setDoc("teamSchedules", legacyId, {
    scheduleId: legacyId,
    churchId: context.churchId,
    name: "October 2026",
    teamId,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    serviceIds: ["service-sabbath"],
    occurrences: [occurrence],
    assignments: {},
  });
  const result = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body: {
      name: "October 2026",
      teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      timeZone: "UTC",
      serviceIds: ["service-sabbath"],
      occurrences: [occurrence],
    },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.created, false);
  assert.equal(result.payload.schedule.scheduleId, legacyId);
});

test("generated schedule ensure prefers a populated old generated identity over its populated legacy copy", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("generated_schedule_old_period_key");
  const { teamId } = await seedTeam(context, { teamName: "Media" });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "service-sabbath",
        name: "Sabbath Service",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
      },
    ],
  });
  const legacyKey = createHash("sha256")
    .update(`${teamId}\u00002026-10-01\u00002026-10-31`)
    .digest("hex");
  const legacyId = `generated_${legacyKey}`;
  const occurrence = {
    occurrenceId: "service-sabbath@2026-10-03T10:00:00.000Z",
    serviceId: "service-sabbath",
    name: "Sabbath Service",
    startsAt: "2026-10-03T10:00:00.000Z",
    positionRequirements: [],
  };
  await setDoc("teamSchedules", legacyId, {
    scheduleId: legacyId,
    churchId: context.churchId,
    teamId,
    name: "October 2026",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    serviceIds: ["service-sabbath"],
    source: "generated-period",
    generatedPeriodKey: legacyKey,
    occurrences: [occurrence],
    assignments: {
      [occurrence.occurrenceId]: {
        "camera::0": { primaryMemberId: "generated-member", shadows: [] },
      },
    },
  });
  await setDoc("teamSchedules", "legacy-equivalent-october", {
    scheduleId: "legacy-equivalent-october",
    churchId: context.churchId,
    teamId,
    name: "October legacy",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    serviceIds: ["service-sabbath"],
    occurrences: [occurrence],
    assignments: {
      [occurrence.occurrenceId]: {
        "camera::0": { primaryMemberId: "legacy-member", shadows: [] },
      },
    },
  });
  const result = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body: {
      name: "October 2026",
      teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      timeZone: "UTC",
      serviceIds: ["service-sabbath"],
      occurrences: [occurrence],
    },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.created, false);
  assert.equal(result.payload.schedule.scheduleId, legacyId);
  assert.equal(
    result.payload.schedule.assignments[occurrence.occurrenceId]["camera::0"]
      .primaryMemberId,
    "generated-member",
  );
});

test("generated schedule ensure reuses source-less periods and picks deterministically among equivalent copies", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext(
    "generated_schedule_non_equivalent_legacy",
  );
  const { teamId } = await seedTeam(context, { teamName: "Media" });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "service-sabbath",
        name: "Sabbath Service",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
      },
    ],
  });
  const occurrence = {
    occurrenceId: "service-sabbath@2026-10-03T10:00:00.000Z",
    serviceId: "service-sabbath",
    name: "Sabbath Service",
    startsAt: "2026-10-03T10:00:00.000Z",
    positionRequirements: [],
  };
  const body = {
    name: "October 2026",
    teamId,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    timeZone: "UTC",
    serviceIds: ["service-sabbath"],
    occurrences: [occurrence],
  };
  await setDoc("teamSchedules", "source-less-custom-occurrence", {
    scheduleId: "source-less-custom-occurrence",
    churchId: context.churchId,
    teamId,
    startDate: body.startDate,
    endDate: body.endDate,
    serviceIds: body.serviceIds,
    occurrences: [
      { ...occurrence, occurrenceId: "special-event@2026-10-03T10:00:00.000Z" },
    ],
    assignments: {},
  });
  const reused = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body,
  });
  assert.equal(reused.statusCode, 200);
  assert.equal(reused.payload.created, false);
  assert.equal(reused.payload.schedule.scheduleId, "source-less-custom-occurrence");

  const ambiguousContext = await createAdminContext(
    "generated_schedule_ambiguous_legacy",
  );
  const ambiguousTeam = await seedTeam(ambiguousContext, { teamName: "Media" });
  seedChurchServiceTimesForServerTests({
    churchId: ambiguousContext.churchId,
    services: [
      {
        id: "service-sabbath",
        name: "Sabbath Service",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
      },
    ],
  });
  const equivalentBase = {
    churchId: ambiguousContext.churchId,
    teamId: ambiguousTeam.teamId,
    startDate: body.startDate,
    endDate: body.endDate,
    serviceIds: body.serviceIds,
    occurrences: [occurrence],
    assignments: {
      [occurrence.occurrenceId]: {
        "camera::0": { primaryMemberId: "existing-member", shadows: [] },
      },
    },
  };
  await setDoc("teamSchedules", "legacy-copy-a", {
    ...equivalentBase,
    scheduleId: "legacy-copy-a",
  });
  await setDoc("teamSchedules", "legacy-copy-b", {
    ...equivalentBase,
    scheduleId: "legacy-copy-b",
  });
  const ambiguous = await callHandler(
    authHandlers.ensureTeamScheduleForPeriod,
    {
      context: ambiguousContext,
      body: { ...body, teamId: ambiguousTeam.teamId },
    },
  );
  assert.equal(ambiguous.statusCode, 200);
  assert.equal(ambiguous.payload.schedule.scheduleId, "legacy-copy-a");
});

test("generated schedule ensure rejects inactive services and mismatched groups", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("generated_schedule_validation");
  const { teamId } = await seedTeam(context, { teamName: "Media" });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "active-one",
        name: "First",
        serviceGroupId: "combined",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
      },
      {
        id: "active-two",
        name: "Second",
        serviceGroupId: "other",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
      },
      { id: "archived", name: "Old", archivedAt: "2026-01-01T00:00:00.000Z" },
    ],
  });
  const body = {
    name: "October 2026",
    teamId,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    timeZone: "UTC",
    serviceIds: ["active-one"],
    occurrences: [
      {
        occurrenceId: "active-one@2026-10-03T10:00:00.000Z",
        serviceId: "active-one",
        name: "First",
        startsAt: "2026-10-03T10:00:00.000Z",
        positionRequirements: [],
      },
    ],
  };
  const archived = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context,
    body: {
      ...body,
      serviceIds: ["archived"],
      occurrences: [
        {
          ...body.occurrences[0],
          serviceId: "archived",
          occurrenceId: "archived@2026-10-03T10:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(archived.statusCode, 400);
  const wrongGroup = await callHandler(
    authHandlers.ensureTeamScheduleForPeriod,
    {
      context,
      body: {
        ...body,
        serviceIds: ["active-one", "active-two"],
        occurrences: [
          {
            ...body.occurrences[0],
            serviceIds: ["active-one", "active-two"],
            groupId: "combined",
            occurrenceId: "group:combined@2026-10-03",
          },
        ],
      },
    },
  );
  assert.equal(wrongGroup.statusCode, 400);
  const wrongWeekday = await callHandler(
    authHandlers.ensureTeamScheduleForPeriod,
    {
      context,
      body: {
        ...body,
        occurrences: [
          {
            ...body.occurrences[0],
            occurrenceId: "active-one@2026-10-04T10:00:00.000Z",
            startsAt: "2026-10-04T10:00:00.000Z",
          },
        ],
      },
    },
  );
  assert.equal(wrongWeekday.statusCode, 400);
});

test("Services edit can change service plans but not team records", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const adminContext = await createAdminContext("services_edit_permission");
  const servicesEditor = await createHumanContext(
    "services_edit_permission_member",
    {
      userId: "teams_api_services_editor",
      email: "teams-api-services-editor@example.com",
      churchId: adminContext.churchId,
      role: "member",
      appAccess: "full",
      permissions: { teams: "none", services: "edit" },
    },
  );

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context: servicesEditor,
  });
  assert.equal(bootstrap.statusCode, 200);

  const saved = await callHandler(authHandlers.saveServicePlan, {
    context: servicesEditor,
    params: { planKey: "services-editor@2026-08-02" },
    body: {
      serviceId: "service-1",
      date: "2026-08-02",
      name: "Sunday Service",
      sections: [],
    },
  });
  assert.equal(saved.statusCode, 200);

  const teamWrite = await callHandler(authHandlers.createTeam, {
    context: servicesEditor,
    body: { name: "Blocked Team", memberIds: [] },
  });
  assert.equal(teamWrite.statusCode, 403);
});

test("removing admin access clears implicit Teams edit permission", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const adminContext = await createAdminContext("remove_admin_permissions");
  const targetUserId = "teams_api_removed_admin_permissions";
  const targetContext = await createHumanContext(
    "remove_admin_permissions_target",
    {
      userId: targetUserId,
      email: "teams-api-removed-admin-permissions@example.com",
      churchId: adminContext.churchId,
      role: "admin",
      appAccess: "full",
    },
  );

  const removeRes = await callHandler(authHandlers.removeAdmin, {
    context: adminContext,
    params: { userId: targetUserId },
  });
  assert.equal(removeRes.statusCode, 200);

  const bootstrapRes = await callHandler(authHandlers.getTeamsBootstrap, {
    context: targetContext,
  });
  assert.equal(bootstrapRes.statusCode, 403);
  assert.equal(bootstrapRes.payload.success, false);
});

test("making a member an admin grants Teams edit access", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const adminContext = await createAdminContext("make_admin_permissions");
  const targetUserId = "teams_api_make_admin_permissions";
  const targetContext = await createHumanContext(
    "make_admin_permissions_target",
    {
      userId: targetUserId,
      email: "teams-api-make-admin-permissions@example.com",
      churchId: adminContext.churchId,
      role: "member",
      appAccess: "view",
      permissions: { teams: "none", services: "none", teamScopes: {} },
    },
  );

  const beforeBootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context: targetContext,
  });
  assert.equal(beforeBootstrap.statusCode, 403);

  const makeRes = await callHandler(authHandlers.makeAdmin, {
    context: adminContext,
    params: { userId: targetUserId },
  });
  assert.equal(makeRes.statusCode, 200);
  assert.equal(makeRes.payload.success, true);

  const membersRes = await callHandler(authHandlers.listChurchMembers, {
    context: adminContext,
  });
  assert.equal(membersRes.statusCode, 200);
  const promoted = (membersRes.payload.members || []).find(
    (member) =>
      member.userId === targetUserId || member.user?.uid === targetUserId,
  );
  assert.equal(promoted?.role, "admin");
  assert.equal(promoted?.appAccess, "full");

  const afterBootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context: targetContext,
  });
  assert.equal(afterBootstrap.statusCode, 200);
  assert.equal(afterBootstrap.payload.success, true);
});

test("making an existing admin an admin again is rejected", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const adminContext = await createAdminContext("make_admin_already");
  const targetUserId = "teams_api_make_admin_already";
  await createHumanContext("make_admin_already_target", {
    userId: targetUserId,
    email: "teams-api-make-admin-already@example.com",
    churchId: adminContext.churchId,
    role: "admin",
    appAccess: "full",
  });

  const makeRes = await callHandler(authHandlers.makeAdmin, {
    context: adminContext,
    params: { userId: targetUserId },
  });
  assert.equal(makeRes.statusCode, 400);
  assert.equal(makeRes.payload.success, false);
  assert.match(makeRes.payload.errorMessage || "", /already a church admin/i);
});

test("non-admin cannot make a member an admin", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const adminContext = await createAdminContext("make_admin_forbidden");
  const memberContext = await createHumanContext(
    "make_admin_forbidden_member",
    {
      userId: "teams_api_make_admin_forbidden_member",
      email: "teams-api-make-admin-forbidden-member@example.com",
      churchId: adminContext.churchId,
      role: "member",
      appAccess: "full",
    },
  );
  const targetUserId = "teams_api_make_admin_forbidden_target";
  await createHumanContext("make_admin_forbidden_target", {
    userId: targetUserId,
    email: "teams-api-make-admin-forbidden-target@example.com",
    churchId: adminContext.churchId,
    role: "member",
    appAccess: "view",
  });

  const makeRes = await callHandler(authHandlers.makeAdmin, {
    context: memberContext,
    params: { userId: targetUserId },
  });
  assert.equal(makeRes.statusCode, 403);
  assert.equal(makeRes.payload.success, false);
});

test("team-scoped edit can manage that team schedules and members only", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const adminContext = await createAdminContext("team_scope");
  const mediaTeam = await callHandler(authHandlers.createTeam, {
    context: adminContext,
    body: { name: "Media", memberIds: [] },
  });
  const praiseTeam = await callHandler(authHandlers.createTeam, {
    context: adminContext,
    body: { name: "Praise", memberIds: [] },
  });
  const mediaTeamId = mediaTeam.payload.team.teamId;
  const praiseTeamId = praiseTeam.payload.team.teamId;
  const mediaPosition = await callHandler(authHandlers.createTeamPosition, {
    context: adminContext,
    body: { name: "Camera", teamId: mediaTeamId },
  });
  const praisePosition = await callHandler(authHandlers.createTeamPosition, {
    context: adminContext,
    body: { name: "Vocal", teamId: praiseTeamId },
  });
  const scopedContext = await createHumanContext("team_scope_editor", {
    userId: "teams_api_team_scope_editor",
    email: "teams-api-team-scope-editor@example.com",
    churchId: adminContext.churchId,
    role: "member",
    appAccess: "view",
    permissions: {
      teams: "none",
      teamScopes: { [mediaTeamId]: "edit" },
    },
  });

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context: scopedContext,
  });
  assert.equal(bootstrap.statusCode, 200);

  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context: scopedContext,
    body: {
      firstName: "Avery",
      lastName: "Stone",
      positionIds: [mediaPosition.payload.position.positionId],
      blockoutDates: [],
    },
  });
  assert.equal(member.statusCode, 200);

  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context: scopedContext,
    body: {
      name: "Media schedule",
      teamId: mediaTeamId,
      serviceIds: ["svc"],
      startDate: "2026-07-05",
      endDate: "2026-07-05",
      occurrences: [
        {
          occurrenceId: "svc@2026-07-05",
          serviceId: "svc",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(schedule.statusCode, 200);

  const blockedSchedule = await callHandler(authHandlers.createTeamSchedule, {
    context: scopedContext,
    body: {
      name: "Praise schedule",
      teamId: praiseTeamId,
      serviceIds: ["svc"],
      startDate: "2026-07-05",
      endDate: "2026-07-05",
      occurrences: [
        {
          occurrenceId: "svc@2026-07-05",
          serviceId: "svc",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(blockedSchedule.statusCode, 403);

  const blockedMember = await callHandler(authHandlers.createTeamRosterMember, {
    context: scopedContext,
    body: {
      firstName: "Riley",
      lastName: "Pace",
      positionIds: [praisePosition.payload.position.positionId],
      blockoutDates: [],
    },
  });
  assert.equal(blockedMember.statusCode, 403);
});

test("team position validation and archive keep archived rows readable", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("archive");

  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Worship", memberIds: [] },
  });
  const teamId = team.payload.team.teamId;

  const invalid = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: " ", teamId },
  });
  assert.equal(invalid.statusCode, 400);

  const created = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Vocal", description: "Lead melody", icon: "mic", teamId },
  });
  assert.equal(created.statusCode, 200);
  const positionId = created.payload?.position?.positionId;
  assert.ok(positionId);
  assert.equal(created.payload?.position?.teamId, teamId);

  const archived = await callHandler(authHandlers.archiveTeamPosition, {
    context,
    params: { positionId },
  });
  assert.equal(archived.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  assert.equal(bootstrap.statusCode, 200);
  const position = bootstrap.payload.positions.find(
    (item) => item.positionId === positionId,
  );
  assert.ok(position?.archivedAt);
});

test("team position icon refs persist while legacy values and older omitted saves stay compatible", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("position_icon_refs");
  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Production", memberIds: [] },
  });
  const teamId = team.payload.team.teamId;
  const legacy = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Vocal", teamId, icon: "MicVocal" },
  });
  assert.equal(legacy.statusCode, 200);
  assert.equal(legacy.payload.position.icon, "MicVocal");

  const ref = { source: "tabler", name: "camera", color: "#22D3EE" };
  const updated = await callHandler(authHandlers.updateTeamPosition, {
    context,
    params: { positionId: legacy.payload.position.positionId },
    body: { name: "Vocal", teamId, icon: ref },
  });
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(updated.payload.position.icon, {
    source: "tabler",
    name: "camera",
    color: "#22d3ee",
  });

  const legacyClientSave = await callHandler(authHandlers.updateTeamPosition, {
    context,
    params: { positionId: legacy.payload.position.positionId },
    body: { name: "Vocal Updated", teamId },
  });
  assert.equal(legacyClientSave.statusCode, 200);
  assert.deepEqual(
    legacyClientSave.payload.position.icon,
    updated.payload.position.icon,
  );
  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const loadedPosition = bootstrap.payload.positions.find(
    (position) => position.positionId === legacy.payload.position.positionId,
  );
  assert.deepEqual(loadedPosition.icon, updated.payload.position.icon);

  const invalid = await callHandler(authHandlers.updateTeamPosition, {
    context,
    params: { positionId: legacy.payload.position.positionId },
    body: {
      name: "Vocal",
      teamId,
      icon: { source: "tabler", name: "camera", color: "red" },
    },
  });
  assert.equal(invalid.statusCode, 400);
});

test("team icons accept legacy and structured refs with validated colors", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("team_icon_refs");
  const legacy = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Music", memberIds: [], icon: "Music" },
  });
  assert.equal(legacy.statusCode, 200);
  assert.equal(legacy.payload.team.icon, "Music");

  const structured = await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId: legacy.payload.team.teamId },
    body: {
      name: "Music",
      memberIds: [],
      icon: { source: "lucide", name: "Music", color: "#22D3EE" },
    },
  });
  assert.equal(structured.statusCode, 200);
  assert.deepEqual(structured.payload.team.icon, {
    source: "lucide",
    name: "Music",
    color: "#22d3ee",
  });

  const tabler = await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId: legacy.payload.team.teamId },
    body: {
      name: "Music",
      memberIds: [],
      icon: { source: "tabler", name: "camera" },
    },
  });
  assert.deepEqual(tabler.payload.team.icon, {
    source: "tabler",
    name: "camera",
  });

  const worshipSync = await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId: legacy.payload.team.teamId },
    body: {
      name: "Music",
      memberIds: [],
      icon: { source: "worshipsync", name: "service" },
    },
  });
  assert.deepEqual(worshipSync.payload.team.icon, {
    source: "worshipsync",
    name: "service",
  });

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  assert.deepEqual(
    bootstrap.payload.teams.find(
      (item) => item.teamId === legacy.payload.team.teamId,
    ).icon,
    worshipSync.payload.team.icon,
  );

  for (const icon of [
    { source: "unknown", name: "camera" },
    { source: "tabler", name: "camera", color: "red" },
  ]) {
    const invalid = await callHandler(authHandlers.updateTeam, {
      context,
      params: { teamId: legacy.payload.team.teamId },
      body: { name: "Music", memberIds: [], icon },
    });
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.payload.errorMessage, /Team icon/);
  }
});

test("portable team import and export preserve structured icon refs", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("portable_team_icon");
  const icon = { source: "tabler", name: "camera", color: "#22d3ee" };
  const committed = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "teams",
      approvedRows: [
        {
          row: 2,
          action: "create",
          record: { name: "Portable Music", icon: "Music" },
        },
        {
          row: 3,
          action: "create",
          record: { name: "Portable Media", icon: JSON.stringify(icon) },
        },
      ],
    },
  });
  assert.equal(committed.statusCode, 200);
  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const music = bootstrap.payload.teams.find(
    (team) => team.name === "Portable Music",
  );
  const media = bootstrap.payload.teams.find(
    (team) => team.name === "Portable Media",
  );
  assert.equal(music.icon, "Music");
  assert.deepEqual(media.icon, icon);

  const exported = await callHandler(authHandlers.exportPortableData, {
    context,
    params: { type: "teams" },
  });
  assert.equal(exported.statusCode, 200);
  assert.match(String(exported.body), /Music/);
  assert.ok(
    String(exported.body).includes(JSON.stringify(icon).replaceAll('"', '""')),
  );
});

test("unrelated position edits preserve legacy custom icons while supported changes and clearing work", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("legacy_custom_position_icon");
  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Production" },
  });
  const icon = { source: "custom", id: "church-icon" };
  const positionId = "legacy_custom_position";
  await setDoc(COLLECTIONS.teamPositions, positionId, {
    positionId,
    churchId: context.churchId,
    teamId: team.payload.team.teamId,
    name: "Camera",
    description: "Original description",
    icon,
    archivedAt: null,
  });

  const renamed = await callHandler(authHandlers.updateTeamPosition, {
    context,
    params: { positionId },
    body: {
      name: "Video Camera",
      teamId: team.payload.team.teamId,
      description: "Original description",
      icon,
    },
  });
  assert.equal(renamed.statusCode, 200);
  assert.deepEqual(renamed.payload.position.icon, icon);
  const described = await callHandler(authHandlers.updateTeamPosition, {
    context,
    params: { positionId },
    body: {
      name: "Video Camera",
      teamId: team.payload.team.teamId,
      description: "Updated description",
      icon,
    },
  });
  assert.equal(described.statusCode, 200);
  assert.deepEqual(described.payload.position.icon, icon);

  const changed = await callHandler(authHandlers.updateTeamPosition, {
    context,
    params: { positionId },
    body: {
      name: "Video Camera",
      teamId: team.payload.team.teamId,
      icon: { source: "lucide", name: "Camera" },
    },
  });
  assert.equal(changed.statusCode, 200);
  assert.deepEqual(changed.payload.position.icon, {
    source: "lucide",
    name: "Camera",
  });
  const cleared = await callHandler(authHandlers.updateTeamPosition, {
    context,
    params: { positionId },
    body: { name: "Video Camera", teamId: team.payload.team.teamId, icon: "" },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.payload.position.icon, "");

  await setDoc(
    COLLECTIONS.teamPositions,
    positionId,
    { ...cleared.payload.position, icon },
    { merge: false },
  );
  const exported = await callHandler(authHandlers.exportPortableData, {
    context,
    params: { type: "positions" },
  });
  const csv = String(exported.body);
  const inspected = await callHandler(authHandlers.inspectPortableImport, {
    context,
    body: { type: "positions", csv },
  });
  const preview = await callHandler(authHandlers.previewPortableImport, {
    context,
    body: { type: "positions", csv, mapping: inspected.payload.mapping },
  });
  assert.equal(
    preview.payload.rows[0].action,
    "update",
    JSON.stringify(preview.payload.rows[0]),
  );
  const roundTrip = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "positions",
      approvedRows: preview.payload.rows.map(
        ({ row, action, matchedId, record }) => ({
          row,
          action,
          recordId: matchedId,
          record,
        }),
      ),
    },
  });
  assert.equal(
    roundTrip.payload.summary.updated,
    1,
    JSON.stringify({ row: preview.payload.rows[0], result: roundTrip.payload }),
  );
  const persisted = await getDoc(COLLECTIONS.teamPositions, positionId);
  assert.deepEqual(persisted.icon, icon);

  const rejectedCreate = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "positions",
      approvedRows: [
        {
          row: 2,
          action: "create",
          record: {
            name: "New Custom",
            team: "Production",
            teamId: team.payload.team.teamId,
            icon: JSON.stringify(icon),
          },
        },
      ],
    },
  });
  assert.equal(rejectedCreate.payload.summary.failed, 1);
});

test("new schedules seed microphone defaults from their positions", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("position_microphone_defaults");
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
  const occurrenceId = "service-sunday@2026-08-02T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "August",
      teamId,
      startDate: "2026-08-02",
      endDate: "2026-08-02",
      serviceIds: ["service-sunday"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "service-sunday",
          name: "Sunday",
          startsAt: "2026-08-02T10:00:00.000Z",
          positionRequirements: [{ positionId, count: 1 }],
        },
      ],
    },
  });

  assert.equal(schedule.statusCode, 200);
  assert.deepEqual(schedule.payload.schedule.microphoneAssignments, {
    [occurrenceId]: { [`${positionId}::0`]: ["mic-lead"] },
  });
});

test("concurrent microphone slot saves retain both changes", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("concurrent_microphone_saves");
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
        { id: "mic-keys", name: "Keys", type: "Handheld", color: "#f59e0b" },
      ],
      audiences: [],
    },
  });
  const lead = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Lead", teamId },
  });
  const keys = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Keys", teamId },
  });
  const leadPositionId = lead.payload.position.positionId;
  const keysPositionId = keys.payload.position.positionId;
  const occurrenceId = "service-sunday@2026-08-09T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "August",
      teamId,
      startDate: "2026-08-09",
      endDate: "2026-08-09",
      serviceIds: ["service-sunday"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "service-sunday",
          name: "Sunday",
          startsAt: "2026-08-09T10:00:00.000Z",
          positionRequirements: [
            { positionId: leadPositionId, count: 1 },
            { positionId: keysPositionId, count: 1 },
          ],
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  const saves = await Promise.all([
    callHandler(authHandlers.updateTeamScheduleAssignmentMicrophones, {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${leadPositionId}::0`,
        microphoneIds: ["mic-lead"],
      },
    }),
    callHandler(authHandlers.updateTeamScheduleAssignmentMicrophones, {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${keysPositionId}::0`,
        microphoneIds: ["mic-keys"],
      },
    }),
  ]);

  assert.equal(
    saves.every((save) => save.statusCode === 200),
    true,
  );
  assert.ok(
    saves.some(
      (save) =>
        Object.keys(
          save.payload.schedule.microphoneAssignments[occurrenceId] || {},
        ).length === 2,
    ),
  );
  const savedWithBothSlots = saves.find(
    (save) =>
      Object.keys(
        save.payload.schedule.microphoneAssignments[occurrenceId] || {},
      ).length === 2,
  );
  assert.deepEqual(savedWithBothSlots.payload.schedule.microphoneAssignments, {
    [occurrenceId]: {
      [`${leadPositionId}::0`]: ["mic-lead"],
      [`${keysPositionId}::0`]: ["mic-keys"],
    },
  });
});

test("clearing a microphone assignment removes the slot", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("clear_microphone_assignment");
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
  const lead = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Lead", teamId },
  });
  const leadPositionId = lead.payload.position.positionId;
  const occurrenceId = "service-sunday@2026-08-16T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "August",
      teamId,
      startDate: "2026-08-16",
      endDate: "2026-08-16",
      serviceIds: ["service-sunday"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "service-sunday",
          name: "Sunday",
          startsAt: "2026-08-16T10:00:00.000Z",
          positionRequirements: [{ positionId: leadPositionId, count: 1 }],
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;
  const slotKey = `${leadPositionId}::0`;

  const assigned = await callHandler(
    authHandlers.updateTeamScheduleAssignmentMicrophones,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: slotKey,
        microphoneIds: ["mic-lead"],
      },
    },
  );
  assert.equal(assigned.statusCode, 200);
  assert.deepEqual(assigned.payload.schedule.microphoneAssignments, {
    [occurrenceId]: { [slotKey]: ["mic-lead"] },
  });

  const cleared = await callHandler(
    authHandlers.updateTeamScheduleAssignmentMicrophones,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: slotKey,
        microphoneIds: [],
      },
    },
  );
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(cleared.payload.schedule.microphoneAssignments, {});

  const reloaded = await callHandler(authHandlers.getTeamScheduleDetail, {
    context,
    params: { scheduleId },
  });
  assert.equal(reloaded.statusCode, 200);
  assert.deepEqual(reloaded.payload.schedule.microphoneAssignments, {});
});

test("a position's qualification area must belong to the same team", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("qualification_area_scope");

  const worship = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Worship", memberIds: [] },
  });
  const media = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Media", memberIds: [] },
  });

  const mediaArea = await callHandler(
    authHandlers.createTeamQualificationArea,
    {
      context,
      body: { name: "Camera Skill", teamId: media.payload.team.teamId },
    },
  );
  const areaId = mediaArea.payload?.area?.areaId;
  assert.ok(areaId);

  const rejected = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: {
      name: "Vocal",
      teamId: worship.payload.team.teamId,
      qualificationAreaId: areaId,
    },
  });
  assert.equal(rejected.statusCode, 400);

  const accepted = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: {
      name: "Camera Operator",
      teamId: media.payload.team.teamId,
      qualificationAreaId: areaId,
    },
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.payload?.position?.qualificationAreaId, areaId);
});

test("updating a position without a qualification area clears a previously set one", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("qualification_area_clear");

  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Media", memberIds: [] },
  });
  const teamId = team.payload.team.teamId;
  const area = await callHandler(authHandlers.createTeamQualificationArea, {
    context,
    body: { name: "Camera Skill", teamId },
  });
  const areaId = area.payload?.area?.areaId;
  assert.ok(areaId);

  const created = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Camera Operator", teamId, qualificationAreaId: areaId },
  });
  const positionId = created.payload?.position?.positionId;
  assert.equal(created.payload?.position?.qualificationAreaId, areaId);

  const updated = await callHandler(authHandlers.updateTeamPosition, {
    context,
    params: { positionId },
    body: { name: "Camera Operator", teamId },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.payload?.position?.qualificationAreaId, null);
});

test("deleting a team position permanently removes it", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("delete");

  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Production", memberIds: [] },
  });
  const created = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Camera", icon: "Camera", teamId: team.payload.team.teamId },
  });
  const positionId = created.payload?.position?.positionId;
  assert.ok(positionId);

  const deleted = await callHandler(authHandlers.deleteTeamPosition, {
    context,
    params: { positionId },
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.payload?.success, true);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const position = bootstrap.payload.positions.find(
    (item) => item.positionId === positionId,
  );
  assert.equal(position, undefined);
});

test("team member guidance metadata supports roles and qualifications", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member-guidance");

  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Production", memberIds: [] },
  });
  assert.equal(team.statusCode, 200);
  const teamId = team.payload.team.teamId;

  const role = await callHandler(authHandlers.createTeamRole, {
    context,
    body: { teamId, name: "Media Director" },
  });
  assert.equal(role.statusCode, 200);
  const roleId = role.payload.role.roleId;

  const area = await callHandler(authHandlers.createTeamQualificationArea, {
    context,
    body: { teamId, name: "Camera" },
  });
  assert.equal(area.statusCode, 200);
  const areaId = area.payload.area.areaId;

  const level = await callHandler(authHandlers.createTeamQualificationLevel, {
    context,
    body: { areaId, name: "Level 2", rank: 2 },
  });
  assert.equal(level.statusCode, 200);
  const levelId = level.payload.level.levelId;

  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Avery",
      lastName: "Stone",
      positionIds: [],
      teamMemberships: {
        [teamId]: {
          roleId,
          roleLabel: "Media Director",
        },
      },
      qualifications: [
        {
          qualificationId: "camera-l2",
          teamId,
          areaId,
          levelId,
          status: "completed",
          completedAt: "2026-05-01",
        },
      ],
      blockoutDates: [],
    },
  });
  assert.equal(member.statusCode, 200);
  assert.equal(member.payload.member.teamMemberships[teamId].roleId, roleId);
  assert.equal(member.payload.member.qualifications[0].levelId, levelId);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  assert.equal(bootstrap.statusCode, 200);
  assert.equal(bootstrap.payload.teamRoles[0].roleId, roleId);
  assert.equal(bootstrap.payload.qualificationAreas[0].areaId, areaId);
  assert.equal(bootstrap.payload.qualificationLevels[0].levelId, levelId);

  const deletedLevel = await callHandler(
    authHandlers.deleteTeamQualificationLevel,
    {
      context,
      params: { levelId },
    },
  );
  assert.equal(deletedLevel.statusCode, 200);

  const afterLevelDelete = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const updatedMember = afterLevelDelete.payload.members.find(
    (item) => item.memberId === member.payload.member.memberId,
  );
  assert.equal(updatedMember.qualifications[0].areaId, areaId);
  assert.equal(updatedMember.qualifications[0].levelId, undefined);
});

test("team role and qualification area icons persist, remain optional, and can be removed", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("team-entity-icons");
  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Production", memberIds: [] },
  });
  const teamId = team.payload.team.teamId;
  const roleIcon = { source: "tabler", name: "microphone", color: "#22c55e" };
  const areaIcon = { source: "worshipsync", name: "bible", color: "#fbbf24" };

  const role = await callHandler(authHandlers.createTeamRole, {
    context,
    body: { teamId, name: "Audio Lead", icon: roleIcon },
  });
  assert.equal(role.statusCode, 200);
  assert.deepEqual(role.payload.role.icon, roleIcon);

  const legacyRole = await callHandler(authHandlers.createTeamRole, {
    context,
    body: { teamId, name: "Legacy Role" },
  });
  assert.equal(legacyRole.statusCode, 200);
  assert.equal(Object.hasOwn(legacyRole.payload.role, "icon"), false);

  const updatedRole = await callHandler(authHandlers.updateTeamRole, {
    context,
    params: { roleId: role.payload.role.roleId },
    body: { teamId, name: "Audio Team Lead" },
  });
  assert.deepEqual(updatedRole.payload.role.icon, roleIcon);
  const clearedRole = await callHandler(authHandlers.updateTeamRole, {
    context,
    params: { roleId: role.payload.role.roleId },
    body: { teamId, name: "Audio Team Lead", icon: "" },
  });
  assert.equal(clearedRole.payload.role.icon, "");

  const area = await callHandler(authHandlers.createTeamQualificationArea, {
    context,
    body: { teamId, name: "Audio", icon: areaIcon },
  });
  assert.equal(area.statusCode, 200);
  assert.deepEqual(area.payload.area.icon, areaIcon);
  const legacyArea = await callHandler(authHandlers.createTeamQualificationArea, {
    context,
    body: { teamId, name: "Legacy qualification" },
  });
  assert.equal(legacyArea.statusCode, 200);
  assert.equal(Object.hasOwn(legacyArea.payload.area, "icon"), false);
  const updatedArea = await callHandler(authHandlers.updateTeamQualificationArea, {
    context,
    params: { areaId: area.payload.area.areaId },
    body: { teamId, name: "Audio Production", icon: "" },
  });
  assert.equal(updatedArea.payload.area.icon, "");
});

test("deleting a position scrubs it from teams, members, and assignments", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("cascade");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Worship Team",
    positions: [
      { name: "Vocal", icon: "Mic" },
      { name: "Keys", icon: "Piano" },
    ],
    members: [
      { firstName: "Avery", lastName: "Stone", positions: ["Vocal", "Keys"] },
    ],
  });
  const vocalId = positionIds.Vocal;
  const keysId = positionIds.Keys;
  const memberId = memberIds.Avery;

  const occurrenceId = "svc@2026-07-05T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "July",
      teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["svc"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc",
          name: "Sunday",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${vocalId}::0`,
      memberId,
      serviceDate: "2026-07-05",
    },
  });
  const deleted = await callHandler(authHandlers.deleteTeamPosition, {
    context,
    params: { positionId: vocalId },
  });
  assert.equal(deleted.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const updatedMember = bootstrap.payload.members.find(
    (item) => item.memberId === memberId,
  );
  const updatedSchedule = bootstrap.payload.schedules.find(
    (item) => item.scheduleId === scheduleId,
  );
  const positionIdsAfter = bootstrap.payload.positions.map(
    (position) => position.positionId,
  );

  // The team keeps its other position; the deleted position is scrubbed everywhere.
  assert.ok(positionIdsAfter.includes(keysId));
  assert.ok(!positionIdsAfter.includes(vocalId));
  assert.deepEqual(updatedMember.positionIds, [keysId]);
  assert.equal(
    updatedSchedule.assignments?.[occurrenceId]?.[`${vocalId}::0`],
    undefined,
  );
});

test("deleting a position from another church is rejected", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const owner = await createAdminContext("delete_owner");
  const intruder = await createAdminContext("delete_intruder");

  const ownerTeam = await callHandler(authHandlers.createTeam, {
    context: owner,
    body: { name: "Production", memberIds: [] },
  });
  const created = await callHandler(authHandlers.createTeamPosition, {
    context: owner,
    body: {
      name: "Producer",
      icon: "Clapperboard",
      teamId: ownerTeam.payload.team.teamId,
    },
  });
  const positionId = created.payload?.position?.positionId;
  assert.ok(positionId);

  const rejected = await callHandler(authHandlers.deleteTeamPosition, {
    context: intruder,
    params: { positionId },
  });
  assert.equal(rejected.statusCode, 404);
  assert.equal(rejected.payload?.success, false);

  // The owner can still see it — it was not deleted.
  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context: owner,
  });
  const position = bootstrap.payload.positions.find(
    (item) => item.positionId === positionId,
  );
  assert.ok(position);
});

test("schedule assignments block duplicate positions and unavailable members", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("assignments");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Worship Team",
    positions: [
      { name: "Vocal", icon: "mic" },
      { name: "Keys", icon: "piano" },
    ],
    members: [
      { firstName: "Avery", lastName: "Stone", positions: ["Vocal", "Keys"] },
      {
        firstName: "Morgan",
        lastName: "Lee",
        positions: ["Vocal"],
        blockoutDates: [{ startDate: "2026-07-05", endDate: "2026-07-05" }],
      },
      {
        firstName: "Jordan",
        lastName: "Ray",
        positions: ["Vocal"],
        recurringAvailability: {
          weeksOfMonth: [4],
          includeLastWeekOfMonth: false,
        },
      },
    ],
  });
  const vocalId = positionIds.Vocal;
  const keysId = positionIds.Keys;
  const availableId = memberIds.Avery;
  const unavailableId = memberIds.Morgan;
  const recurringUnavailableId = memberIds.Jordan;

  const serviceId = "service-sunday";
  const occurrenceId = "service-sunday@2026-07-05T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "July",
      teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: [serviceId],
      occurrences: [
        {
          occurrenceId,
          serviceId,
          name: "Sunday",
          startsAt: "2026-07-05T10:00:00.000Z",
          positionRequirements: [
            { positionId: vocalId, count: 1 },
            { positionId: keysId, count: 1 },
          ],
        },
      ],
    },
  });

  const assign = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId: schedule.payload.schedule.scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${vocalId}::0`,
      memberId: availableId,
      serviceDate: "2026-07-05",
    },
  });
  assert.equal(assign.statusCode, 200);

  const duplicate = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: schedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${keysId}::0`,
        memberId: availableId,
        serviceDate: "2026-07-05",
      },
    },
  );
  assert.equal(duplicate.statusCode, 400);
  assert.match(duplicate.payload.errorMessage, /one position per service/i);

  const blockedUnavailable = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: schedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${vocalId}::0`,
        memberId: unavailableId,
        serviceDate: "2026-07-05",
      },
    },
  );
  assert.equal(blockedUnavailable.statusCode, 400);
  assert.match(blockedUnavailable.payload.errorMessage, /unavailable/i);

  const blockedByRecurringAvailability = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: schedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${vocalId}::0`,
        memberId: recurringUnavailableId,
        serviceDate: "2026-07-05",
      },
    },
  );
  assert.equal(blockedByRecurringAvailability.statusCode, 400);
  assert.match(
    blockedByRecurringAvailability.payload.errorMessage,
    /week of the month/i,
  );

  const confirmedRecurringAvailability = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: schedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${vocalId}::0`,
        memberId: recurringUnavailableId,
        serviceDate: "2026-07-05",
        allowRecurringAvailability: true,
      },
    },
  );
  assert.equal(confirmedRecurringAvailability.statusCode, 200);
  assert.equal(
    getMemberId(
      confirmedRecurringAvailability.payload.schedule.assignments?.[
        occurrenceId
      ]?.[`${vocalId}::0`],
    ),
    recurringUnavailableId,
  );

  const confirmedBlockout = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: schedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${vocalId}::0`,
        memberId: unavailableId,
        serviceDate: "2026-07-05",
        allowBlockout: true,
      },
    },
  );
  assert.equal(confirmedBlockout.statusCode, 200);
  assert.equal(
    getMemberId(
      confirmedBlockout.payload.schedule.assignments?.[occurrenceId]?.[
        `${vocalId}::0`
      ],
    ),
    unavailableId,
  );
});

test("atomic assignment batches reject a row as a whole and require the current conflict fingerprint", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("atomic_assignment_batch");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal" }, { name: "Keys" }, { name: "Drums" }],
    members: [
      { firstName: "Avery", lastName: "Stone", positions: ["Vocal"] },
      { firstName: "Blair", lastName: "Reed", positions: ["Keys"] },
      { firstName: "Casey", lastName: "Lee", positions: ["Drums"] },
    ],
  });
  const production = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Production", memberIds: [] },
  });
  const productionTeamId = production.payload.team.teamId;
  const camera = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Camera", teamId: productionTeamId },
  });
  const cameraId = camera.payload.position.positionId;
  const caseyId = worship.memberIds.Casey;
  await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId: caseyId },
    body: {
      firstName: "Casey",
      lastName: "Lee",
      positionIds: [worship.positionIds.Drums, cameraId],
      blockoutDates: [],
    },
  });
  await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId: productionTeamId },
    body: { name: "Production", memberIds: [caseyId] },
  });

  const occurrenceId = "svc@2026-07-05T10:00:00.000Z";
  const occurrence = {
    occurrenceId,
    serviceId: "svc",
    name: "Sunday",
    startsAt: "2026-07-05T10:00:00.000Z",
    positionRequirements: Object.values(worship.positionIds).map(
      (positionId) => ({ positionId, count: 1 }),
    ),
  };
  const target = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Worship July",
      teamId: worship.teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["svc"],
      occurrences: [occurrence],
    },
  });
  const otherOccurrence = {
    ...occurrence,
    positionRequirements: [{ positionId: cameraId, count: 1 }],
  };
  const other = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Production July",
      teamId: productionTeamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["svc"],
      occurrences: [otherOccurrence],
    },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId: other.payload.schedule.scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${cameraId}::0`,
      memberId: caseyId,
      serviceDate: "2026-07-05",
    },
  });

  const changes = [
    [worship.positionIds.Vocal, worship.memberIds.Avery],
    [worship.positionIds.Keys, worship.memberIds.Blair],
    [worship.positionIds.Drums, caseyId],
  ].map(([positionId, memberId]) => ({
    serviceId: occurrenceId,
    positionSlotKey: `${positionId}::0`,
    serviceDate: "2026-07-05",
    expectedCell: "",
    assignment: { primaryMemberId: memberId },
  }));
  const blocked = await callHandler(
    authHandlers.updateTeamScheduleAssignmentsBatch,
    {
      context,
      params: { scheduleId: target.payload.schedule.scheduleId },
      body: { changes },
    },
  );
  assert.equal(blocked.statusCode, 409);
  assert.ok(blocked.payload.conflictFingerprint);
  assert.equal(blocked.payload.occurrenceConflicts.length, 1);
  assert.deepEqual(
    (await getDoc("teamSchedules", target.payload.schedule.scheduleId))
      .assignments,
    {},
  );

  const otherSchedule = await getDoc(
    "teamSchedules",
    other.payload.schedule.scheduleId,
  );
  await setDoc("teamSchedules", other.payload.schedule.scheduleId, {
    ...otherSchedule,
    occurrences: [
      ...otherSchedule.occurrences,
      {
        ...otherOccurrence,
        occurrenceId: "svc-joined@2026-07-05T10:00:00.000Z",
        serviceIds: ["svc", "svc-joined"],
      },
    ],
    serviceIds: ["svc", "svc-joined"],
    assignments: {
      ...otherSchedule.assignments,
      "svc-joined@2026-07-05T10:00:00.000Z": {
        [`${cameraId}::0`]: { primaryMemberId: caseyId },
      },
    },
  });
  const stale = await callHandler(
    authHandlers.updateTeamScheduleAssignmentsBatch,
    {
      context,
      params: { scheduleId: target.payload.schedule.scheduleId },
      body: {
        changes,
        confirmedOccurrenceConflictFingerprint:
          blocked.payload.conflictFingerprint,
      },
    },
  );
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.payload.occurrenceConflicts.length, 2);
  assert.notEqual(
    stale.payload.conflictFingerprint,
    blocked.payload.conflictFingerprint,
  );
  assert.deepEqual(
    (await getDoc("teamSchedules", target.payload.schedule.scheduleId))
      .assignments,
    {},
  );

  const confirmed = await callHandler(
    authHandlers.updateTeamScheduleAssignmentsBatch,
    {
      context,
      params: { scheduleId: target.payload.schedule.scheduleId },
      body: {
        changes,
        confirmedOccurrenceConflictFingerprint:
          stale.payload.conflictFingerprint,
      },
    },
  );
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.payload.accepted.length, 3);
  assert.equal(
    getMemberId(
      confirmed.payload.schedule.assignments[occurrenceId][
        `${worship.positionIds.Vocal}::0`
      ],
    ),
    worship.memberIds.Avery,
  );
  assert.equal(
    getMemberId(
      confirmed.payload.schedule.assignments[occurrenceId][
        `${worship.positionIds.Keys}::0`
      ],
    ),
    worship.memberIds.Blair,
  );
  assert.equal(
    getMemberId(
      confirmed.payload.schedule.assignments[occurrenceId][
        `${worship.positionIds.Drums}::0`
      ],
    ),
    caseyId,
  );
});

test("schedule assignments fall back to one slot when occurrence requirements are missing", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("assignment_requirement_fallback");
  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Media",
    positions: [{ name: "Camera", icon: "camera" }],
    members: [{ firstName: "Avery", lastName: "Stone", positions: ["Camera"] }],
  });
  const cameraId = positionIds.Camera;
  const averyId = memberIds.Avery;
  const occurrenceId = "service-media@2026-06-03T23:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "June Media",
      teamId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      serviceIds: ["service-media"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "service-media",
          name: "Wednesday",
          startsAt: "2026-06-03T23:00:00.000Z",
        },
      ],
    },
  });

  const assigned = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: schedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${cameraId}::0`,
        memberId: averyId,
        serviceDate: "2026-06-03",
      },
    },
  );
  assert.equal(assigned.statusCode, 200);
  assert.equal(
    getMemberId(
      assigned.payload.schedule.assignments?.[occurrenceId]?.[`${cameraId}::0`],
    ),
    averyId,
  );

  const optionalSlot = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: schedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${cameraId}::1`,
        memberId: averyId,
        serviceDate: "2026-06-03",
      },
    },
  );
  assert.equal(optionalSlot.statusCode, 400);
  assert.match(optionalSlot.payload.errorMessage, /add this position/i);
});

test("schedule assignments support schedule-only guests without exposing contact details", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("guest_assignments");
  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Production",
    positions: [{ name: "Camera" }, { name: "Slides" }],
    members: [
      { firstName: "Taylor", lastName: "Morgan", positions: ["Camera", "Slides"] },
      { firstName: "Jordan", lastName: "Reed", positions: ["Camera", "Slides"] },
    ],
  });
  const occurrenceId = "service-main@2026-08-16T14:00:00.000Z";
  const scheduleRes = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "August Production",
      teamId,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      serviceIds: ["service-main"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "service-main",
          name: "Sunday",
          startsAt: "2026-08-16T14:00:00.000Z",
          positionRequirements: [
            { positionId: positionIds.Camera, count: 1 },
            { positionId: positionIds.Slides, count: 1 },
          ],
        },
      ],
    },
  });
  const scheduleId = scheduleRes.payload.schedule.scheduleId;

  const assigned = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${positionIds.Camera}::0`,
        memberId: null,
        serviceDate: "2026-08-16",
        guest: {
          name: "Jordan Avery",
          email: "jordan@example.com",
          phone: "555-0100",
          note: "Visiting camera operator",
        },
      },
    },
  );
  assert.equal(assigned.statusCode, 200);
  const guest = assigned.payload.schedule.guests[0];
  assert.match(guest.guestId, /^scheduleGuest_/);
  assert.equal(guest.name, "Jordan Avery");
  assert.equal(guest.email, "jordan@example.com");
  assert.equal(
    getMemberId(
      assigned.payload.schedule.assignments[occurrenceId][
        `${positionIds.Camera}::0`
      ],
    ),
    guest.guestId,
  );

  const guestShadow = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${positionIds.Slides}::0`,
        memberId: guest.guestId,
        serviceDate: "2026-08-16",
        shadowAction: "add",
        shadowKind: "shadow",
      },
    },
  );
  assert.equal(guestShadow.statusCode, 400);
  assert.match(
    guestShadow.payload.errorMessage,
    /Guests can only fill the primary assignment/i,
  );

  // Backward compatibility: a client released before guest catalogs existed
  // can still edit the schedule without silently orphaning this assignment.
  const legacyUpdate = await callHandler(authHandlers.updateTeamSchedule, {
    context,
    params: { scheduleId },
    body: {
      name: assigned.payload.schedule.name,
      teamId,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      serviceIds: ["service-main"],
      occurrences: assigned.payload.schedule.occurrences,
      assignments: assigned.payload.schedule.assignments,
    },
  });
  assert.equal(legacyUpdate.statusCode, 200);
  assert.equal(legacyUpdate.payload.schedule.guests[0].guestId, guest.guestId);

  const duplicate = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${positionIds.Slides}::0`,
        memberId: guest.guestId,
        serviceDate: "2026-08-16",
      },
    },
  );
  assert.equal(duplicate.statusCode, 400);
  assert.match(duplicate.payload.errorMessage, /one position per service/i);

  const link = await callHandler(authHandlers.getTeamSchedulePublicLink, {
    context,
    params: { scheduleId },
  });
  const publicSchedule = await callHandler(authHandlers.getPublicTeamSchedule, {
    context,
    query: { token: link.payload.publicToken },
  });
  assert.equal(publicSchedule.statusCode, 200);
  assert.deepEqual(
    publicSchedule.payload.members.find(
      (person) => person.memberId === guest.guestId,
    ),
    { memberId: guest.guestId, name: "Jordan", guest: true },
  );
  assert.equal("guests" in publicSchedule.payload.schedule, false);
  assert.equal(
    JSON.stringify(publicSchedule.payload).includes("jordan@example.com"),
    false,
  );
  assert.equal(
    JSON.stringify(publicSchedule.payload).includes("555-0100"),
    false,
  );

  const occupiesSource = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${positionIds.Slides}::0`,
      memberId: memberIds.Taylor,
      serviceDate: "2026-08-16",
    },
  });
  assert.equal(occupiesSource.statusCode, 200);

  const staleMove = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${positionIds.Camera}::0`,
        memberId: guest.guestId,
        serviceDate: "2026-08-16",
        sourceServiceId: occurrenceId,
        sourcePositionSlotKey: `${positionIds.Slides}::0`,
      },
    },
  );
  assert.equal(staleMove.statusCode, 409);
  assert.match(staleMove.payload.errorMessage, /assignment changed/i);

  await setDoc("teamSchedules", scheduleId, {
    ...occupiesSource.payload.schedule,
    assignments: {
      ...occupiesSource.payload.schedule.assignments,
      [occurrenceId]: {
        ...occupiesSource.payload.schedule.assignments[occurrenceId],
        [`${positionIds.Camera}::0`]: {
          primaryMemberId: guest.guestId,
          shadows: [{ memberId: memberIds.Jordan, kind: "shadow" }],
        },
      },
    },
  });

  const moved = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${positionIds.Slides}::0`,
      memberId: guest.guestId,
      serviceDate: "2026-08-16",
      sourceServiceId: occurrenceId,
      sourcePositionSlotKey: `${positionIds.Camera}::0`,
    },
  });
  assert.equal(moved.statusCode, 200);
  assert.deepEqual(
    moved.payload.schedule.assignments[occurrenceId][`${positionIds.Camera}::0`],
    { shadows: [{ memberId: memberIds.Jordan, kind: "shadow" }] },
  );
  assert.equal(
    getMemberId(moved.payload.schedule.assignments[occurrenceId][`${positionIds.Slides}::0`]),
    guest.guestId,
  );

  const clearedGuest = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${positionIds.Slides}::0`,
      memberId: null,
      serviceDate: "2026-08-16",
    },
  });
  assert.equal(clearedGuest.statusCode, 200);
  assert.equal(clearedGuest.payload.schedule.guests[0].guestId, guest.guestId);
  assert.equal(clearedGuest.payload.schedule.assignments[occurrenceId]?.[`${positionIds.Slides}::0`], undefined);

  const memberSource = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${positionIds.Camera}::0`,
      memberId: memberIds.Taylor,
      serviceDate: "2026-08-16",
    },
  });
  assert.equal(memberSource.statusCode, 200);
  await setDoc("teamSchedules", scheduleId, {
    ...memberSource.payload.schedule,
    assignments: {
      ...memberSource.payload.schedule.assignments,
      [occurrenceId]: {
        ...memberSource.payload.schedule.assignments[occurrenceId],
        [`${positionIds.Camera}::0`]: memberIds.Taylor,
      },
    },
  });
  const movedMember = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${positionIds.Slides}::0`,
      memberId: memberIds.Taylor,
      serviceDate: "2026-08-16",
      sourceServiceId: occurrenceId,
      sourcePositionSlotKey: `${positionIds.Camera}::0`,
    },
  });
  assert.equal(movedMember.statusCode, 200);
  assert.equal(movedMember.payload.schedule.assignments[occurrenceId][`${positionIds.Camera}::0`], undefined);
  assert.equal(
    getMemberId(movedMember.payload.schedule.assignments[occurrenceId][`${positionIds.Slides}::0`]),
    memberIds.Taylor,
  );
});

test("targeted guest edits and removals preserve schedule state and clear only guest assignments", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("guest_targeted_mutations");
  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Production",
    positions: [{ name: "Camera" }, { name: "Slides" }],
    members: [
      { firstName: "Rae", lastName: "One", positions: ["Camera", "Slides"] },
      { firstName: "Kai", lastName: "Two", positions: ["Camera", "Slides"] },
    ],
  });
  const occurrenceId = "service-main@2026-08-23T14:00:00.000Z";
  const guestId = "scheduleGuest_targeted";
  const unusedGuestId = "scheduleGuest_unused";
  const created = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "August Production",
      teamId,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      serviceIds: ["service-main"],
      occurrences: [{
        occurrenceId,
        serviceId: "service-main",
        name: "Sunday",
        startsAt: "2026-08-23T14:00:00.000Z",
        positionRequirements: [
          { positionId: positionIds.Camera, count: 2 },
          { positionId: positionIds.Slides, count: 1 },
        ],
      }],
    },
  });
  const scheduleId = created.payload.schedule.scheduleId;
  const cameraCell = `${positionIds.Camera}::0`;
  const slidesCell = `${positionIds.Slides}::0`;
  const initialAssignments = {
    [occurrenceId]: {
      [cameraCell]: {
        primaryMemberId: guestId,
        shadows: [{ memberId: memberIds.Rae, kind: "shadow" }],
      },
      [slidesCell]: {
        primaryMemberId: memberIds.Rae,
        shadows: [
          { memberId: guestId, kind: "reverse_shadow" },
          { memberId: memberIds.Kai, kind: "shadow" },
        ],
      },
    },
  };
  await setDoc("teamSchedules", scheduleId, {
    ...created.payload.schedule,
    guests: [
      { guestId, name: "Alex Rivera", email: "alex@example.com" },
      { guestId: unusedGuestId, name: "Unused Guest" },
    ],
    assignments: initialAssignments,
    microphoneAssignments: { [occurrenceId]: { [cameraCell]: ["mic-a"] } },
    iemAssignments: { [occurrenceId]: { [slidesCell]: ["iem-a"] } },
    responses: {
      [occurrenceId]: {
        [cameraCell]: { memberId: guestId, response: "accepted", respondedAt: "2026-08-20T10:00:00.000Z" },
        [slidesCell]: { memberId: memberIds.Rae, response: "accepted", respondedAt: "2026-08-20T10:00:00.000Z" },
      },
    },
  });

  const edited = await callHandler(authHandlers.updateTeamScheduleGuest, {
    context,
    params: { churchId: context.churchId, scheduleId },
    body: { guest: { guestId, name: "Alex R.", email: "ALEX@example.com", phone: "555-0123", note: "Updated" } },
  });
  assert.equal(edited.statusCode, 200);
  assert.deepEqual(edited.payload.schedule.guests[0], {
    guestId, name: "Alex R.", email: "alex@example.com", phone: "555-0123", note: "Updated",
  });
  assert.deepEqual(edited.payload.schedule.assignments, initialAssignments);
  assert.deepEqual(edited.payload.schedule.microphoneAssignments, {
    [occurrenceId]: { [cameraCell]: ["mic-a"] },
  });
  assert.deepEqual(edited.payload.schedule.iemAssignments, {
    [occurrenceId]: { [slidesCell]: ["iem-a"] },
  });

  const unusedRemoved = await callHandler(authHandlers.removeTeamScheduleGuest, {
    context,
    params: { churchId: context.churchId, scheduleId },
    body: { guestId: unusedGuestId },
  });
  assert.equal(unusedRemoved.statusCode, 200);
  assert.deepEqual(unusedRemoved.payload.schedule.guests.map((item) => item.guestId), [guestId]);
  assert.deepEqual(unusedRemoved.payload.schedule.assignments, initialAssignments);

  const removed = await callHandler(authHandlers.removeTeamScheduleGuest, {
    context,
    params: { churchId: context.churchId, scheduleId },
    body: { guestId },
  });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.payload.schedule.guests, []);
  assert.deepEqual(removed.payload.schedule.assignments[occurrenceId][cameraCell], {
    shadows: [{ memberId: memberIds.Rae, kind: "shadow" }],
  });
  assert.deepEqual(removed.payload.schedule.assignments[occurrenceId][slidesCell], {
    primaryMemberId: memberIds.Rae,
    shadows: [{ memberId: memberIds.Kai, kind: "shadow" }],
  });
  assert.deepEqual(removed.payload.schedule.microphoneAssignments, edited.payload.schedule.microphoneAssignments);
  assert.deepEqual(removed.payload.schedule.iemAssignments, edited.payload.schedule.iemAssignments);
  assert.equal(removed.payload.schedule.responses[occurrenceId][cameraCell], undefined);
  assert.deepEqual(removed.payload.schedule.responses[occurrenceId][slidesCell], {
    memberId: memberIds.Rae,
    response: "accepted",
    respondedAt: "2026-08-20T10:00:00.000Z",
  });
});

test("overlapping targeted schedule guest and assignment mutations preserve both updates", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("guest_targeted_overlap");
  const { teamId, positionIds } = await seedTeam(context, {
    teamName: "Production",
    positions: [{ name: "Camera" }],
  });
  const occurrenceId = "service-main@2026-08-30T14:00:00.000Z";
  const guestId = "scheduleGuest_overlap";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "August Production", teamId, startDate: "2026-08-01", endDate: "2026-08-31",
      serviceIds: ["service-main"], guests: [{ guestId, name: "Original" }],
      occurrences: [{
        occurrenceId, serviceId: "service-main", name: "Sunday", startsAt: "2026-08-30T14:00:00.000Z",
        positionRequirements: [{ positionId: positionIds.Camera, count: 2 }],
      }],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;
  const [edited, assigned] = await Promise.all([
    callHandler(authHandlers.updateTeamScheduleGuest, {
      context,
      params: { churchId: context.churchId, scheduleId },
      body: { guest: { guestId, name: "Updated" } },
    }),
    callHandler(authHandlers.updateTeamScheduleAssignment, {
      context,
      params: { churchId: context.churchId, scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${positionIds.Camera}::1`,
        memberId: null,
        guest: { guestId: "scheduleGuest_recent", name: "Recent Guest" },
        serviceDate: "2026-08-30",
      },
    }),
  ]);
  assert.equal(edited.statusCode, 200);
  assert.equal(assigned.statusCode, 200);
  const current = await getDoc("teamSchedules", scheduleId);
  assert.equal(current.guests.find((item) => item.guestId === guestId).name, "Updated");
  assert.equal(current.guests.find((item) => item.guestId === "scheduleGuest_recent").name, "Recent Guest");
  assert.equal(
    getMemberId(current.assignments[occurrenceId][`${positionIds.Camera}::1`]),
    "scheduleGuest_recent",
  );
});

test("schedule assignments require confirmation for cross-team service conflicts", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("cross_team_conflict");

  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
    members: [{ firstName: "Avery", lastName: "Stone", positions: ["Vocal"] }],
  });
  const productionTeam = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Production", memberIds: [] },
  });
  const productionTeamId = productionTeam.payload.team.teamId;
  const cameraPosition = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Camera", icon: "Camera", teamId: productionTeamId },
  });
  const cameraId = cameraPosition.payload.position.positionId;
  const averyId = worship.memberIds.Avery;
  await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId: averyId },
    body: {
      firstName: "Avery",
      lastName: "Stone",
      positionIds: [worship.positionIds.Vocal, cameraId],
      blockoutDates: [],
    },
  });
  await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId: productionTeamId },
    body: { name: "Production", memberIds: [averyId] },
  });

  const occurrenceId = "svc@2026-07-05T10:00:00.000Z";
  const occurrence = {
    occurrenceId,
    serviceId: "svc",
    name: "Sunday",
    startsAt: "2026-07-05T10:00:00.000Z",
  };
  // More than the former 5,000-schedule cap of unrelated history must not
  // hide the overlapping schedule created below from the assignment check.
  await Promise.all(
    Array.from({ length: 5001 }, (_, index) => {
      const scheduleId = `old-unrelated-schedule-${index}`;
      return setDoc("teamSchedules", scheduleId, {
        scheduleId,
        churchId: context.churchId,
        teamId: productionTeamId,
        name: "Old unrelated history",
        startDate: "2020-01-01",
        endDate: "2020-01-31",
        serviceIds: [`old-service-${index}`],
        occurrences: [],
        assignments: {},
      });
    }),
  );
  const worshipSchedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Worship July",
      teamId: worship.teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["svc"],
      occurrences: [occurrence],
    },
  });
  const productionSchedule = await callHandler(
    authHandlers.createTeamSchedule,
    {
      context,
      body: {
        name: "Production July",
        teamId: productionTeamId,
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        serviceIds: ["svc"],
        occurrences: [occurrence],
      },
    },
  );

  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId: worshipSchedule.payload.schedule.scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${worship.positionIds.Vocal}::0`,
      memberId: averyId,
      serviceDate: "2026-07-05",
    },
  });

  const blocked = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId: productionSchedule.payload.schedule.scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${cameraId}::0`,
      memberId: averyId,
      serviceDate: "2026-07-05",
    },
  });
  assert.equal(blocked.statusCode, 409);
  assert.match(
    blocked.payload.errorMessage,
    /already scheduled on another team/i,
  );
  assert.equal(blocked.payload.occurrenceConflicts.length, 1);
  assert.ok(blocked.payload.conflictFingerprint);

  // A second overlapping occurrence appears after the operator has reviewed
  // the first warning. The old fingerprint must not authorize the new set.
  const newlyDiscoveredOccurrenceId = "svc-joined@2026-07-05T10:00:00.000Z";
  const currentWorshipSchedule = await getDoc(
    "teamSchedules",
    worshipSchedule.payload.schedule.scheduleId,
  );
  await setDoc("teamSchedules", worshipSchedule.payload.schedule.scheduleId, {
    ...currentWorshipSchedule,
    occurrences: [
      ...(currentWorshipSchedule.occurrences || []),
      {
        ...occurrence,
        occurrenceId: newlyDiscoveredOccurrenceId,
        serviceIds: ["svc", "svc-joined"],
      },
    ],
    serviceIds: ["svc", "svc-joined"],
    assignments: {
      ...(currentWorshipSchedule.assignments || {}),
      [newlyDiscoveredOccurrenceId]: {
        [`${worship.positionIds.Vocal}::0`]: { primaryMemberId: averyId },
      },
    },
  });
  const staleConfirmation = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: productionSchedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${cameraId}::0`,
        memberId: averyId,
        serviceDate: "2026-07-05",
        confirmedOccurrenceConflictFingerprint:
          blocked.payload.conflictFingerprint,
      },
    },
  );
  assert.equal(staleConfirmation.statusCode, 409);
  assert.equal(staleConfirmation.payload.occurrenceConflicts.length, 2);
  assert.notEqual(
    staleConfirmation.payload.conflictFingerprint,
    blocked.payload.conflictFingerprint,
  );

  const bulkBlocked = await callHandler(authHandlers.updateTeamSchedule, {
    context,
    params: { scheduleId: productionSchedule.payload.schedule.scheduleId },
    body: {
      name: "Production July",
      teamId: productionTeamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["svc"],
      occurrences: [occurrence],
      assignments: {
        [occurrenceId]: {
          [`${cameraId}::0`]: { primaryMemberId: averyId },
        },
      },
    },
  });
  assert.equal(bulkBlocked.statusCode, 409);

  const confirmed = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: productionSchedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${cameraId}::0`,
        memberId: averyId,
        serviceDate: "2026-07-05",
        confirmedOccurrenceConflictFingerprint:
          staleConfirmation.payload.conflictFingerprint,
      },
    },
  );
  assert.equal(confirmed.statusCode, 200);
  assert.equal(
    getMemberId(
      confirmed.payload.schedule.assignments?.[occurrenceId]?.[
        `${cameraId}::0`
      ],
    ),
    averyId,
  );

  const retainedConflictSave = await callHandler(
    authHandlers.updateTeamSchedule,
    {
      context,
      params: { scheduleId: productionSchedule.payload.schedule.scheduleId },
      body: {
        name: "Production July",
        description: "Updated after confirmation",
        teamId: productionTeamId,
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        serviceIds: ["svc"],
        occurrences: [occurrence],
        assignments: confirmed.payload.schedule.assignments,
      },
    },
  );
  assert.equal(retainedConflictSave.statusCode, 200);

  const copiedScheduleBlocked = await callHandler(
    authHandlers.createTeamSchedule,
    {
      context,
      body: {
        name: "Production Copy",
        teamId: productionTeamId,
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        serviceIds: ["svc"],
        occurrences: [occurrence],
        assignments: {
          [occurrenceId]: {
            [`${cameraId}::0`]: { primaryMemberId: averyId },
          },
        },
      },
    },
  );
  assert.equal(copiedScheduleBlocked.statusCode, 409);

  const copiedScheduleStillBlocked = await callHandler(
    authHandlers.createTeamSchedule,
    {
      context,
      body: {
        name: "Production Copy",
        teamId: productionTeamId,
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        serviceIds: ["svc"],
        occurrences: [occurrence],
        assignments: {
          [occurrenceId]: {
            [`${cameraId}::0`]: { primaryMemberId: averyId },
          },
        },
        allowCrossTeamConflict: true,
      },
    },
  );
  assert.equal(copiedScheduleStillBlocked.statusCode, 409);

  await setDoc("teamSchedules", "schedule-with-incomplete-conflict-range", {
    scheduleId: "schedule-with-incomplete-conflict-range",
    churchId: context.churchId,
    teamId: productionTeamId,
    name: "Incomplete legacy schedule",
    startDate: "",
    endDate: "",
    serviceIds: [],
    occurrences: [],
    assignments: {},
  });
  const incompleteConflictLookup = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: worshipSchedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${worship.positionIds.Vocal}::0`,
        memberId: averyId,
        serviceDate: "2026-07-05",
      },
    },
  );
  assert.equal(incompleteConflictLookup.statusCode, 409);
  assert.match(
    incompleteConflictLookup.payload.errorMessage,
    /incomplete dates.*checked safely/i,
  );
});

test("joined and standalone member service occurrences require cross-team conflict confirmation", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext(
    "joined_service_cross_team_conflict",
  );
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [
      { name: "Vocal", icon: "mic" },
      { name: "Keys", icon: "piano" },
    ],
    members: [
      { firstName: "Avery", lastName: "Stone", positions: ["Vocal", "Keys"] },
      { firstName: "Casey", lastName: "Jones", positions: ["Vocal", "Keys"] },
    ],
  });
  const production = await seedTeam(context, {
    teamName: "Production",
    positions: [
      { name: "Camera", icon: "camera" },
      { name: "Lights", icon: "lightbulb" },
    ],
  });
  const sharedMemberIds = Object.values(worship.memberIds);
  for (const [memberName, memberId] of Object.entries(worship.memberIds)) {
    await callHandler(authHandlers.updateTeamRosterMember, {
      context,
      params: { memberId },
      body: {
        firstName: memberName,
        lastName: memberName === "Avery" ? "Stone" : "Jones",
        positionIds: [
          worship.positionIds.Vocal,
          worship.positionIds.Keys,
          production.positionIds.Camera,
          production.positionIds.Lights,
        ],
        blockoutDates: [],
      },
    });
  }
  await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId: production.teamId },
    body: { name: "Production", memberIds: sharedMemberIds },
  });

  // Service A is at 10:00 and service B is at 11:00. The joined row uses A's
  // earlier time while the production schedule stores B on its own.
  const joinedOccurrence = {
    occurrenceId: "group:weekend@2026-10-03",
    serviceId: "service-a",
    serviceIds: ["service-a", "service-b"],
    groupId: "weekend",
    name: "Service A & Service B",
    startsAt: "2026-10-03T10:00:00.000Z",
  };
  const standaloneOccurrence = {
    occurrenceId: "service-b@2026-10-03T11:00:00.000Z",
    serviceId: "service-b",
    serviceIds: ["service-b"],
    name: "Service B",
    startsAt: "2026-10-03T11:00:00.000Z",
  };
  const worshipSchedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Worship October",
      teamId: worship.teamId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      serviceIds: ["service-a", "service-b"],
      occurrences: [joinedOccurrence],
    },
  });
  const productionSchedule = await callHandler(
    authHandlers.createTeamSchedule,
    {
      context,
      body: {
        name: "Production October",
        teamId: production.teamId,
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        serviceIds: ["service-b"],
        occurrences: [standaloneOccurrence],
      },
    },
  );
  assert.equal(worshipSchedule.statusCode, 200);
  assert.equal(productionSchedule.statusCode, 200);

  const assign = async (
    scheduleId,
    occurrenceId,
    positionId,
    memberId,
    fingerprint = "",
  ) =>
    callHandler(authHandlers.updateTeamScheduleAssignment, {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${positionId}::0`,
        memberId,
        serviceDate: "2026-10-03",
        ...(fingerprint
          ? { confirmedOccurrenceConflictFingerprint: fingerprint }
          : {}),
      },
    });

  const averyId = worship.memberIds.Avery;
  const firstAssignment = await assign(
    worshipSchedule.payload.schedule.scheduleId,
    joinedOccurrence.occurrenceId,
    worship.positionIds.Vocal,
    averyId,
  );
  assert.equal(firstAssignment.statusCode, 200);
  const blockedStandalone = await assign(
    productionSchedule.payload.schedule.scheduleId,
    standaloneOccurrence.occurrenceId,
    production.positionIds.Camera,
    averyId,
  );
  assert.equal(blockedStandalone.statusCode, 409);
  assert.match(
    blockedStandalone.payload.errorMessage,
    /already scheduled on another team/i,
  );
  const confirmedStandalone = await assign(
    productionSchedule.payload.schedule.scheduleId,
    standaloneOccurrence.occurrenceId,
    production.positionIds.Camera,
    averyId,
    blockedStandalone.payload.conflictFingerprint,
  );
  assert.equal(confirmedStandalone.statusCode, 200);

  // Exercise the opposite direction with a second shared roster member.
  const caseyId = worship.memberIds.Casey;
  const standaloneFirst = await assign(
    productionSchedule.payload.schedule.scheduleId,
    standaloneOccurrence.occurrenceId,
    production.positionIds.Lights,
    caseyId,
  );
  assert.equal(standaloneFirst.statusCode, 200);
  const blockedJoined = await assign(
    worshipSchedule.payload.schedule.scheduleId,
    joinedOccurrence.occurrenceId,
    worship.positionIds.Keys,
    caseyId,
  );
  assert.equal(blockedJoined.statusCode, 409);
  const confirmedJoined = await assign(
    worshipSchedule.payload.schedule.scheduleId,
    joinedOccurrence.occurrenceId,
    worship.positionIds.Keys,
    caseyId,
    blockedJoined.payload.conflictFingerprint,
  );
  assert.equal(confirmedJoined.statusCode, 200);
});

test("occurrence conflict checks include same-team roles, different dates, and archived schedules", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("cross_team_no_conflict");

  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
    members: [{ firstName: "Avery", lastName: "Stone", positions: ["Vocal"] }],
  });
  const productionTeam = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Production", memberIds: [] },
  });
  const productionTeamId = productionTeam.payload.team.teamId;
  const cameraPosition = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Camera", teamId: productionTeamId },
  });
  const cameraId = cameraPosition.payload.position.positionId;
  const averyId = worship.memberIds.Avery;
  await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId: averyId },
    body: {
      firstName: "Avery",
      lastName: "Stone",
      positionIds: [worship.positionIds.Vocal, cameraId],
      blockoutDates: [],
    },
  });
  await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId: productionTeamId },
    body: { name: "Production", memberIds: [averyId] },
  });

  const firstOccurrence = {
    occurrenceId: "svc@2026-07-05T10:00:00.000Z",
    serviceId: "svc",
    name: "Sunday",
    startsAt: "2026-07-05T10:00:00.000Z",
  };
  const secondOccurrence = {
    occurrenceId: "svc@2026-07-12T10:00:00.000Z",
    serviceId: "svc",
    name: "Sunday",
    startsAt: "2026-07-12T10:00:00.000Z",
  };

  const archivedSchedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Archived Production",
      teamId: productionTeamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["svc"],
      occurrences: [firstOccurrence],
      assignments: {
        [firstOccurrence.occurrenceId]: {
          [`${cameraId}::0`]: { primaryMemberId: averyId },
        },
      },
    },
  });
  assert.equal(archivedSchedule.statusCode, 200);
  await callHandler(authHandlers.archiveTeamSchedule, {
    context,
    params: { scheduleId: archivedSchedule.payload.schedule.scheduleId },
  });

  const worshipSchedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Worship",
      teamId: worship.teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["svc"],
      occurrences: [firstOccurrence],
    },
  });
  const sameTeamSchedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Worship same team",
      teamId: worship.teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["svc"],
      occurrences: [firstOccurrence],
    },
  });
  const differentDateSchedule = await callHandler(
    authHandlers.createTeamSchedule,
    {
      context,
      body: {
        name: "Production different date",
        teamId: productionTeamId,
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        serviceIds: ["svc"],
        occurrences: [secondOccurrence],
      },
    },
  );

  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId: worshipSchedule.payload.schedule.scheduleId },
    body: {
      serviceId: firstOccurrence.occurrenceId,
      positionSlotKey: `${worship.positionIds.Vocal}::0`,
      memberId: averyId,
      serviceDate: "2026-07-05",
    },
  });

  const sameTeam = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: sameTeamSchedule.payload.schedule.scheduleId },
      body: {
        serviceId: firstOccurrence.occurrenceId,
        positionSlotKey: `${worship.positionIds.Vocal}::0`,
        memberId: averyId,
        serviceDate: "2026-07-05",
      },
    },
  );
  assert.equal(sameTeam.statusCode, 409);
  const sameTeamConfirmed = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: sameTeamSchedule.payload.schedule.scheduleId },
      body: {
        serviceId: firstOccurrence.occurrenceId,
        positionSlotKey: `${worship.positionIds.Vocal}::0`,
        memberId: averyId,
        serviceDate: "2026-07-05",
        confirmedOccurrenceConflictFingerprint:
          sameTeam.payload.conflictFingerprint,
      },
    },
  );
  assert.equal(sameTeamConfirmed.statusCode, 200);

  const differentDate = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: differentDateSchedule.payload.schedule.scheduleId },
      body: {
        serviceId: secondOccurrence.occurrenceId,
        positionSlotKey: `${cameraId}::0`,
        memberId: averyId,
        serviceDate: "2026-07-12",
      },
    },
  );
  assert.equal(differentDate.statusCode, 200);
});

test("assigning a later occurrence ignores the member's earlier role in the same schedule", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("occurrence_conflict_target_date");
  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Worship Team",
    positions: [
      { name: "Vocal", icon: "mic" },
      { name: "Keys", icon: "piano" },
    ],
    members: [
      { firstName: "Avery", lastName: "Stone", positions: ["Vocal", "Keys"] },
    ],
  });
  const firstOccurrence = {
    occurrenceId: "group:weekend@2026-08-15",
    serviceId: "service-sabbath-school",
    serviceIds: ["service-sabbath-school", "service-worship"],
    name: "Sabbath School & Worship Experience",
    startsAt: "2026-08-15T14:00:00.000Z",
  };
  const targetOccurrence = {
    ...firstOccurrence,
    occurrenceId: "group:weekend@2026-08-29",
    startsAt: "2026-08-29T14:00:00.000Z",
  };
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "August 2026",
      teamId,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      serviceIds: firstOccurrence.serviceIds,
      occurrences: [firstOccurrence, targetOccurrence],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  const earlierAssignment = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: firstOccurrence.occurrenceId,
        positionSlotKey: `${positionIds.Vocal}::0`,
        memberId: memberIds.Avery,
        serviceDate: "2026-08-15",
      },
    },
  );
  assert.equal(earlierAssignment.statusCode, 200);

  const laterAssignment = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: targetOccurrence.occurrenceId,
        positionSlotKey: `${positionIds.Keys}::0`,
        memberId: memberIds.Avery,
        serviceDate: "2026-08-29",
      },
    },
  );
  assert.equal(laterAssignment.statusCode, 200);
  assert.equal(
    getMemberId(
      laterAssignment.payload.schedule.assignments?.[
        targetOccurrence.occurrenceId
      ]?.[`${positionIds.Keys}::0`],
    ),
    memberIds.Avery,
  );
});

test("schedule assignment swaps update both cells atomically", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("assignment_swap");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Worship Team",
    positions: [
      { name: "Vocal", icon: "mic" },
      { name: "Keys", icon: "piano" },
    ],
    members: [
      { firstName: "Avery", lastName: "Stone", positions: ["Vocal", "Keys"] },
      { firstName: "Morgan", lastName: "Lee", positions: ["Vocal", "Keys"] },
      { firstName: "Riley", lastName: "Hart", positions: ["Vocal"] },
      { firstName: "Quinn", lastName: "Baker", positions: ["Keys"] },
    ],
  });
  const vocalSlot = `${positionIds.Vocal}::0`;
  const keysSlot = `${positionIds.Keys}::0`;
  const serviceId = "service-sunday";
  const occurrenceId = "service-sunday@2026-07-05T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "July",
      teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: [serviceId],
      occurrences: [
        {
          occurrenceId,
          serviceId,
          name: "Sunday",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: vocalSlot,
      memberId: memberIds.Avery,
      serviceDate: "2026-07-05",
    },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: keysSlot,
      memberId: memberIds.Morgan,
      serviceDate: "2026-07-05",
    },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: vocalSlot,
      memberId: memberIds.Riley,
      serviceDate: "2026-07-05",
      shadowAction: "add",
      shadowKind: "shadow",
    },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: keysSlot,
      memberId: memberIds.Quinn,
      serviceDate: "2026-07-05",
      shadowAction: "add",
      shadowKind: "shadow",
    },
  });

  const swapped = await callHandler(
    authHandlers.updateTeamScheduleAssignmentSwap,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        targetPositionSlotKey: vocalSlot,
        sourcePositionSlotKey: keysSlot,
        currentMemberId: memberIds.Avery,
        candidateMemberId: memberIds.Morgan,
        serviceDate: "2026-07-05",
      },
    },
  );

  assert.equal(swapped.statusCode, 200);
  const assignments =
    swapped.payload.schedule.assignments?.[occurrenceId] || {};
  assert.equal(getMemberId(assignments[vocalSlot]), memberIds.Morgan);
  assert.equal(getMemberId(assignments[keysSlot]), memberIds.Avery);
  assert.deepEqual(assignments[vocalSlot].shadows, [
    { memberId: memberIds.Riley, kind: "shadow" },
  ]);
  assert.deepEqual(assignments[keysSlot].shadows, [
    { memberId: memberIds.Quinn, kind: "shadow" },
  ]);
});

test("stale schedule assignment swaps leave both cells unchanged", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("assignment_swap_stale");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Worship Team",
    positions: [
      { name: "Vocal", icon: "mic" },
      { name: "Keys", icon: "piano" },
    ],
    members: [
      { firstName: "Avery", lastName: "Stone", positions: ["Vocal", "Keys"] },
      { firstName: "Morgan", lastName: "Lee", positions: ["Vocal", "Keys"] },
      { firstName: "Taylor", lastName: "Cole", positions: ["Vocal", "Keys"] },
    ],
  });
  const vocalSlot = `${positionIds.Vocal}::0`;
  const keysSlot = `${positionIds.Keys}::0`;
  const serviceId = "service-sunday";
  const occurrenceId = "service-sunday@2026-07-12T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "July",
      teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: [serviceId],
      occurrences: [
        {
          occurrenceId,
          serviceId,
          name: "Sunday",
          startsAt: "2026-07-12T10:00:00.000Z",
          positionRequirements: [
            { positionId: positionIds.Vocal, count: 1 },
            { positionId: positionIds.Keys, count: 1 },
          ],
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: vocalSlot,
      memberId: memberIds.Avery,
      serviceDate: "2026-07-12",
    },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: keysSlot,
      memberId: memberIds.Morgan,
      serviceDate: "2026-07-12",
    },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: vocalSlot,
      memberId: memberIds.Taylor,
      serviceDate: "2026-07-12",
    },
  });

  const staleSwap = await callHandler(
    authHandlers.updateTeamScheduleAssignmentSwap,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        targetPositionSlotKey: vocalSlot,
        sourcePositionSlotKey: keysSlot,
        currentMemberId: memberIds.Avery,
        candidateMemberId: memberIds.Morgan,
        serviceDate: "2026-07-12",
      },
    },
  );
  assert.equal(staleSwap.statusCode, 409);
  assert.match(staleSwap.payload.errorMessage, /no longer available/i);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const updatedSchedule = bootstrap.payload.schedules.find(
    (item) => item.scheduleId === scheduleId,
  );
  const assignments = updatedSchedule.assignments?.[occurrenceId] || {};
  assert.equal(getMemberId(assignments[vocalSlot]), memberIds.Taylor);
  assert.equal(getMemberId(assignments[keysSlot]), memberIds.Morgan);
});

test("service plan assignments expose only the selected plan's serving roster", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("service_plan_assignments");
  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Keys", icon: "piano" }],
    members: [{ firstName: "Avery", lastName: "Stone", positions: ["Keys"] }],
  });
  const occurrenceId = "service-sunday@2026-09-05T14:00:00.000Z";
  const planKey = "service-sunday@2026-09-05";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "September",
      teamId,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      serviceIds: ["service-sunday"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "service-sunday",
          name: "Sunday Service",
          startsAt: "2026-09-05T14:00:00.000Z",
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${positionIds.Keys}::0`,
      memberId: memberIds.Avery,
      serviceDate: "2026-09-05",
    },
  });
  await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      serviceId: "service-sunday",
      date: "2026-09-05",
      name: "Sunday Service",
      sections: [],
    },
  });

  const result = await callHandler(authHandlers.getServicePlanAssignments, {
    context,
    params: { planKey },
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.assignments, [
    { teamName: "Worship", role: "Keys", name: "Avery Stone" },
  ]);
});

test("schedule assignment updates broadcast the new schedule over SSE", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("sse_broadcast");
  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Worship Team",
    positions: [{ name: "Vocal", icon: "mic" }],
    members: [{ firstName: "Avery", lastName: "Stone", positions: ["Vocal"] }],
  });
  const serviceId = "service-sunday";
  const occurrenceId = "service-sunday@2026-07-05T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "July",
      teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: [serviceId],
      occurrences: [
        {
          occurrenceId,
          serviceId,
          name: "Sunday",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  const planKey = "service-sunday@2026-07-05";
  const savedPlan = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      serviceId,
      date: "2026-07-05",
      name: "Sunday Service",
      startsAt: "2026-07-05T10:00:00.000Z",
      timezone: "America/New_York",
      sections: [],
    },
  });
  assert.equal(savedPlan.statusCode, 200);
  const published = await callHandler(authHandlers.publishServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(published.statusCode, 200);
  const publicToken = published.payload.publicUrl.split("/").at(-1);

  // Subscribe only after creating the schedule so we observe just the
  // assignment broadcast, not the create one.
  const sseClient = createSseClient();
  const publicSseClient = createSseClient();
  addTeamsSseClient(context.churchId, sseClient);
  addServiceFlowSseClient(publicToken, publicSseClient);
  t.after(() => removeTeamsSseClient(context.churchId, sseClient));
  t.after(() => removeServiceFlowSseClient(publicToken, publicSseClient));

  const slotKey = `${positionIds.Vocal}::0`;
  const assign = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: slotKey,
      memberId: memberIds.Avery,
      serviceDate: "2026-07-05",
    },
  });
  assert.equal(assign.statusCode, 200);

  const updates = sseClient
    .events()
    .filter((event) => event.type === "schedule-updated");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].churchId, context.churchId);
  assert.equal(updates[0].schedule.scheduleId, scheduleId);
  assert.equal(
    getMemberId(updates[0].schedule.assignments?.[occurrenceId]?.[slotKey]),
    memberIds.Avery,
  );
  assert.equal(publicSseClient.events().at(-1)?.type, "service-updated");
});

test("schedule mutations do not broadcast to other churches", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("sse_scope");
  const { teamId } = await seedTeam(context, { teamName: "Solo Team" });

  const otherChurchClient = createSseClient();
  addTeamsSseClient("some_other_church", otherChurchClient);
  t.after(() => removeTeamsSseClient("some_other_church", otherChurchClient));

  await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "August",
      teamId,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      serviceIds: ["service-x"],
      occurrences: [
        {
          occurrenceId: "service-x@2026-08-02T10:00:00.000Z",
          serviceId: "service-x",
          name: "Sunday",
          startsAt: "2026-08-02T10:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(otherChurchClient.events().length, 0);
});

test("schedule assignments support multiple slots of the same position", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("slots");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Camera Team",
    positions: [{ name: "Camera", icon: "Camera" }],
    members: [
      { firstName: "Ada", lastName: "Reed", positions: ["Camera"] },
      { firstName: "Ben", lastName: "Cole", positions: ["Camera"] },
    ],
  });
  const cameraId = positionIds.Camera;
  const adaId = memberIds.Ada;
  const benId = memberIds.Ben;

  const serviceId = "service-sunday";
  const occurrenceId = "service-sunday@2026-07-12T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "July",
      teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: [serviceId],
      occurrences: [
        {
          occurrenceId,
          serviceId,
          name: "Sunday",
          startsAt: "2026-07-12T10:00:00.000Z",
          positionRequirements: [{ positionId: cameraId, count: 2 }],
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  // Slot 0 ("positionId::0") and slot 1 ("positionId::1") are distinct cells.
  const slotZero = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${cameraId}::0`,
        memberId: adaId,
        serviceDate: "2026-07-12",
      },
    },
  );
  assert.equal(slotZero.statusCode, 200);

  const slotOne = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${cameraId}::1`,
      memberId: benId,
      serviceDate: "2026-07-12",
    },
  });
  assert.equal(slotOne.statusCode, 200);

  const assignments =
    slotOne.payload.schedule.assignments?.[occurrenceId] || {};
  assert.equal(getMemberId(assignments[`${cameraId}::0`]), adaId);
  assert.equal(getMemberId(assignments[`${cameraId}::1`]), benId);

  // One person still cannot fill two camera slots in the same service.
  const doubleBooked = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${cameraId}::1`,
        memberId: adaId,
        serviceDate: "2026-07-12",
      },
    },
  );
  assert.equal(doubleBooked.statusCode, 400);
  assert.match(doubleBooked.payload.errorMessage, /one position per service/i);

  // Deleting the position scrubs every slot, including "positionId::1".
  await callHandler(authHandlers.deleteTeamPosition, {
    context,
    params: { positionId: cameraId },
  });
  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const updatedSchedule = bootstrap.payload.schedules.find(
    (item) => item.scheduleId === scheduleId,
  );
  assert.equal(
    updatedSchedule.assignments?.[occurrenceId]?.[`${cameraId}::0`],
    undefined,
  );
  assert.equal(
    updatedSchedule.assignments?.[occurrenceId]?.[`${cameraId}::1`],
    undefined,
  );
});

test("legacy schedule occurrences use service requirements for slot validation", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("legacy_slot_requirements");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Legacy Camera Team",
    positions: [{ name: "Camera", icon: "Camera" }],
    members: [
      { firstName: "Ada", lastName: "Reed", positions: ["Camera"] },
      { firstName: "Ben", lastName: "Cole", positions: ["Camera"] },
    ],
  });
  const cameraId = positionIds.Camera;
  const serviceId = "legacy-service-sunday";
  const occurrenceId = `${serviceId}@2026-08-09T10:00:00.000Z`;
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: serviceId,
        positionRequirements: [{ positionId: cameraId, count: 2 }],
      },
    ],
  });

  const created = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Legacy August",
      teamId,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      serviceIds: [serviceId],
      occurrences: [
        {
          occurrenceId,
          serviceId,
          name: "Sunday",
          startsAt: "2026-08-09T10:00:00.000Z",
          // Reproduces schedules generated before standalone occurrences
          // copied their service requirement snapshot.
          positionRequirements: [],
        },
      ],
    },
  });
  const scheduleId = created.payload.schedule.scheduleId;
  assert.deepEqual(
    created.payload.schedule.occurrences[0].positionRequirements,
    [],
  );

  const slotZero = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${cameraId}::0`,
        memberId: memberIds.Ada,
        serviceDate: "2026-08-09",
      },
    },
  );
  assert.equal(slotZero.statusCode, 200);

  const slotOne = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${cameraId}::1`,
      memberId: memberIds.Ben,
      serviceDate: "2026-08-09",
    },
  });
  assert.equal(slotOne.statusCode, 200);

  const slotTwo = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${cameraId}::2`,
      memberId: memberIds.Ada,
      serviceDate: "2026-08-09",
    },
  });
  assert.equal(slotTwo.statusCode, 400);
  assert.match(slotTwo.payload.errorMessage, /add this position/i);
});

test("deleting a member scrubs primary and shadow slots of object cells", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_scrub");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
    members: [
      { firstName: "Lead", lastName: "Singer", positions: ["Vocal"] },
      { firstName: "Under", lastName: "Study", positions: ["Vocal"] },
    ],
  });
  const vocalId = positionIds.Vocal;
  const leadId = memberIds.Lead;
  const understudyId = memberIds.Under;

  const serviceId = "svc";
  const occurrenceId = "svc@2026-07-05T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "July",
      teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: [serviceId],
      occurrences: [
        {
          occurrenceId,
          serviceId,
          name: "Sunday",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  // Lead as primary, understudy as a shadow on the same position -> an object cell.
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${vocalId}::0`,
      memberId: leadId,
      serviceDate: "2026-07-05",
    },
  });
  const shadowed = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${vocalId}::0`,
        memberId: understudyId,
        serviceDate: "2026-07-05",
        shadowAction: "add",
        shadowKind: "shadow",
      },
    },
  );
  assert.equal(shadowed.statusCode, 200);
  const cell =
    shadowed.payload.schedule.assignments[occurrenceId][`${vocalId}::0`];
  assert.equal(getMemberId(cell), leadId);

  // Deleting the primary keeps the shadow — the cell must survive, not vanish.
  await callHandler(authHandlers.deleteTeamRosterMember, {
    context,
    params: { memberId: leadId },
  });
  let bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  let sched = bootstrap.payload.schedules.find(
    (item) => item.scheduleId === scheduleId,
  );
  const afterPrimary = sched.assignments?.[occurrenceId]?.[`${vocalId}::0`];
  assert.ok(
    afterPrimary,
    "cell should remain while a shadow is still assigned",
  );
  assert.equal(getMemberId(afterPrimary), "");
  assert.deepEqual(
    (afterPrimary.shadows || []).map((shadow) => shadow.memberId),
    [understudyId],
  );

  // Deleting the last (shadow) member empties the cell, so it is dropped.
  await callHandler(authHandlers.deleteTeamRosterMember, {
    context,
    params: { memberId: understudyId },
  });
  bootstrap = await callHandler(authHandlers.getTeamsBootstrap, { context });
  sched = bootstrap.payload.schedules.find(
    (item) => item.scheduleId === scheduleId,
  );
  assert.equal(sched.assignments?.[occurrenceId]?.[`${vocalId}::0`], undefined);
});

test("deleting a team deletes its owned positions and scrubs them", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("team_delete_cascade");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Production",
    positions: [{ name: "Camera", icon: "Camera" }],
    members: [{ firstName: "Ada", lastName: "Reed", positions: ["Camera"] }],
  });
  const cameraId = positionIds.Camera;
  const adaId = memberIds.Ada;

  const occurrenceId = "svc@2026-07-05T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "July",
      teamId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["svc"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc",
          name: "Sunday",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${cameraId}::0`,
      memberId: adaId,
      serviceDate: "2026-07-05",
    },
  });

  const deleted = await callHandler(authHandlers.deleteTeam, {
    context,
    params: { teamId },
  });
  assert.equal(deleted.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  // The team's owned position is gone, the member is unassigned, and the (now
  // orphaned) schedule's assignment for that position is scrubbed.
  assert.equal(
    bootstrap.payload.positions.find(
      (position) => position.positionId === cameraId,
    ),
    undefined,
  );
  assert.equal(
    bootstrap.payload.teams.find((team) => team.teamId === teamId),
    undefined,
  );
  const member = bootstrap.payload.members.find(
    (item) => item.memberId === adaId,
  );
  assert.deepEqual(member.positionIds, []);
  const sched = bootstrap.payload.schedules.find(
    (item) => item.scheduleId === scheduleId,
  );
  assert.equal(
    sched.assignments?.[occurrenceId]?.[`${cameraId}::0`],
    undefined,
  );
});

test("public schedule link returns a sanitized, name-resolved snapshot", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("public_schedule");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Production",
    positions: [
      { name: "Director", icon: "video" },
      { name: "Camera", icon: "Camera" },
    ],
    members: [
      { firstName: "Kevin", lastName: "Cheddar", positions: ["Director"] },
      { firstName: "Alrae", lastName: "Stone", positions: ["Camera"] },
    ],
  });
  const directorId = positionIds.Director;
  const cameraId = positionIds.Camera;
  const kevinId = memberIds.Kevin;

  await callHandler(authHandlers.saveServicePlanMicrophones, {
    context,
    body: {
      microphones: [
        { id: "mic-public", name: "Black", type: "Handheld", color: "#123456" },
        {
          id: "mic-unrelated",
          name: "Private mic",
          type: "Lapel",
          color: "#abcdef",
        },
      ],
      audiences: [],
    },
  });
  await callHandler(authHandlers.saveServiceEquipment, {
    context,
    body: {
      equipment: [
        {
          id: "iem-public",
          category: "iem",
          name: "IEM 1",
          subtype: "wireless-beltpack",
          color: "#654321",
        },
        {
          id: "iem-unrelated",
          category: "iem",
          name: "Private pack",
          subtype: "wired-beltpack",
        },
      ],
    },
  });

  const occurrenceId = "svc@2026-06-06T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "June 2026",
      teamId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      serviceIds: ["svc"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc",
          name: "Sabbath",
          startsAt: "2026-06-06T10:00:00.000Z",
        },
      ],
      microphoneAssignments: {
        [occurrenceId]: {
          [`${directorId}::0`]: ["mic-public", "mic-missing"],
        },
      },
      iemAssignments: {
        [occurrenceId]: {
          [`${directorId}::0`]: ["iem-public", "iem-missing"],
        },
      },
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${directorId}::0`,
      memberId: kevinId,
      serviceDate: "2026-06-06",
    },
  });
  const persistedSchedule = await getDoc("teamSchedules", scheduleId);
  await setDoc(
    "teamSchedules",
    scheduleId,
    {
      source: "generated-period",
      occurrences: [
        ...persistedSchedule.occurrences,
        {
          occurrenceId: "unrelated-service@2026-06-20T10:00:00.000Z",
          serviceId: "unrelated-service",
          name: "Unrelated service",
          startsAt: "2026-06-20T10:00:00.000Z",
          positionRequirements: [
            { positionId: "another-team-position", count: 1 },
          ],
        },
      ],
    },
    { merge: true },
  );

  // Admin mints the public link (idempotent: same token on repeat).
  const link = await callHandler(authHandlers.getTeamSchedulePublicLink, {
    context,
    params: { scheduleId },
  });
  assert.equal(link.statusCode, 200);
  const token = link.payload.publicToken;
  assert.ok(token);
  const link2 = await callHandler(authHandlers.getTeamSchedulePublicLink, {
    context,
    params: { scheduleId },
  });
  assert.equal(link2.payload.publicToken, token);

  // Unauthenticated read by token.
  const publicReq = {
    params: {},
    headers: {},
    session: createSession(),
    body: {},
    query: { token },
  };
  const publicRes = createRes();
  await authHandlers.getPublicTeamSchedule(publicReq, publicRes);
  assert.equal(publicRes.statusCode, 200);
  assert.equal(publicRes.payload.schedule.name, "June 2026");
  assert.deepEqual(
    publicRes.payload.schedule.occurrences.map(
      (occurrence) => occurrence.occurrenceId,
    ),
    [occurrenceId],
  );
  assert.equal(publicRes.payload.teamName, "Production");
  assert.equal(
    publicRes.payload.schedule.assignments[occurrenceId][`${directorId}::0`]
      .primaryMemberId,
    kevinId,
  );
  assert.deepEqual(
    publicRes.payload.schedule.microphoneAssignments[occurrenceId][
      `${directorId}::0`
    ],
    ["mic-public", "mic-missing"],
  );
  assert.deepEqual(
    publicRes.payload.schedule.iemAssignments[occurrenceId][`${directorId}::0`],
    ["iem-public", "iem-missing"],
  );
  assert.deepEqual(publicRes.payload.microphones, [
    {
      id: "mic-public",
      name: "Black",
      type: "Handheld",
      color: "#123456",
      category: "microphone",
    },
  ]);
  assert.deepEqual(publicRes.payload.serviceEquipment, [
    {
      id: "iem-public",
      category: "iem",
      name: "IEM 1",
      subtype: "wireless-beltpack",
      color: "#654321",
    },
  ]);
  assert.ok(!JSON.stringify(publicRes.payload).includes("Private mic"));
  assert.ok(!JSON.stringify(publicRes.payload).includes("Private pack"));

  // Names resolved to first name; full last names never leave the server.
  const kevin = publicRes.payload.members.find(
    (item) => item.memberId === kevinId,
  );
  assert.equal(kevin.name, "Kevin");
  assert.ok(!("lastName" in kevin));
  assert.ok(!JSON.stringify(publicRes.payload).includes("Cheddar"));

  // Only assigned members are exposed: Alrae is on the roster but unscheduled,
  // so a public link must never enumerate them.
  const alraeId = memberIds.Alrae;
  assert.ok(
    !publicRes.payload.members.some((item) => item.memberId === alraeId),
  );
  assert.ok(!JSON.stringify(publicRes.payload).includes("Alrae"));

  // Only this team's positions are exposed.
  assert.deepEqual(
    publicRes.payload.positions.map((position) => position.positionId).sort(),
    [directorId, cameraId].sort(),
  );
  assert.equal(
    publicRes.payload.positions.find(
      (position) => position.positionId === directorId,
    ).icon,
    "video",
  );

  // Unknown token is a 404.
  const badRes = createRes();
  await authHandlers.getPublicTeamSchedule(
    {
      params: {},
      headers: {},
      session: createSession(),
      body: {},
      query: { token: "not-a-real-token" },
    },
    badRes,
  );
  assert.equal(badRes.statusCode, 404);
});

test("public schedule disambiguates duplicate first names with a last initial", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("public_schedule_dupes");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Vocals",
    positions: [{ name: "Vocal", icon: "mic" }],
    members: [
      { firstName: "Jordan", lastName: "Smith", positions: ["Vocal"] },
      { firstName: "Jordan", lastName: "Lee", positions: ["Vocal"] },
    ],
  });
  const vocalId = positionIds.Vocal;
  void memberIds;

  const occurrenceId = "svc@2026-06-13T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "June",
      teamId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      serviceIds: ["svc"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc",
          name: "Sabbath",
          startsAt: "2026-06-13T10:00:00.000Z",
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  // First names only disambiguate among members actually on the schedule, so
  // both Jordans must be assigned. Their ids collide in the seed helper (keyed by
  // first name), so read them back from the roster and put both on the team.
  const roster = await callHandler(authHandlers.getTeamsBootstrap, { context });
  const jordanIds = roster.payload.members
    .filter((item) => item.firstName === "Jordan")
    .map((item) => item.memberId);
  assert.equal(jordanIds.length, 2);
  await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId },
    body: { name: "Vocals", memberIds: jordanIds },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${vocalId}::0`,
      memberId: jordanIds[0],
      serviceDate: "2026-06-13",
    },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${vocalId}::0`,
      memberId: jordanIds[1],
      serviceDate: "2026-06-13",
      shadowAction: "add",
      shadowKind: "shadow",
    },
  });

  const link = await callHandler(authHandlers.getTeamSchedulePublicLink, {
    context,
    params: { scheduleId },
  });
  const publicRes = createRes();
  await authHandlers.getPublicTeamSchedule(
    {
      params: {},
      headers: {},
      session: createSession(),
      body: {},
      query: { token: link.payload.publicToken },
    },
    publicRes,
  );
  // Both Jordans must carry a last initial so they can be told apart.
  const jordans = publicRes.payload.members.filter((item) =>
    item.name.startsWith("Jordan"),
  );
  assert.equal(jordans.length, 2);
  jordans.forEach((item) => assert.match(item.name, /^Jordan [A-Z]\.$/));
});

test("intake form stores custom wording and ships it on the public preview", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_custom_copy");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });

  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Fall volunteers",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      teamIds: [worship.teamId],
      active: true,
      welcomeMessage: "Welcome to Worship sign-ups!",
      positionsMessage: "In which positions would you like to serve?",
      availabilityMessage: "Which Sundays can you make it?",
      notesMessage: "Anything we should plan around?",
    },
  });
  assert.equal(form.statusCode, 200);
  assert.equal(
    form.payload.form.welcomeMessage,
    "Welcome to Worship sign-ups!",
  );
  assert.equal(
    form.payload.form.positionsMessage,
    "In which positions would you like to serve?",
  );
  const token = form.payload.publicToken;

  const previewRes = createRes();
  await authHandlers.getTeamIntakePreview(
    { params: {}, headers: {}, session: createSession(), query: { token } },
    previewRes,
  );
  assert.equal(previewRes.statusCode, 200);
  assert.equal(
    previewRes.payload.form.welcomeMessage,
    "Welcome to Worship sign-ups!",
  );
  assert.equal(
    previewRes.payload.form.availabilityMessage,
    "Which Sundays can you make it?",
  );
  assert.equal(
    previewRes.payload.form.notesMessage,
    "Anything we should plan around?",
  );

  // Clearing a message persists as empty so the public form falls back to its
  // default wording; untouched messages are preserved.
  const updated = await callHandler(authHandlers.updateTeamIntakeForm, {
    context,
    params: { formId: form.payload.form.formId },
    body: { positionsMessage: "" },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.payload.form.positionsMessage, "");
  assert.equal(
    updated.payload.form.welcomeMessage,
    "Welcome to Worship sign-ups!",
  );
});

test("intake forms expose and enforce the owner's selected fields", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_selected_fields");

  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Availability only",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      active: true,
      enabledFields: ["availability"],
    },
  });
  assert.equal(form.statusCode, 200);
  assert.deepEqual(form.payload.form.enabledFields, ["availability"]);

  const previewRes = createRes();
  await authHandlers.getTeamIntakePreview(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token: form.payload.publicToken },
    },
    previewRes,
  );
  assert.deepEqual(previewRes.payload.form.enabledFields, ["availability"]);

  const submitRes = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token: form.payload.publicToken },
      body: {
        firstName: "Injected",
        lastName: "Name",
        email: "hidden@example.com",
        notes: "This field was not enabled.",
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);
  assert.deepEqual(Object.keys(submitRes.payload).sort(), [
    "submissionId",
    "success",
  ]);
  await flushAsyncWork();
  const scheduledForm = await getDoc(
    "teamIntakeForms",
    form.payload.form.formId,
  );
  assert.ok(scheduledForm.pendingDigestSince);
  const persistedSubmission = await getDoc(
    "teamIntakeSubmissions",
    submitRes.payload.submissionId,
  );
  assert.equal(
    persistedSubmission.digestBatchId,
    scheduledForm.pendingDigestBatchId,
  );

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const submission = bootstrap.payload.intakeSubmissions.find(
    (item) => item.submissionId === submitRes.payload.submissionId,
  );
  assert.equal(submission.firstName, "");
  assert.equal(submission.lastName, "");
  assert.equal(submission.email, "");
  assert.equal(submission.notes, "");
});

test("a rejected public intake submission does not schedule a digest", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_failed_submit_no_digest");
  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Rejected submission",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      active: true,
    },
  });
  const rejected = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token: "not-a-valid-token" },
      body: { firstName: "Avery" },
    },
    rejected,
  );
  await flushAsyncWork();
  assert.equal(rejected.statusCode, 404);
  const storedForm = await getDoc("teamIntakeForms", form.payload.form.formId);
  assert.equal(storedForm.pendingDigestSince, undefined);
});

test("a failed scheduler leaves a persisted regular submission recoverable", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_schedule_failure");
  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Scheduler failure",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      active: true,
    },
  });
  const sent = [];
  setIntakeNotifyRecipientsForServerTests(["lead@example.test"]);
  setSendEmailForServerTests(async ({ to }) => sent.push(to));
  setIntakeDigestSchedulingFailureForServerTests(true);
  try {
    const response = createRes();
    await authHandlers.submitTeamIntake(
      {
        params: {},
        headers: {},
        session: createSession(),
        query: { token: form.payload.publicToken },
        body: {
          firstName: "Avery",
          lastName: "Stone",
          email: "avery@example.test",
        },
      },
      response,
    );
    await flushAsyncWork();
    assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
    assert.deepEqual(Object.keys(response.payload).sort(), [
      "submissionId",
      "success",
    ]);
    const storedForm = await getDoc(
      "teamIntakeForms",
      form.payload.form.formId,
    );
    const storedSubmission = await getDoc(
      "teamIntakeSubmissions",
      response.payload.submissionId,
    );
    assert.ok(storedForm.pendingDigestSince);
    assert.equal(
      storedSubmission.digestBatchId,
      storedForm.pendingDigestBatchId,
    );

    setIntakeDigestSchedulingFailureForServerTests(false);
    await setDoc(
      "teamIntakeForms",
      form.payload.form.formId,
      {
        pendingDigestSince: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      },
      { merge: true },
    );
    await recoverPendingIntakeSubmissionDigests();
    assert.deepEqual(sent, ["lead@example.test"]);
  } finally {
    setIntakeDigestSchedulingFailureForServerTests(false);
    setIntakeNotifyRecipientsForServerTests(null);
    setSendEmailForServerTests(null);
  }
});

test("intake profile and scheduling fields carry onto a created member", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_profile_fields");
  const enabledFields = [
    "firstName",
    "lastName",
    "email",
    "title",
    "birthDate",
    "schedulingPreferences",
  ];
  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Member details",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      active: true,
      enabledFields,
    },
  });

  const submitRes = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token: form.payload.publicToken },
      body: {
        title: "Dr.",
        firstName: "Avery",
        lastName: "Stone",
        email: "avery@example.com",
        birthDate: { year: 1990, month: 4, day: 12 },
        servingFrequency: "twice_monthly",
        recurringAvailability: {
          weeksOfMonth: [1, 3],
          includeLastWeekOfMonth: true,
        },
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);

  const applyRes = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submitRes.payload.submissionId },
    body: { action: "applied", createMember: true },
  });
  assert.equal(applyRes.statusCode, 200);
  assert.equal(applyRes.payload.member.title, "Dr.");
  assert.equal(applyRes.payload.member.email, "avery@example.com");
  assert.deepEqual(applyRes.payload.member.birthDate, {
    year: 1990,
    month: 4,
    day: 12,
  });
  assert.equal(applyRes.payload.member.servingFrequency, "twice_monthly");
  assert.deepEqual(applyRes.payload.member.recurringAvailability, {
    weeksOfMonth: [1, 3],
    includeLastWeekOfMonth: true,
  });
});

test("intake submission rejects positions outside the form's team scope", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_scope");

  // Two teams in the same church; the form scopes to the first team only.
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });
  const production = await seedTeam(context, {
    teamName: "Production",
    positions: [{ name: "Camera", icon: "Camera" }],
  });
  const inScopePositionId = worship.positionIds.Vocal;
  const outOfScopePositionId = production.positionIds.Camera;

  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Fall volunteers",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      teamIds: [worship.teamId],
      active: true,
    },
  });
  assert.equal(form.statusCode, 200);
  const token = form.payload.publicToken;
  assert.ok(token);

  // A position from the scoped team is accepted.
  const inScopeRes = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token },
      body: {
        firstName: "Pat",
        lastName: "Reed",
        email: "pat.reed@example.com",
        positionIds: [inScopePositionId],
      },
    },
    inScopeRes,
  );
  assert.equal(inScopeRes.statusCode, 200);
  assert.equal(inScopeRes.payload.success, true);

  // A position from another team in the church must be rejected, even though it
  // exists — the public preview never offered it.
  const outOfScopeRes = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token },
      body: {
        firstName: "Lee",
        lastName: "Park",
        positionIds: [outOfScopePositionId],
      },
    },
    outOfScopeRes,
  );
  assert.equal(outOfScopeRes.statusCode, 400);
  assert.equal(outOfScopeRes.payload.success, false);
});

test("creating a member with team positions adds them to those teams' rosters", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_positions_join_team");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });
  const positionId = worship.positionIds.Vocal;

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Sky",
      lastName: "Lane",
      positionIds: [positionId],
    },
  });
  assert.equal(created.statusCode, 200);
  const memberId = created.payload.member.memberId;

  // The rosters this join changed come back on the response so the client can
  // apply them immediately instead of waiting for its next poll.
  assert.deepEqual(
    (created.payload.teams || []).map((item) => item.teamId),
    [worship.teamId],
  );
  assert.ok(created.payload.teams[0].memberIds.includes(memberId));

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const team = bootstrap.payload.teams.find(
    (item) => item.teamId === worship.teamId,
  );
  // Positions are team-scoped, so eligibility implies roster membership.
  assert.ok(team.memberIds.includes(memberId));
});

test("member privacy and serving preferences are validated and birth dates are authoritative", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_preferences");
  const currentYear = new Date().getUTCFullYear();

  const minor = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      title: "Dr.",
      firstName: "Young",
      lastName: "Person",
      birthDate: { year: currentYear - 10, month: 1, day: 1 },
      isMinor: false,
      servingFrequency: "monthly",
      recurringAvailability: {
        weeksOfMonth: [4],
        includeLastWeekOfMonth: false,
      },
      positionIds: [],
    },
  });
  assert.equal(minor.statusCode, 200);
  assert.equal(minor.payload.member.isMinor, true);
  assert.equal(minor.payload.member.title, "Dr.");
  assert.equal(minor.payload.member.servingFrequency, "monthly");
  assert.deepEqual(minor.payload.member.recurringAvailability, {
    weeksOfMonth: [4],
    includeLastWeekOfMonth: false,
  });

  const birthdayOnly = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Birthday",
      lastName: "Only",
      birthDate: { month: 2, day: 29 },
      isMinor: true,
      positionIds: [],
    },
  });
  assert.equal(birthdayOnly.statusCode, 200);
  assert.deepEqual(birthdayOnly.payload.member.birthDate, {
    month: 2,
    day: 29,
  });
  assert.equal(birthdayOnly.payload.member.isMinor, true);

  // A client that predates these optional fields must not clear them while
  // saving another member change.
  const preservedOptionalFields = await callHandler(
    authHandlers.updateTeamRosterMember,
    {
      context,
      params: { memberId: minor.payload.member.memberId },
      body: {
        firstName: "Young",
        lastName: "Person",
        positionIds: [],
      },
    },
  );
  assert.equal(preservedOptionalFields.statusCode, 200);
  assert.equal(preservedOptionalFields.payload.member.title, "Dr.");
  assert.deepEqual(
    preservedOptionalFields.payload.member.recurringAvailability,
    {
      weeksOfMonth: [4],
      includeLastWeekOfMonth: false,
    },
  );

  const adult = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Adult",
      lastName: "Person",
      birthDate: { year: currentYear - 30, month: 1, day: 1 },
      isMinor: true,
      servingFrequency: "weekly",
      positionIds: [],
    },
  });
  assert.equal(adult.statusCode, 200);
  assert.equal(adult.payload.member.isMinor, false);

  const manual = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Manual",
      lastName: "Minor",
      isMinor: true,
      positionIds: [],
    },
  });
  assert.equal(manual.statusCode, 200);
  assert.equal(manual.payload.member.isMinor, true);
  assert.equal(manual.payload.member.servingFrequency, "as_needed");

  const invalidFrequency = await callHandler(
    authHandlers.createTeamRosterMember,
    {
      context,
      body: {
        firstName: "Invalid",
        lastName: "Preference",
        servingFrequency: "occasionally",
        positionIds: [],
      },
    },
  );
  assert.equal(invalidFrequency.statusCode, 400);

  const invalidMinor = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Invalid",
      lastName: "Minor",
      isMinor: "yes",
      positionIds: [],
    },
  });
  assert.equal(invalidMinor.statusCode, 400);

  const invalidRecurringAvailability = await callHandler(
    authHandlers.createTeamRosterMember,
    {
      context,
      body: {
        firstName: "Invalid",
        lastName: "Availability",
        recurringAvailability: {
          weeksOfMonth: [6],
          includeLastWeekOfMonth: false,
        },
        positionIds: [],
      },
    },
  );
  assert.equal(invalidRecurringAvailability.statusCode, 400);
});

test("adding a team position to an existing member joins that team's roster", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_update_positions_join_team");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });
  const positionId = worship.positionIds.Vocal;

  // Member starts with no positions, so there's no roster membership yet.
  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Rae", lastName: "Kim", positionIds: [] },
  });
  assert.equal(created.statusCode, 200);
  const memberId = created.payload.member.memberId;
  // No positions means no roster changed, so the response carries no teams.
  assert.equal(created.payload.teams, undefined);

  const before = await callHandler(authHandlers.getTeamsBootstrap, { context });
  const teamBefore = before.payload.teams.find(
    (item) => item.teamId === worship.teamId,
  );
  assert.ok(!teamBefore.memberIds.includes(memberId));

  const updated = await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId },
    body: { firstName: "Rae", lastName: "Kim", positionIds: [positionId] },
  });
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(
    (updated.payload.teams || []).map((item) => item.teamId),
    [worship.teamId],
  );
  assert.ok(updated.payload.teams[0].memberIds.includes(memberId));

  // Saving again with the same positions is a no-op for the roster, so there is
  // nothing to hand back the second time.
  const resaved = await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId },
    body: { firstName: "Rae", lastName: "Kim", positionIds: [positionId] },
  });
  assert.equal(resaved.statusCode, 200);
  assert.equal(resaved.payload.teams, undefined);

  const after = await callHandler(authHandlers.getTeamsBootstrap, { context });
  const teamAfter = after.payload.teams.find(
    (item) => item.teamId === worship.teamId,
  );
  assert.ok(teamAfter.memberIds.includes(memberId));
});

test("member teamIds put someone on a roster with no position yet", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_team_ids_join");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Nia",
      lastName: "Osei",
      positionIds: [],
      teamIds: [worship.teamId],
    },
  });
  assert.equal(created.statusCode, 200);
  const memberId = created.payload.member.memberId;

  // Roster membership without eligibility is the trainee/shadow case: visible
  // on the team, assignable to nothing until a position is granted.
  assert.deepEqual(
    created.payload.teams.map((item) => item.teamId),
    [worship.teamId],
  );
  assert.deepEqual(created.payload.member.positionIds, []);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const team = bootstrap.payload.teams.find(
    (item) => item.teamId === worship.teamId,
  );
  assert.ok(team.memberIds.includes(memberId));
});

test("member teamIds drop a roster the member no longer belongs to", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_team_ids_leave");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });
  const positionId = worship.positionIds.Vocal;

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Rae",
      lastName: "Kim",
      positionIds: [positionId],
      teamIds: [worship.teamId],
    },
  });
  assert.equal(created.statusCode, 200);
  const memberId = created.payload.member.memberId;

  const left = await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId },
    body: {
      firstName: "Rae",
      lastName: "Kim",
      positionIds: [],
      teamIds: [],
    },
  });
  assert.equal(left.statusCode, 200);
  assert.deepEqual(
    left.payload.teams.map((item) => item.teamId),
    [worship.teamId],
  );
  assert.ok(!left.payload.teams[0].memberIds.includes(memberId));

  const after = await callHandler(authHandlers.getTeamsBootstrap, { context });
  const team = after.payload.teams.find(
    (item) => item.teamId === worship.teamId,
  );
  assert.ok(!team.memberIds.includes(memberId));
});

test("a position keeps its team on the roster even if teamIds leaves it out", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_team_ids_position_wins");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });
  const positionId = worship.positionIds.Vocal;

  // Eligibility for a team's position is gated on belonging to that team, so
  // honouring this removal would leave a member who cannot be assigned to the
  // position they are eligible for.
  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Ola",
      lastName: "Diaz",
      positionIds: [positionId],
      teamIds: [],
    },
  });
  assert.equal(created.statusCode, 200);
  const memberId = created.payload.member.memberId;

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const team = bootstrap.payload.teams.find(
    (item) => item.teamId === worship.teamId,
  );
  assert.ok(team.memberIds.includes(memberId));
});

test("leaving a team drops the role that only applied while on it", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_team_ids_role_cleanup");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });
  const role = await callHandler(authHandlers.createTeamRole, {
    context,
    body: { name: "Team lead", teamId: worship.teamId },
  });
  const roleId = role.payload.role.roleId;

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Sam",
      lastName: "Ito",
      positionIds: [],
      teamIds: [worship.teamId],
      teamMemberships: { [worship.teamId]: { teamId: worship.teamId, roleId } },
    },
  });
  assert.equal(created.statusCode, 200);
  const memberId = created.payload.member.memberId;
  assert.equal(
    created.payload.member.teamMemberships[worship.teamId].roleId,
    roleId,
  );

  const left = await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId },
    body: {
      firstName: "Sam",
      lastName: "Ito",
      positionIds: [],
      teamIds: [],
      teamMemberships: { [worship.teamId]: { teamId: worship.teamId, roleId } },
    },
  });
  assert.equal(left.statusCode, 200);
  // A stale membership entry still reads as belonging to the team for filters
  // and for the permission checks that derive team scope from a member.
  assert.deepEqual(left.payload.member.teamMemberships, {});
});

test("omitting teamIds leaves roster membership alone", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_team_ids_absent");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });
  const positionId = worship.positionIds.Vocal;

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Pat",
      lastName: "Vance",
      positionIds: [positionId],
    },
  });
  const memberId = created.payload.member.memberId;

  // A caller that says nothing about membership must not strip it.
  const updated = await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId },
    body: { firstName: "Pat", lastName: "Vance", positionIds: [] },
  });
  assert.equal(updated.statusCode, 200);

  const after = await callHandler(authHandlers.getTeamsBootstrap, { context });
  const team = after.payload.teams.find(
    (item) => item.teamId === worship.teamId,
  );
  assert.ok(team.memberIds.includes(memberId));
});

test("applying intake as a new member adds them to position teams", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_new_member_team");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });
  const positionId = worship.positionIds.Vocal;

  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Fall volunteers",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      teamIds: [worship.teamId],
      active: true,
    },
  });
  assert.equal(form.statusCode, 200);
  const token = form.payload.publicToken;

  const submitRes = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token },
      body: {
        firstName: "Pat",
        lastName: "Reed",
        email: "pat.reed@example.com",
        positionIds: [positionId],
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);
  await flushAsyncWork();

  const bootstrapBeforeApply = await callHandler(
    authHandlers.getTeamsBootstrap,
    {
      context,
    },
  );
  const submission = bootstrapBeforeApply.payload.intakeSubmissions.find(
    (item) => item.firstName === "Pat",
  );
  assert.ok(submission?.submissionId);
  const intakeForm = bootstrapBeforeApply.payload.intakeForms.find(
    (item) => item.formId === form.payload.form.formId,
  );
  assert.equal(intakeForm?.pendingDigestSince, submission.submittedAt);

  const applyRes = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submission.submissionId },
    body: { action: "applied", createMember: true },
  });
  assert.equal(applyRes.statusCode, 200);
  assert.ok(applyRes.payload.member?.memberId);
  // The submission records that applying created a new member (vs linking).
  assert.equal(applyRes.payload.submission.appliedMemberCreated, true);

  // Intake positions record desire only; applying must NOT grant scheduling
  // eligibility. The new member is assignable to nothing until an admin
  // promotes a desired position into positionIds.
  assert.deepEqual(applyRes.payload.member.positionIds, []);
  assert.deepEqual(applyRes.payload.member.desiredPositionIds, [positionId]);

  const bootstrapAfterApply = await callHandler(
    authHandlers.getTeamsBootstrap,
    {
      context,
    },
  );
  const team = bootstrapAfterApply.payload.teams.find(
    (item) => item.teamId === worship.teamId,
  );
  // Team visibility is still added so the admin can find and promote them.
  assert.ok(team.memberIds.includes(applyRes.payload.member.memberId));
});

test("creating a member with no requested positions still joins the form's teams", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_no_positions_team");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });

  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Fall volunteers",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      teamIds: [worship.teamId],
      active: true,
    },
  });
  assert.equal(form.statusCode, 200);

  // Submit with NO positions selected — just a willing volunteer.
  const submitRes = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token: form.payload.publicToken },
      body: {
        firstName: "Pat",
        lastName: "Reed",
        email: "pat.reed@example.com",
        positionIds: [],
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const submission = bootstrap.payload.intakeSubmissions.find(
    (item) => item.firstName === "Pat",
  );

  const applyRes = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submission.submissionId },
    body: { action: "applied", createMember: true },
  });
  assert.equal(applyRes.statusCode, 200);
  // No positions, but added to the form's team so they appear on its schedule
  // (shadow-eligible only, since positionIds stays empty).
  assert.deepEqual(applyRes.payload.member.positionIds, []);
  const memberId = applyRes.payload.member.memberId;
  const returnedTeam = (applyRes.payload.teams || []).find(
    (item) => item.teamId === worship.teamId,
  );
  assert.ok(returnedTeam, "apply response should include the changed team");
  assert.ok(returnedTeam.memberIds.includes(memberId));
});

test("applying intake to an existing member sets desire without granting eligibility", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_existing_member_desire");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [
      { name: "Vocal", icon: "mic" },
      { name: "Keys", icon: "piano" },
    ],
    members: [{ firstName: "Sam", lastName: "Lee", positions: ["Vocal"] }],
  });
  const vocalId = worship.positionIds.Vocal;
  const keysId = worship.positionIds.Keys;
  const memberId = worship.memberIds.Sam;

  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Fall volunteers",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      teamIds: [worship.teamId],
      active: true,
    },
  });
  assert.equal(form.statusCode, 200);
  const token = form.payload.publicToken;

  const submitRes = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token },
      body: {
        firstName: "Sam",
        lastName: "Lee",
        email: "sam.lee@example.com",
        positionIds: [keysId],
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);

  const bootstrapBeforeApply = await callHandler(
    authHandlers.getTeamsBootstrap,
    {
      context,
    },
  );
  const submission = bootstrapBeforeApply.payload.intakeSubmissions.find(
    (item) => item.firstName === "Sam",
  );
  assert.ok(submission?.submissionId);

  const applyRes = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submission.submissionId },
    body: { action: "applied", memberId },
  });
  assert.equal(applyRes.statusCode, 200);

  // Eligibility (positionIds) is untouched by the apply; desire reflects the
  // latest submission (replace, not union).
  assert.deepEqual(applyRes.payload.member.positionIds, [vocalId]);
  assert.deepEqual(applyRes.payload.member.desiredPositionIds, [keysId]);
  // Linking an existing member is not a create.
  assert.notEqual(applyRes.payload.submission.appliedMemberCreated, true);
});

test("a dismissed intake submission can be restored to the active queue", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_restore_dismissed");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });

  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Fall volunteers",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      teamIds: [worship.teamId],
      active: true,
    },
  });
  assert.equal(form.statusCode, 200);

  const submitRes = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token: form.payload.publicToken },
      body: {
        firstName: "Pat",
        lastName: "Reed",
        email: "pat.reed@example.com",
        positionIds: [worship.positionIds.Vocal],
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const submission = bootstrap.payload.intakeSubmissions.find(
    (item) => item.firstName === "Pat",
  );
  assert.ok(submission?.submissionId);

  const dismissed = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submission.submissionId },
    body: { action: "dismissed" },
  });
  assert.equal(dismissed.statusCode, 200);
  assert.equal(dismissed.payload.submission.status, "dismissed");

  // Restoring sends the submission back to "new" without losing its data, so
  // an accidental dismiss is recoverable.
  const restored = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submission.submissionId },
    body: { action: "new" },
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.payload.submission.status, "new");
  assert.deepEqual(restored.payload.submission.positionIds, [
    worship.positionIds.Vocal,
  ]);
});

test("linking intake replaces blockouts within the form period", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_merge_blockouts");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
    members: [
      {
        firstName: "Sam",
        lastName: "Lee",
        positions: ["Vocal"],
        blockoutDates: [
          { startDate: "2026-08-25", endDate: "2026-09-05", notes: "Vacation" },
          {
            startDate: "2026-09-01",
            endDate: "2026-09-30",
            notes: "Old intake",
          },
          { startDate: "2026-10-04", endDate: "2026-10-08", notes: "Holiday" },
        ],
      },
    ],
  });
  const memberId = worship.memberIds.Sam;

  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Fall volunteers",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      teamIds: [worship.teamId],
      active: true,
    },
  });
  assert.equal(form.statusCode, 200);

  const submitRes = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token: form.payload.publicToken },
      body: {
        firstName: "Sam",
        lastName: "Lee",
        email: "sam.lee@example.com",
        positionIds: [worship.positionIds.Vocal],
        blockoutRanges: [{ startDate: "2026-09-05", endDate: "2026-09-26" }],
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const submission = bootstrap.payload.intakeSubmissions.find(
    (item) => item.firstName === "Sam",
  );

  const applyRes = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submission.submissionId },
    body: { action: "applied", memberId },
  });
  assert.equal(applyRes.statusCode, 200);

  // The response replaces the old September blockout, while dates outside the form
  // period remain intact.
  assert.deepEqual(applyRes.payload.member.blockoutDates, [
    { startDate: "2026-08-25", endDate: "2026-08-31", notes: "Vacation" },
    {
      startDate: "2026-09-05",
      endDate: "2026-09-26",
      notes: "From intake form",
    },
    { startDate: "2026-10-04", endDate: "2026-10-08", notes: "Holiday" },
  ]);

  // Re-applying the same submission must not stack duplicate ranges.
  const reapply = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submission.submissionId },
    body: { action: "applied", memberId },
  });
  assert.equal(reapply.statusCode, 200);
  assert.deepEqual(
    reapply.payload.member.blockoutDates,
    applyRes.payload.member.blockoutDates,
  );
});

test("intake service availability is a soft warning, not a hard block", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_availability_constraint");
  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
    members: [{ firstName: "Sam", lastName: "Lee", positions: ["Vocal"] }],
  });
  const vocalId = positionIds.Vocal;
  const memberId = memberIds.Sam;

  const serviceId = "service-sunday";
  const availableOccurrenceId = "service-sunday@2026-06-07T10:00:00.000Z";
  const unavailableOccurrenceId = "service-sunday@2026-06-14T10:00:00.000Z";

  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "June volunteers",
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      teamIds: [teamId],
      active: true,
      availabilityOccurrences: [
        {
          occurrenceId: availableOccurrenceId,
          serviceId,
          name: "Sunday",
          startsAt: "2026-06-07T10:00:00.000Z",
        },
        {
          occurrenceId: unavailableOccurrenceId,
          serviceId,
          name: "Sunday",
          startsAt: "2026-06-14T10:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(form.statusCode, 200);

  const submitRes = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token: form.payload.publicToken },
      body: {
        firstName: "Sam",
        lastName: "Lee",
        email: "sam.lee@example.com",
        positionIds: [vocalId],
        occurrenceAvailability: {
          [availableOccurrenceId]: "available",
          [unavailableOccurrenceId]: "unavailable",
        },
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const submission = bootstrap.payload.intakeSubmissions.find(
    (item) => item.firstName === "Sam",
  );

  const applyRes = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submission.submissionId },
    body: { action: "applied", memberId },
  });
  assert.equal(applyRes.statusCode, 200);
  assert.equal(
    applyRes.payload.member.serviceAvailability[unavailableOccurrenceId],
    "unavailable",
  );

  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "June",
      teamId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      serviceIds: [serviceId],
      occurrences: [
        {
          occurrenceId: availableOccurrenceId,
          serviceId,
          name: "Sunday",
          startsAt: "2026-06-07T10:00:00.000Z",
        },
        {
          occurrenceId: unavailableOccurrenceId,
          serviceId,
          name: "Sunday",
          startsAt: "2026-06-14T10:00:00.000Z",
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  // The member's availability is recorded for the picker to warn on, but it does
  // NOT block: assigning them to the service they marked unavailable still works.
  assert.equal(
    applyRes.payload.member.serviceAvailability[unavailableOccurrenceId],
    "unavailable",
  );
  const allowedDespiteWarning = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: unavailableOccurrenceId,
        positionSlotKey: `${vocalId}::0`,
        memberId,
        serviceDate: "2026-06-14",
      },
    },
  );
  assert.equal(allowedDespiteWarning.statusCode, 200);

  // A blockout date, by contrast, IS a hard block.
  await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId },
    body: {
      firstName: "Sam",
      lastName: "Lee",
      positionIds: [vocalId],
      blockoutDates: [{ startDate: "2026-06-07", endDate: "2026-06-07" }],
    },
  });
  const blockedByBlockout = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: availableOccurrenceId,
        positionSlotKey: `${vocalId}::0`,
        memberId,
        serviceDate: "2026-06-07",
      },
    },
  );
  assert.equal(blockedByBlockout.statusCode, 400);
  assert.match(
    blockedByBlockout.payload.errorMessage,
    /unavailable for this service/i,
  );
});

// Element titles/notes are the structured rich text doc the ServiceFlow
// normalizer validates (see server/serviceFlowService.js), not a plain string.
const richText = (text) => ({
  blocks: [{ type: "paragraph", spans: [{ text }] }],
});

test("service plan normalization retains IEM-only and mixed equipment slots", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("service_plan_iem_assignees");
  const saved = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey: "service@2026-09-20" },
    body: {
      serviceId: "service",
      date: "2026-09-20",
      name: "Sunday Service",
      sections: [
        {
          id: "section",
          name: "Music",
          elements: [
            {
              id: "song",
              type: "song",
              title: richText("Song"),
              assignees: [
                { id: "iem-slot", iemIds: ["iem-only"] },
                {
                  id: "mixed-slot",
                  name: "Sarah",
                  microphoneIds: ["same-id"],
                  iemIds: ["same-id", "same-id"],
                },
                { id: "duplicate-slot", iemIds: ["same-id"] },
              ],
            },
          ],
        },
      ],
    },
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(
    saved.payload.servicePlan.sections[0].elements[0].assignees,
    [
      { id: "iem-slot", iemIds: ["iem-only"] },
      {
        id: "mixed-slot",
        name: "Sarah",
        microphoneIds: ["same-id"],
        iemIds: ["same-id"],
      },
    ],
  );
});

test("service plan endpoints: create, read, update, delete, permission gating, and SSE", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("service_plan");
  const planKey = "svc1@2026-07-26";

  const missing = await callHandler(authHandlers.getServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(missing.statusCode, 200);
  assert.equal(missing.payload.servicePlan, null);

  const invalid = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: { name: "Sunday Service" },
  });
  assert.equal(invalid.statusCode, 400);

  const sseClient = createSseClient();
  addTeamsSseClient(context.churchId, sseClient);

  // Relative to now: the church "current service" link only resolves to a
  // service happening now or shortly ahead, so a hard-coded past date would
  // make these assertions depend on when the suite runs.
  const upcomingStartsAt = new Date(Date.now() + 60 * 60_000).toISOString();

  const created = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      serviceId: "svc1",
      date: "2026-07-26",
      name: "Sunday Service",
      startsAt: upcomingStartsAt,
      timezone: "America/New_York",
      sections: [
        {
          id: "section-1",
          sourcePlanningManaged: true,
          name: "Worship",
          elements: [
            {
              id: "el-1",
              sourcePlanningManaged: true,
              sourceOccurrenceId: "source-occurrence-1",
              sourceSongReferenceDismissed: true,
              sourceSongReferenceDismissedFingerprint: "v1-fingerprint-a-b",
              sourceSongReferenceDismissedOccurrenceId: "source-occurrence-1",
              type: "song",
              title: richText("Great Are You Lord"),
              sourceElementTypeRaw: "Special Music",
              sourceContentTitleRaw: "Great Are You Lord",
              sourceNoteRaw: "Read from the printed plan",
              servicePlanningImport: {
                observed: {
                  elementType: "Reading the Word",
                  title: "Psalms 97 (NLT) Jasmine Williams",
                  ledBy: "Jeriyah Brown",
                  note: "Read from the printed plan",
                },
                applied: {
                  elementType: "Reading the Word",
                  title: "Psalms 97 (NLT) Jasmine Williams",
                  ledBy: "Jeriyah Brown",
                  note: "Read from the printed plan",
                },
                pendingFields: [],
              },
              importAmbiguity: {
                source: "servicePlanning",
                sourceKey: "Worship:0",
                sourceElementType: "Reading the Word",
                sourceTitle: "Psalms 97 (NLT) Jasmine Williams",
                sourceLedBy: "Jeriyah Brown",
                sourceNote: "Read from the printed plan",
                parts: [
                  {
                    kind: "scripture",
                    value: "Psalms 97 (NLT)",
                    destination: "scripture",
                  },
                  {
                    kind: "person",
                    value: "Jasmine Williams",
                    destination: "assignee",
                    sourceField: "title",
                    managed: {
                      kind: "assignee",
                      id: "title-assignee-1",
                      fingerprint: '{"name":"Jasmine Williams"}',
                    },
                  },
                  { kind: "unknown", value: "unsafe", destination: "content" },
                ],
                reasons: ["Review the remaining title text."],
                status: "deferred",
                sourceFingerprint:
                  '["Reading the Word","Psalms 97 (NLT) Jasmine Williams","Jeriyah Brown","Read from the printed plan"]',
              },
              sourceLedByAssignments: [
                { kind: "person", id: "person-1", name: "Jane Doe" },
                { kind: "teamPosition", id: "position-1", name: "Choir" },
              ],
              durationMinutes: 5,
              notes: richText("Red mic"),
              teamNotes: [
                { id: "media", label: "Media", note: richText("Private cue") },
              ],
            },
          ],
        },
      ],
    },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.payload.servicePlan.revision, 1);
  assert.equal(created.payload.servicePlan.planKey, planKey);
  assert.equal(created.payload.servicePlan.sections.length, 1);
  assert.deepEqual(
    created.payload.servicePlan.sections[0].elements[0].title,
    richText("Great Are You Lord"),
  );
  assert.equal(
    created.payload.servicePlan.sections[0].elements[0].sourceElementTypeRaw,
    "Special Music",
  );
  assert.equal(
    created.payload.servicePlan.sections[0].elements[0].sourceContentTitleRaw,
    "Great Are You Lord",
  );
  assert.equal(
    created.payload.servicePlan.sections[0].elements[0].sourceNoteRaw,
    "Read from the printed plan",
  );
  assert.deepEqual(
    created.payload.servicePlan.sections[0].elements[0].servicePlanningImport,
    {
      observed: {
        elementType: "Reading the Word",
        title: "Psalms 97 (NLT) Jasmine Williams",
        ledBy: "Jeriyah Brown",
        note: "Read from the printed plan",
      },
      applied: {
        elementType: "Reading the Word",
        title: "Psalms 97 (NLT) Jasmine Williams",
        ledBy: "Jeriyah Brown",
        note: "Read from the printed plan",
      },
      pendingFields: [],
    },
  );
  assert.deepEqual(
    created.payload.servicePlan.sections[0].elements[0].importAmbiguity,
    {
      source: "servicePlanning",
      sourceKey: "Worship:0",
      sourceElementType: "Reading the Word",
      sourceTitle: "Psalms 97 (NLT) Jasmine Williams",
      sourceLedBy: "Jeriyah Brown",
      sourceNote: "Read from the printed plan",
      parts: [
        {
          kind: "scripture",
          value: "Psalms 97 (NLT)",
          destination: "scripture",
        },
        {
          kind: "person",
          value: "Jasmine Williams",
          destination: "assignee",
          sourceField: "title",
          managed: {
            kind: "assignee",
            id: "title-assignee-1",
            fingerprint: '{"name":"Jasmine Williams"}',
          },
        },
      ],
      reasons: ["Review the remaining title text."],
      status: "deferred",
      sourceFingerprint:
        '["Reading the Word","Psalms 97 (NLT) Jasmine Williams","Jeriyah Brown","Read from the printed plan"]',
    },
  );
  assert.deepEqual(
    created.payload.servicePlan.sections[0].elements[0].sourceLedByAssignments,
    [
      { kind: "person", id: "person-1", name: "Jane Doe" },
      { kind: "teamPosition", id: "position-1", name: "Choir" },
    ],
  );
  assert.equal(
    created.payload.servicePlan.sections[0].sourcePlanningManaged,
    true,
  );
  assert.equal(
    created.payload.servicePlan.sections[0].elements[0].sourcePlanningManaged,
    true,
  );
  assert.equal(
    created.payload.servicePlan.sections[0].elements[0].sourceOccurrenceId,
    "source-occurrence-1",
  );
  assert.equal(
    created.payload.servicePlan.sections[0].elements[0].sourceSongReferenceDismissedFingerprint,
    "v1-fingerprint-a-b",
  );
  assert.equal(
    created.payload.servicePlan.sections[0].elements[0].sourceSongReferenceDismissedOccurrenceId,
    "source-occurrence-1",
  );

  await flushAsyncWork();
  const createEvent = sseClient
    .events()
    .find((event) => event.type === "service-plan-updated");
  assert.ok(createEvent, "expected a service-plan-updated SSE event");
  assert.equal(createEvent.servicePlan.planKey, planKey);

  const fetched = await callHandler(authHandlers.getServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.payload.servicePlan.name, "Sunday Service");
  assert.equal(
    fetched.payload.servicePlan.sections[0].elements[0].importAmbiguity.status,
    "deferred",
  );
  assert.equal(
    fetched.payload.servicePlan.sections[0].elements[0].importAmbiguity.parts[1]
      .managed.id,
    "title-assignee-1",
  );
  assert.equal(
    fetched.payload.servicePlan.sections[0].elements[0].servicePlanningImport
      .observed.note,
    "Read from the printed plan",
  );

  const updated = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      baseRevision: created.payload.servicePlan.revision,
      saveOperationId: "autosave-operation-0001",
      serviceId: "svc1",
      date: "2026-07-26",
      name: "Sunday Service",
      // Saves replace the whole document, so a client that still wants a start
      // time has to keep sending it (the editor's autosave always does).
      startsAt: upcomingStartsAt,
      timezone: "America/New_York",
      sections: [
        {
          id: "section-1",
          name: "Worship",
          elements: [
            {
              id: "el-1",
              type: "song",
              title: richText("Great Are You Lord"),
              songRefs: [
                {
                  id: "song-ref-1",
                  kind: "pending",
                  title: "Draft song",
                  lyricsText: "lyrics",
                },
              ],
              scriptureRefs: [
                {
                  id: "scripture-ref-1",
                  label: "John 3:16",
                  book: "John",
                  chapter: "3",
                  verseRange: "16",
                  version: "NIV",
                },
              ],
              durationMinutes: 5,
              notes: richText("Red mic"),
              teamNotes: [
                { id: "media", label: "Media", note: richText("Private cue") },
              ],
            },
            {
              id: "el-2",
              type: "announcement",
              title: richText("Welcome"),
              durationMinutes: 1.5,
            },
          ],
        },
      ],
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.payload.servicePlan.revision, 2);
  assert.equal(updated.payload.servicePlan.saveOperationId, undefined);
  const updateEvent = sseClient
    .events()
    .filter((event) => event.type === "service-plan-updated")
    .at(-1);
  assert.equal(updateEvent.saveOperationId, "autosave-operation-0001");
  assert.equal(updateEvent.servicePlan.lastSaveOperationId, undefined);
  const recovered = await callHandler(authHandlers.getServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(
    recovered.payload.servicePlan.lastSaveOperationId,
    "autosave-operation-0001",
  );
  assert.equal(updated.payload.servicePlan.sections[0].elements.length, 2);
  assert.equal(
    updated.payload.servicePlan.sections[0].elements[0].songRefs[0].id,
    "song-ref-1",
  );
  assert.equal(
    updated.payload.servicePlan.sections[0].elements[0].scriptureRefs[0].id,
    "scripture-ref-1",
  );
  assert.equal(
    updated.payload.servicePlan.sections[0].elements[1].durationMinutes,
    1.5,
  );
  assert.equal(
    updated.payload.servicePlan.sections[0].elements[1].durationSeconds,
    90,
  );
  // Upsert-by-key: a second save updates in place, so createdAt must survive.
  assert.equal(
    updated.payload.servicePlan.createdAt,
    created.payload.servicePlan.createdAt,
  );

  const staleSave = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      baseRevision: created.payload.servicePlan.revision,
      serviceId: "svc1",
      date: "2026-07-26",
      name: "Stale change",
      sections: [],
    },
  });
  assert.equal(staleSave.statusCode, 409);
  assert.equal(staleSave.payload.conflict, true);
  assert.equal(staleSave.payload.servicePlan.revision, 2);
  assert.equal(
    staleSave.payload.servicePlan.lastSaveOperationId,
    "autosave-operation-0001",
  );

  const unpublishedViewer = await callHandler(
    authHandlers.getServicePlanViewer,
    {
      context,
      params: { planKey },
    },
  );
  assert.equal(unpublishedViewer.statusCode, 200);
  assert.equal(unpublishedViewer.payload.plan.published, false);
  assert.equal(
    unpublishedViewer.payload.snapshot.service.shareId,
    `current-service-viewer:${planKey}`,
  );
  assert.equal(
    unpublishedViewer.payload.snapshot.service.sections[0].items[0].creditName,
    undefined,
  );
  assert.deepEqual(
    unpublishedViewer.payload.snapshot.service.sections[0].items[0].teamNotes,
    [{ label: "Media", notes: richText("Private cue") }],
  );

  const published = await callHandler(authHandlers.publishServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(published.statusCode, 200);
  assert.match(published.payload.publicUrl, /\/services\//);
  assert.match(published.payload.generalPublicUrl, /\/services\//);
  assert.match(published.payload.currentTeamPublicUrl, /\/services\//);
  assert.match(published.payload.currentGeneralPublicUrl, /\/services\//);
  // Share tokens are capabilities, so they no longer ride along in the plan
  // body — publish hands them back only as explicit share URLs.
  assert.equal(published.payload.servicePlan.publicLinkToken, undefined);
  assert.equal(published.payload.servicePlan.publicTokenHash, undefined);
  const publicToken = published.payload.publicUrl.split("/").at(-1);
  const generalPublicToken = published.payload.generalPublicUrl
    .split("/")
    .at(-1);
  const currentTeamToken = published.payload.currentTeamPublicUrl
    .split("/")
    .at(-1);
  const currentGeneralToken = published.payload.currentGeneralPublicUrl
    .split("/")
    .at(-1);

  const publicSnapshotRes = createRes();
  await authHandlers.getPublicServicePlan(
    { ...createReq(), query: { token: publicToken } },
    publicSnapshotRes,
  );
  assert.equal(publicSnapshotRes.statusCode, 200);
  assert.equal(publicSnapshotRes.payload.service.title, "Sunday Service");
  assert.deepEqual(
    publicSnapshotRes.payload.service.sections[0].items[0].teamNotes,
    [{ label: "Media", notes: richText("Private cue") }],
  );
  assert.equal(
    publicSnapshotRes.payload.service.sections[0].items[0].assignedMemberId,
    undefined,
  );
  assert.equal(
    publicSnapshotRes.payload.service.sections[0].items[1].durationSeconds,
    90,
  );

  const generalPublicSnapshotRes = createRes();
  await authHandlers.getPublicServicePlan(
    { ...createReq(), query: { token: generalPublicToken } },
    generalPublicSnapshotRes,
  );
  assert.equal(generalPublicSnapshotRes.statusCode, 200);
  assert.equal(generalPublicSnapshotRes.payload.service.viewMode, "general");
  assert.deepEqual(
    generalPublicSnapshotRes.payload.service.sections[0].items[0].notes,
    { blocks: [] },
  );
  assert.deepEqual(
    generalPublicSnapshotRes.payload.service.sections[0].items[0].teamNotes,
    [],
  );

  const currentTeamSnapshotRes = createRes();
  await authHandlers.getPublicServicePlan(
    { ...createReq(), query: { token: currentTeamToken } },
    currentTeamSnapshotRes,
  );
  assert.equal(currentTeamSnapshotRes.statusCode, 200);
  assert.equal(currentTeamSnapshotRes.payload.service.title, "Sunday Service");
  assert.equal(currentTeamSnapshotRes.payload.service.viewMode, "team");

  const currentGeneralSnapshotRes = createRes();
  await authHandlers.getPublicServicePlan(
    { ...createReq(), query: { token: currentGeneralToken } },
    currentGeneralSnapshotRes,
  );
  assert.equal(currentGeneralSnapshotRes.statusCode, 200);
  assert.equal(currentGeneralSnapshotRes.payload.service.viewMode, "general");
  assert.deepEqual(
    currentGeneralSnapshotRes.payload.service.sections[0].items[0].notes,
    { blocks: [] },
  );

  const publicSseClient = createSseClient();
  const generalPublicSseClient = createSseClient();
  const currentTeamSseClient = createSseClient();
  addServiceFlowSseClient(publicToken, publicSseClient);
  addServiceFlowSseClient(generalPublicToken, generalPublicSseClient);
  addServiceFlowSseClient(currentTeamToken, currentTeamSseClient);
  const anchoredLive = await callHandler(
    authHandlers.updateServicePlanPublicLive,
    {
      context,
      params: { planKey },
      body: { mode: "anchored", currentElementId: "el-2" },
    },
  );
  assert.equal(anchoredLive.statusCode, 200);
  assert.equal(anchoredLive.payload.servicePlan.publicLive.mode, "anchored");
  assert.equal(
    anchoredLive.payload.servicePlan.publicLive.currentElementId,
    "el-2",
  );
  assert.equal(
    Number.isFinite(
      Date.parse(anchoredLive.payload.servicePlan.publicLive.startedAt),
    ),
    true,
  );
  const anchoredStartedAt =
    anchoredLive.payload.servicePlan.publicLive.startedAt;
  const publicEvents = publicSseClient.events();
  assert.equal(publicEvents.at(-1).type, "service-updated");
  assert.equal("servicePlan" in publicEvents.at(-1), false);
  assert.equal(generalPublicSseClient.events().at(-1).type, "service-updated");
  assert.equal(currentTeamSseClient.events().at(-1).type, "service-updated");
  removeServiceFlowSseClient(publicToken, publicSseClient);
  removeServiceFlowSseClient(generalPublicToken, generalPublicSseClient);
  removeServiceFlowSseClient(currentTeamToken, currentTeamSseClient);

  const anchoredPublicSnapshotRes = createRes();
  await authHandlers.getPublicServicePlan(
    { ...createReq(), query: { token: publicToken } },
    anchoredPublicSnapshotRes,
  );
  assert.deepEqual(anchoredPublicSnapshotRes.payload.service.live, {
    mode: "anchored",
    currentItemId: "el-2",
    startedAt: anchoredStartedAt,
  });

  // Reopening the editor must restore the share links; they used to live only
  // in the publish response, so a reload left no way to reach them.
  const reopened = await callHandler(authHandlers.getServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.payload.publicUrls.team.includes(publicToken), true);
  assert.equal(
    reopened.payload.publicUrls.general.includes(generalPublicToken),
    true,
  );
  assert.equal(
    reopened.payload.publicUrls.currentTeam.includes(currentTeamToken),
    true,
  );
  assert.equal(
    reopened.payload.publicUrls.currentGeneral.includes(currentGeneralToken),
    true,
  );

  // A plain content save must not clobber a live "now" selection made
  // concurrently — publicLive is only rewritten when the selected element is
  // actually gone from the sections being saved.
  const concurrentSave = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      serviceId: "svc1",
      date: "2026-07-26",
      name: "Sunday Service",
      startsAt: upcomingStartsAt,
      sections: [
        {
          id: "section-1",
          name: "Worship",
          elements: [
            { id: "el-1", type: "song", title: richText("Great Are You Lord") },
            { id: "el-2", type: "announcement", title: richText("Welcome") },
          ],
        },
      ],
    },
  });
  assert.equal(concurrentSave.statusCode, 200);
  assert.deepEqual(concurrentSave.payload.servicePlan.publicLive, {
    mode: "anchored",
    currentElementId: "el-2",
    startedAt: anchoredStartedAt,
  });

  // Removing the selected element does still have to reset it, or the public
  // view would point at an item that no longer exists.
  const droppedElementSave = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      serviceId: "svc1",
      date: "2026-07-26",
      name: "Sunday Service",
      startsAt: upcomingStartsAt,
      sections: [
        {
          id: "section-1",
          name: "Worship",
          elements: [
            { id: "el-1", type: "song", title: richText("Great Are You Lord") },
          ],
        },
      ],
    },
  });
  assert.deepEqual(droppedElementSave.payload.servicePlan.publicLive, {
    mode: "schedule",
  });

  const unknownPublicSnapshotRes = createRes();
  await authHandlers.getPublicServicePlan(
    { ...createReq(), query: { token: "not-a-service-token" } },
    unknownPublicSnapshotRes,
  );
  assert.equal(unknownPublicSnapshotRes.statusCode, 404);
  assert.equal(
    unknownPublicSnapshotRes.payload.errorMessage,
    "Service not found.",
  );

  const viewerContext = await createHumanContext("service_plan_viewer", {
    userId: "teams_api_service_plan_viewer",
    email: "teams-api-service-plan-viewer@example.com",
    churchId: context.churchId,
    role: "member",
    appAccess: "view",
    permissions: { teams: "view" },
  });
  const viewerPairing = await callHandler(
    authHandlers.createWorkstationPairing,
    {
      context,
      body: { label: "Plan-only viewer", platformType: "web" },
    },
  );
  assert.equal(viewerPairing.statusCode, 200);
  const workstationSession = createSession();
  const workstationRedeemed = createRes();
  await authHandlers.redeemWorkstationPairing(
    createReq({
      session: workstationSession,
      body: {
        token: viewerPairing.payload.pairing.token,
        platformType: "web",
      },
    }),
    workstationRedeemed,
  );
  assert.equal(workstationRedeemed.statusCode, 200);
  const planOnlyViewerContext = {
    churchId: context.churchId,
    headers: {},
    session: workstationSession,
  };
  const viewerPlanKey = "svc-viewer@2026-07-27";
  const detailedViewerPlan = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey: viewerPlanKey },
    body: {
      serviceId: "svc-viewer",
      date: "2026-07-27",
      name: "Detailed Viewer Service",
      startsAt: upcomingStartsAt,
      timezone: "America/New_York",
      sections: [{
        id: "viewer-section",
        name: "Worship",
        elements: [{
          id: "viewer-item",
          type: "song",
          title: richText("Opening song"),
          notes: richText("Plan note"),
          teamNotes: [
            { id: "team-note", label: "Worship Team", note: richText("Team cue") },
            {
              id: "role-note",
              label: "Worship Team · Lead vocal",
              scope: "role",
              positionId: "viewer-lead",
              teamId: "viewer-worship",
              teamName: "Worship Team",
              note: richText("Lead vocal cue"),
            },
          ],
          assignees: [{
            id: "lead-slot",
            memberId: "viewer-member",
            name: "Avery Stone",
            microphoneIds: ["viewer-mic"],
            iemIds: ["viewer-iem"],
          }],
          resources: [{
            id: "viewer-resource",
            type: "url",
            title: "Service notes",
            url: "https://example.com/service-notes",
          }],
        }],
      }],
    },
  });
  assert.equal(detailedViewerPlan.statusCode, 200);
  const occurrenceId = "viewer-service-occurrence";
  await setDoc(COLLECTIONS.teams, "viewer-worship", {
    teamId: "viewer-worship",
    churchId: context.churchId,
    name: "Worship Team",
    usesMicrophoneAssignments: true,
    usesIemAssignments: true,
  });
  await setDoc(COLLECTIONS.teamPositions, "viewer-lead", {
    positionId: "viewer-lead",
    churchId: context.churchId,
    teamId: "viewer-worship",
    name: "Lead vocal",
  });
  await setDoc(COLLECTIONS.teamRosterMembers, "viewer-member", {
    memberId: "viewer-member",
    churchId: context.churchId,
    firstName: "Avery",
    lastName: "Stone",
    profileImageUrl: "https://example.com/avery.jpg",
    email: "private@example.com",
    phone: "+15555550123",
    privateNotes: "private roster data",
  });
  await setDoc(COLLECTIONS.teamSchedules, "viewer-schedule", {
    scheduleId: "viewer-schedule",
    churchId: context.churchId,
    teamId: "viewer-worship",
    occurrences: [{
      occurrenceId,
      serviceId: "svc-viewer",
      startsAt: upcomingStartsAt,
    }],
    assignments: {
      [occurrenceId]: {
        "viewer-lead::0": { primaryMemberId: "viewer-member" },
      },
    },
    microphoneAssignments: {
      [occurrenceId]: { "viewer-lead::0": ["viewer-mic"] },
    },
    iemAssignments: {
      [occurrenceId]: { "viewer-lead::0": ["viewer-iem"] },
    },
    shareToken: "raw-schedule-token",
  });
  const churchBeforeViewerCatalogs = await getDoc(
    COLLECTIONS.churches,
    context.churchId,
  );
  await setDoc(COLLECTIONS.churches, context.churchId, {
    ...churchBeforeViewerCatalogs,
    servicePlanMicrophones: [{
      id: "viewer-mic",
      name: "Blue",
      type: "Headset",
      color: "#2563eb",
    }],
    serviceEquipment: [{
      id: "viewer-iem",
      name: "Red IEM",
      category: "iem",
      subtype: "wireless-beltpack",
    }],
    logoUrl: "https://example.com/church.png",
    primaryColor: "#123456",
    secondaryColor: "#abcdef",
  });
  const viewerRead = await callHandler(authHandlers.getServicePlan, {
    context: viewerContext,
    params: { planKey },
  });
  assert.equal(viewerRead.statusCode, 200);
  // A viewer can read the plan, but a share URL is a capability that exposes
  // operational team notes — neither the raw tokens nor the links may reach
  // someone who cannot edit.
  assert.equal(viewerRead.payload.servicePlan.publicLinkToken, undefined);
  assert.equal(
    viewerRead.payload.servicePlan.publicGeneralLinkToken,
    undefined,
  );
  assert.equal(viewerRead.payload.servicePlan.publicTokenHash, undefined);
  assert.equal(viewerRead.payload.publicUrls, undefined);

  const viewerPayload = await callHandler(authHandlers.getServicePlanViewer, {
    context: planOnlyViewerContext,
    params: { planKey: viewerPlanKey },
  });
  assert.equal(viewerPayload.statusCode, 200);
  assert.equal(viewerPayload.payload.plan.name, "Detailed Viewer Service");
  assert.equal(
    viewerPayload.payload.plan.sections[0].elements[0].assignees,
    undefined,
  );
  assert.equal(viewerPayload.payload.snapshot.service.title, "Detailed Viewer Service");
  assert.equal(
    viewerPayload.payload.snapshot.service.sections.length > 0,
    true,
  );
  assert.equal(viewerPayload.payload.plan.publicLinkToken, undefined);
  assert.equal(
    viewerPayload.payload.snapshot.service.shareId,
    `current-service-viewer:${viewerPlanKey}`,
  );
  const serializedPlanOnlyViewer = JSON.stringify(viewerPayload.payload.snapshot);
  for (const rosterValue of [
    "Avery Stone",
    "https://example.com/avery.jpg",
    "viewer-member",
    "viewer-mic",
    "Blue",
    "viewer-iem",
    "Red IEM",
  ]) {
    assert.equal(serializedPlanOnlyViewer.includes(rosterValue), false, rosterValue);
  }
  assert.deepEqual(viewerPayload.payload.snapshot.roles ?? [], []);
  assert.deepEqual(viewerPayload.payload.snapshot.servingTeams ?? [], []);
  const viewerItem = viewerPayload.payload.snapshot.service.sections[0].items[0];
  assert.deepEqual(viewerItem.teamNotes, [
    { label: "Worship Team", notes: richText("Team cue") },
    {
      label: "Worship Team · Lead vocal",
      notes: richText("Lead vocal cue"),
      scope: "role",
      positionIds: ["viewer-lead"],
      teamIds: ["viewer-worship"],
      teamNames: ["Worship Team"],
    },
  ], JSON.stringify({
    plan: viewerPayload.payload.plan.sections[0].elements[0],
    item: viewerItem,
  }));
  assert.equal(viewerItem.creditName, undefined);
  assert.deepEqual(viewerItem.microphoneAssignments ?? [], []);
  assert.deepEqual(viewerItem.equipmentAssignments ?? [], []);
  assert.deepEqual(viewerItem.resources, [{
    type: "url",
    title: "Service notes",
    url: "https://example.com/service-notes",
  }]);
  assert.equal(typeof viewerPayload.payload.snapshot.churchName, "string");
  assert.equal(viewerPayload.payload.snapshot.service.live.mode, "schedule");
  const serializedViewer = JSON.stringify(viewerPayload.payload.snapshot);
  for (const privateValue of [
    "private@example.com",
    "+15555550123",
    "private roster data",
    "viewer-member",
    "raw-schedule-token",
    publicToken,
  ]) {
    assert.equal(serializedViewer.includes(privateValue), false);
  }
  const teamsAuthorizedViewerPayload = await callHandler(
    authHandlers.getServicePlanViewer,
    { context: viewerContext, params: { planKey: viewerPlanKey } },
  );
  assert.equal(teamsAuthorizedViewerPayload.statusCode, 200);
  const teamsAuthorizedSnapshot = teamsAuthorizedViewerPayload.payload.snapshot;
  assert.equal(teamsAuthorizedSnapshot.servingTeams[0].members[0].memberName, "Avery Stone");
  assert.equal(teamsAuthorizedSnapshot.servingTeams[0].members[0].profileImageUrl, "https://example.com/avery.jpg");
  const teamsAuthorizedItem = teamsAuthorizedSnapshot.service.sections[0].items[0];
  assert.equal(teamsAuthorizedItem.microphoneAssignments[0].microphone.name, "Blue");
  assert.equal(teamsAuthorizedItem.equipmentAssignments[0].equipment.name, "Red IEM");
  const publishedViewerPlan = await callHandler(authHandlers.publishServicePlan, {
    context,
    params: { planKey: viewerPlanKey },
  });
  assert.equal(publishedViewerPlan.statusCode, 200);
  const viewerPublicToken = publishedViewerPlan.payload.publicUrl
    .split("/")
    .at(-1);
  const viewerPublicSnapshot = createRes();
  await authHandlers.getPublicServicePlan(
    { ...createReq(), query: { token: viewerPublicToken } },
    viewerPublicSnapshot,
  );
  assert.equal(viewerPublicSnapshot.statusCode, 200);
  assert.deepEqual(
    teamsAuthorizedSnapshot.roles,
    viewerPublicSnapshot.payload.roles,
  );
  assert.deepEqual(
    teamsAuthorizedSnapshot.servingTeams,
    viewerPublicSnapshot.payload.servingTeams,
  );
  assert.equal(
    viewerPublicSnapshot.payload.service.shareId,
    viewerPublicToken,
  );

  // An editor still gets the links back so "copy share link" keeps working.
  const editorRead = await callHandler(authHandlers.getServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(editorRead.payload.servicePlan.publicLinkToken, undefined);
  assert.equal(editorRead.payload.publicUrls.team.includes(publicToken), true);

  const viewerWrite = await callHandler(authHandlers.saveServicePlan, {
    context: planOnlyViewerContext,
    params: { planKey: viewerPlanKey },
    body: {
      serviceId: "svc1",
      date: "2026-07-27",
      name: "Blocked",
      sections: [],
    },
  });
  assert.equal(viewerWrite.statusCode, 403);

  const deleteSseClient = createSseClient();
  addServiceFlowSseClient(publicToken, deleteSseClient);
  const deleted = await callHandler(authHandlers.deleteServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(deleted.statusCode, 200);

  await flushAsyncWork();
  // Deleting revokes public access just as unpublishing does, so already-open
  // viewers must be told to re-fetch instead of sitting on a stale snapshot of
  // now-deleted serving notes.
  assert.equal(
    deleteSseClient.events().at(-1)?.type,
    "service-updated",
    "expected public viewers to be notified that a deleted plan changed",
  );
  removeServiceFlowSseClient(publicToken, deleteSseClient);

  await flushAsyncWork();
  const removeEvent = sseClient
    .events()
    .find((event) => event.type === "service-plan-removed");
  assert.ok(removeEvent, "expected a service-plan-removed SSE event");
  assert.equal(removeEvent.planKey, planKey);

  const afterDelete = await callHandler(authHandlers.getServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(afterDelete.payload.servicePlan, null);

  removeTeamsSseClient(context.churchId, sseClient);
});

test("listServicePlans returns a lightweight, church-scoped summary for the Plans list view", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("service_plan_list");
  const otherContext = await createAdminContext(
    "service_plan_list_other_church",
  );

  await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey: "svc1@2026-07-26" },
    body: {
      serviceId: "svc1",
      date: "2026-07-26",
      name: "Sunday Service",
      sections: [
        {
          id: "section-1",
          name: "Worship",
          elements: [
            { id: "el-1", type: "song", title: richText("Great Are You Lord") },
          ],
        },
      ],
    },
  });
  await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey: "svc1@2026-08-02" },
    body: {
      serviceId: "svc1",
      date: "2026-08-02",
      name: "Sunday Service",
      sections: [],
    },
  });
  // A plan in a different church must never leak into this church's list.
  await callHandler(authHandlers.saveServicePlan, {
    context: otherContext,
    params: { planKey: "svc1@2026-07-26" },
    body: {
      serviceId: "svc1",
      date: "2026-07-26",
      name: "Other church",
      sections: [],
    },
  });

  const listed = await callHandler(authHandlers.listServicePlans, { context });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.payload.servicePlans.length, 2);
  assert.deepEqual(
    listed.payload.servicePlans.map((plan) => plan.planKey).sort(),
    ["svc1@2026-07-26", "svc1@2026-08-02"],
  );
  // Full section/element content is not shipped in the list projection.
  assert.equal(listed.payload.servicePlans[0].sections, undefined);
});

test("church current-service link stops resolving once the service is past", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("service_plan_current_window");
  const planKey = "svc1@2026-07-26";

  const soon = new Date(Date.now() + 60 * 60_000).toISOString();
  await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      serviceId: "svc1",
      date: "2026-07-26",
      name: "Upcoming Service",
      startsAt: soon,
      sections: [],
    },
  });
  const published = await callHandler(authHandlers.publishServicePlan, {
    context,
    params: { planKey },
  });
  const currentTeamToken = published.payload.currentTeamPublicUrl
    .split("/")
    .at(-1);

  const upcoming = createRes();
  await authHandlers.getPublicServicePlan(
    { ...createReq(), query: { token: currentTeamToken } },
    upcoming,
  );
  assert.equal(upcoming.statusCode, 200);
  assert.equal(upcoming.payload.service.title, "Upcoming Service");

  // Move the service well into the past. The sticky church link must stop
  // resolving rather than becoming a permanent reader of the last service's
  // team notes — unpublishing one plan never revoked the church token.
  const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const latest = await callHandler(authHandlers.getServicePlan, {
    context,
    params: { planKey },
  });
  await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      baseRevision: latest.payload.servicePlan.revision,
      serviceId: "svc1",
      date: "2026-06-26",
      name: "Upcoming Service",
      startsAt: longAgo,
      sections: [],
    },
  });

  const afterwards = createRes();
  await authHandlers.getPublicServicePlan(
    { ...createReq(), query: { token: currentTeamToken } },
    afterwards,
  );
  assert.equal(afterwards.statusCode, 404);
});

test("saving a service plan clears optional fields that are left out", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("service_plan_clear_optional");
  const planKey = "svc1@2026-07-26";

  const created = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      serviceId: "svc1",
      date: "2026-07-26",
      name: "Sunday Service",
      startsAt: "2026-07-26T14:00:00.000Z",
      timezone: "America/New_York",
      groupId: "group-1",
      sourceImport: {
        source: "servicePlanning",
        sourceUrl: "https://example.test/plan",
        loadedAt: "2026-07-20T00:00:00.000Z",
        planLabel: "Imported",
      },
      sections: [],
    },
  });
  assert.equal(
    created.payload.servicePlan.startsAt,
    "2026-07-26T14:00:00.000Z",
  );
  assert.equal(created.payload.servicePlan.groupId, "group-1");

  // A save is a whole-document replace: omitting these must actually clear
  // them, not silently keep the previous values under `merge: true`.
  const cleared = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      baseRevision: created.payload.servicePlan.revision,
      serviceId: "svc1",
      date: "2026-07-26",
      name: "Sunday Service",
      sections: [],
    },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.payload.servicePlan.startsAt, null);
  assert.equal(cleared.payload.servicePlan.timezone, null);
  assert.equal(cleared.payload.servicePlan.groupId, null);
  assert.equal(cleared.payload.servicePlan.sourceImport, null);

  // Without a start time the plan is no longer publishable.
  const publishAttempt = await callHandler(authHandlers.publishServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(publishAttempt.statusCode, 400);
});

test("service plan elements round-trip scripture refs and raw source strings", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext(
    "service_plan_element_source_fields",
  );
  const planKey = "svc1@2026-08-02";

  const saved = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      serviceId: "svc1",
      date: "2026-08-02",
      name: "Sabbath Service",
      sections: [
        {
          id: "section-1",
          name: "Worship",
          elements: [
            {
              id: "element-1",
              type: "bible",
              title: { type: "doc", content: [] },
              scriptureRef: {
                label: "John 3:16-18 (NIV)",
                book: "John",
                chapter: "3",
                verseRange: "16-18",
                version: "NIV",
              },
              sourceElementTypeRaw: "Scripture Reading",
              sourceLedByRaw: "Dana R.",
            },
            {
              id: "element-2",
              type: "free",
              title: { type: "doc", content: [] },
              // Missing a chapter, so there is nothing to rebuild a reference
              // from — this must be dropped rather than half-stored.
              scriptureRef: { label: "Somewhere", book: "John" },
            },
            {
              id: "element-3",
              type: "song",
              title: { type: "doc", content: [] },
              songRefs: [
                {
                  kind: "library",
                  songId: "song-1",
                  songName: "Great Are You Lord",
                },
                {
                  kind: "library",
                  songId: "song-2",
                  songName: "Build My Life",
                },
              ],
              scriptureRefs: [
                {
                  label: "Psalm 23 (KJV)",
                  book: "Psalm",
                  chapter: "23",
                  verseRange: "",
                  version: "KJV",
                },
              ],
              resources: [
                {
                  id: "resource-youtube",
                  type: "youtube",
                  title: "Rehearsal video",
                  provider: "youtube",
                  mediaId: "dQw4w9WgXcQ",
                  url: "https://youtu.be/dQw4w9WgXcQ",
                },
                {
                  id: "resource-notes",
                  type: "text",
                  title: "Sermon notes",
                  data: { text: "Welcome the guest speaker." },
                },
                {
                  id: "resource-future",
                  type: "future-provider",
                  title: "Future resource",
                  data: { providerSpecificId: "keep-me" },
                },
                {
                  id: "resource-file",
                  type: "document",
                  title: "Church resource",
                  data: { resourceId: "churchResource_123" },
                },
              ],
            },
          ],
        },
      ],
    },
  });

  assert.equal(saved.statusCode, 200);
  const [first, second, third] = saved.payload.servicePlan.sections[0].elements;
  assert.deepEqual(first.scriptureRef, {
    label: "John 3:16-18 (NIV)",
    book: "John",
    chapter: "3",
    verseRange: "16-18",
    version: "NIV",
  });
  // A client that sent only the singular field gets the array back too.
  assert.deepEqual(first.scriptureRefs, [first.scriptureRef]);
  assert.equal(first.sourceElementTypeRaw, "Scripture Reading");
  assert.equal(first.sourceLedByRaw, "Dana R.");
  assert.ok(!second.scriptureRef, "a partial scripture ref is dropped");
  assert.ok(!second.scriptureRefs, "a partial scripture ref is dropped");

  // And the other direction: arrays keep every attachment, and the singular
  // fields stay populated for a tab that has not reloaded onto the new shape —
  // dropping them would look to it like the attachments had vanished on save.
  assert.deepEqual(
    third.songRefs.map((songRef) => songRef.songId),
    ["song-1", "song-2"],
  );
  assert.deepEqual(third.songRef, third.songRefs[0]);
  assert.deepEqual(third.scriptureRef, third.scriptureRefs[0]);
  assert.equal(third.scriptureRef.label, "Psalm 23 (KJV)");
  assert.deepEqual(third.resources, [
    {
      id: "resource-youtube",
      type: "youtube",
      title: "Rehearsal video",
      url: "https://youtu.be/dQw4w9WgXcQ",
      provider: "youtube",
      mediaId: "dQw4w9WgXcQ",
    },
    {
      id: "resource-notes",
      type: "text",
      title: "Sermon notes",
      data: { text: "Welcome the guest speaker." },
    },
    {
      id: "resource-future",
      type: "future-provider",
      title: "Future resource",
      data: { providerSpecificId: "keep-me" },
    },
    {
      id: "resource-file",
      type: "document",
      title: "Church resource",
      data: { resourceId: "churchResource_123" },
    },
  ]);
});

test("service plan templates: create, update in place, list, scope, and delete", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("service_plan_templates");
  const otherContext = await createAdminContext("service_plan_templates_other");

  const sections = [
    {
      id: "section-1",
      name: "Worship",
      elements: [{ id: "el-1", type: "free", title: richText("Welcome") }],
    },
  ];

  const empty = await callHandler(authHandlers.listServicePlanTemplates, {
    context,
  });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.payload.templates, []);

  const created = await callHandler(authHandlers.saveServicePlanTemplate, {
    context,
    body: { name: "Standard Sabbath", serviceId: "svc1", sections },
  });
  assert.equal(created.statusCode, 200);
  const templateId = created.payload.template.templateId;
  assert.ok(templateId);
  assert.equal(created.payload.template.serviceId, "svc1");
  assert.equal(created.payload.template.sections[0].elements.length, 1);

  // A template with no serviceId is offered for every service.
  await callHandler(authHandlers.saveServicePlanTemplate, {
    context,
    body: { name: "Any service", sections: [] },
  });

  // Passing the id updates in place rather than creating a duplicate.
  const updated = await callHandler(authHandlers.saveServicePlanTemplate, {
    context,
    body: {
      templateId,
      name: "Standard Sabbath v2",
      serviceId: "svc1",
      sections,
    },
  });
  assert.equal(updated.payload.template.templateId, templateId);
  assert.equal(updated.payload.template.name, "Standard Sabbath v2");
  assert.equal(
    updated.payload.template.createdAt,
    created.payload.template.createdAt,
  );

  const listed = await callHandler(authHandlers.listServicePlanTemplates, {
    context,
  });
  assert.equal(listed.payload.templates.length, 2);

  // Moving a scoped template back to "any service" must actually clear the
  // scope — a merge write would leave the old serviceId behind.
  const unscoped = await callHandler(authHandlers.saveServicePlanTemplate, {
    context,
    body: { templateId, name: "Standard Sabbath v2", sections },
  });
  assert.equal(unscoped.payload.template.serviceId, undefined);
  assert.equal(
    unscoped.payload.template.createdAt,
    created.payload.template.createdAt,
  );
  const afterUnscope = await callHandler(
    authHandlers.listServicePlanTemplates,
    {
      context,
    },
  );
  assert.equal(
    afterUnscope.payload.templates.find(
      (item) => item.templateId === templateId,
    ).serviceId,
    undefined,
  );

  // …and it can be scoped again afterwards.
  const rescoped = await callHandler(authHandlers.saveServicePlanTemplate, {
    context,
    body: {
      templateId,
      name: "Standard Sabbath v2",
      serviceId: "svc1",
      sections,
    },
  });
  assert.equal(rescoped.payload.template.serviceId, "svc1");

  // Autosave clients send baseRevision. A stale one is a concurrent edit and
  // must be refused with the latest template, never silently overwritten.
  const currentRevision = rescoped.payload.template.revision;
  assert.ok(Number.isSafeInteger(currentRevision) && currentRevision > 0);
  const stale = await callHandler(authHandlers.saveServicePlanTemplate, {
    context,
    body: {
      templateId,
      name: "Overwritten",
      sections,
      baseRevision: currentRevision - 1,
    },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.payload.conflict, true);
  assert.equal(stale.payload.template.name, "Standard Sabbath v2");
  assert.equal(stale.payload.template.revision, currentRevision);

  // The matching revision goes through and moves the revision on.
  const fresh = await callHandler(authHandlers.saveServicePlanTemplate, {
    context,
    body: {
      templateId,
      name: "Standard Sabbath v3",
      sections,
      baseRevision: currentRevision,
    },
  });
  assert.equal(fresh.statusCode, 200);
  assert.equal(fresh.payload.template.name, "Standard Sabbath v3");
  assert.equal(fresh.payload.template.revision, currentRevision + 1);

  // Creating with a baseRevision is fine — there is no document to conflict with.
  const createdWithRevision = await callHandler(
    authHandlers.saveServicePlanTemplate,
    {
      context,
      body: { name: "Autosaved from new", sections, baseRevision: 0 },
    },
  );
  assert.equal(createdWithRevision.statusCode, 200);
  assert.equal(createdWithRevision.payload.template.revision, 1);
  await callHandler(authHandlers.deleteServicePlanTemplate, {
    context,
    params: { templateId: createdWithRevision.payload.template.templateId },
  });

  // A name is required.
  const unnamed = await callHandler(authHandlers.saveServicePlanTemplate, {
    context,
    body: { sections },
  });
  assert.equal(unnamed.statusCode, 400);

  // Another church can neither see nor overwrite this church's templates.
  const otherList = await callHandler(authHandlers.listServicePlanTemplates, {
    context: otherContext,
  });
  assert.deepEqual(otherList.payload.templates, []);
  const hijack = await callHandler(authHandlers.saveServicePlanTemplate, {
    context: otherContext,
    body: { templateId, name: "Hijacked", sections: [] },
  });
  assert.equal(hijack.statusCode, 404);

  const foreignDelete = await callHandler(
    authHandlers.deleteServicePlanTemplate,
    {
      context: otherContext,
      params: { templateId },
    },
  );
  assert.equal(foreignDelete.statusCode, 404);

  const removed = await callHandler(authHandlers.deleteServicePlanTemplate, {
    context,
    params: { templateId },
  });
  assert.equal(removed.statusCode, 200);
  const afterDelete = await callHandler(authHandlers.listServicePlanTemplates, {
    context,
  });
  assert.equal(afterDelete.payload.templates.length, 1);
});

test("bulk template application creates fresh plans, skips existing plans, and preserves scheduled roles", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("service_plan_bulk_apply");
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "bulk-sabbath",
        name: "Sabbath Service",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
      },
    ],
  });
  const templateResponse = await callHandler(
    authHandlers.saveServicePlanTemplate,
    {
      context,
      body: {
        name: "Standard Sabbath",
        sections: [
          {
            id: "template-section",
            name: "Service",
            elements: [
              {
                id: "template-song",
                type: "free",
                title: richText("Opening song"),
                scheduledPositionIds: ["worship-lead"],
              },
            ],
          },
        ],
      },
    },
  );
  const templateId = templateResponse.payload.template.templateId;
  const targets = ["2026-10-03", "2026-10-10"].map((date) => ({
    serviceId: "bulk-sabbath",
    serviceIds: ["bulk-sabbath"],
    occurrenceId: `bulk-sabbath@${date}T10:00:00.000Z`,
    startsAt: `${date}T10:00:00.000Z`,
    date,
  }));
  const applied = await callHandler(authHandlers.applyServicePlanTemplateBulk, {
    context,
    body: { templateId, targets, existingPlanMode: "skip", timeZone: "UTC" },
  });
  assert.equal(applied.statusCode, 200);
  assert.equal(applied.payload.created.length, 2);
  assert.deepEqual(applied.payload.skippedExisting, []);
  const repeated = await callHandler(
    authHandlers.applyServicePlanTemplateBulk,
    {
      context,
      body: { templateId, targets, existingPlanMode: "skip", timeZone: "UTC" },
    },
  );
  assert.deepEqual(repeated.payload.created, []);
  assert.equal(repeated.payload.skippedExisting.length, 2);

  const plans = await callHandler(authHandlers.listServicePlans, { context });
  const planDocs = await Promise.all(
    applied.payload.created.map((key) =>
      getDoc("servicePlans", `${context.churchId}::${key}`),
    ),
  );
  const sections = planDocs.map((plan) => plan.sections[0]);
  const elements = sections.map((section) => section.elements[0]);
  assert.equal(plans.payload.servicePlans.length, 2);
  assert.equal(planDocs[0].name, "Sabbath Service");
  assert.equal(planDocs[0].clonedFromPlanKey, templateId);
  assert.notEqual(sections[0].id, sections[1].id);
  assert.notEqual(elements[0].id, elements[1].id);
  assert.deepEqual(elements[0].scheduledPositionIds, ["worship-lead"]);
  assert.deepEqual(elements[1].scheduledPositionIds, ["worship-lead"]);
});

test("bulk service-default mode skips occurrences without a default template", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("service_plan_bulk_defaults");
  const template = await callHandler(authHandlers.saveServicePlanTemplate, {
    context,
    body: { name: "Default", sections: [] },
  });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "bulk-default",
        name: "With default",
        defaultPlanTemplateId: template.payload.template.templateId,
        reccurence: "weekly",
        dayOfWeek: 0,
        time: "10:00",
      },
      {
        id: "bulk-no-default",
        name: "No default",
        reccurence: "weekly",
        dayOfWeek: 0,
        time: "10:00",
      },
    ],
  });
  const targets = [
    {
      serviceId: "bulk-default",
      serviceIds: ["bulk-default"],
      occurrenceId: "bulk-default@2026-11-01T10:00:00.000Z",
      startsAt: "2026-11-01T10:00:00.000Z",
      date: "2026-11-01",
    },
    {
      serviceId: "bulk-no-default",
      serviceIds: ["bulk-no-default"],
      occurrenceId: "bulk-no-default@2026-11-08T10:00:00.000Z",
      startsAt: "2026-11-08T10:00:00.000Z",
      date: "2026-11-08",
    },
  ];
  const response = await callHandler(
    authHandlers.applyServicePlanTemplateBulk,
    {
      context,
      body: {
        useServiceDefaults: true,
        targets,
        existingPlanMode: "skip",
        timeZone: "UTC",
      },
    },
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.created, ["bulk-default@2026-11-01"]);
  assert.deepEqual(response.payload.skippedNoTemplate, [
    "bulk-no-default@2026-11-08",
  ]);
});

test("bulk template application preserves combined-service plan keys", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("service_plan_bulk_combined");
  const template = await callHandler(authHandlers.saveServicePlanTemplate, {
    context,
    body: { name: "Combined service", sections: [] },
  });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "combined-early",
        name: "Early",
        serviceGroupId: "sabbath",
        reccurence: "weekly",
        dayOfWeek: 0,
        time: "10:00",
      },
      {
        id: "combined-late",
        name: "Late",
        serviceGroupId: "sabbath",
        reccurence: "weekly",
        dayOfWeek: 0,
        time: "11:00",
      },
    ],
  });
  const target = {
    serviceId: "combined-early",
    serviceIds: ["combined-early", "combined-late"],
    groupId: "sabbath",
    occurrenceId: "group:sabbath@2026-11-01",
    startsAt: "2026-11-01T10:00:00.000Z",
    date: "2026-11-01",
  };
  const response = await callHandler(
    authHandlers.applyServicePlanTemplateBulk,
    {
      context,
      body: {
        templateId: template.payload.template.templateId,
        targets: [target],
        existingPlanMode: "skip",
        timeZone: "UTC",
      },
    },
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.created, ["group:sabbath@2026-11-01"]);
  const plan = await getDoc(
    "servicePlans",
    `${context.churchId}::group:sabbath@2026-11-01`,
  );
  assert.deepEqual(plan.serviceIds, ["combined-early", "combined-late"]);
  assert.equal(plan.groupId, "sabbath");
});

test("service plan assignment history: church-scoped, deduped, and merges across saves", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("service_plan_assignment_history");
  const otherContext = await createAdminContext(
    "service_plan_assignment_history_other_church",
  );

  const empty = await callHandler(
    authHandlers.getServicePlanAssignmentHistory,
    {
      context,
    },
  );
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.payload.values, []);

  const saved = await callHandler(
    authHandlers.saveServicePlanAssignmentHistory,
    {
      context,
      body: { values: ["Jane Doe", "John Smith", "Jane Doe", "  ", ""] },
    },
  );
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.payload.values.sort(), ["Jane Doe", "John Smith"]);

  const reloaded = await callHandler(
    authHandlers.getServicePlanAssignmentHistory,
    {
      context,
    },
  );
  assert.deepEqual(reloaded.payload.values.sort(), ["Jane Doe", "John Smith"]);

  // A save from a different church must never leak into or overwrite this one's.
  await callHandler(authHandlers.saveServicePlanAssignmentHistory, {
    context: otherContext,
    body: { values: ["Someone Else"] },
  });
  const stillOwnChurch = await callHandler(
    authHandlers.getServicePlanAssignmentHistory,
    {
      context,
    },
  );
  assert.deepEqual(stillOwnChurch.payload.values.sort(), [
    "Jane Doe",
    "John Smith",
  ]);
});

// --- Schedule payload growth: summaries + on-demand hydration -----------------
// A church accumulates one schedule per team per month, so the bootstrap payload
// grows without bound if every schedule ships its full assignment map. These
// cover the opt-in summary mode and the detail endpoint that rehydrates.

const isoDateMonthsFromNow = (months) => {
  const from = new Date();
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const day = from.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
};

const seedDatedSchedule = async (
  context,
  { name, teamId, positionId, memberId, monthsFromNow },
) => {
  const startDate = isoDateMonthsFromNow(monthsFromNow);
  const occurrenceStart = `${startDate}T10:00:00.000Z`;
  const occurrenceId = `svc@${occurrenceStart}`;
  const created = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name,
      teamId,
      startDate,
      endDate: startDate,
      serviceIds: ["svc"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc",
          name: "Sunday",
          startsAt: occurrenceStart,
        },
      ],
    },
  });
  assert.equal(created.statusCode, 200);
  const { scheduleId } = created.payload.schedule;
  const assigned = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${positionId}::0`,
        memberId,
        serviceDate: startDate,
      },
    },
  );
  assert.equal(assigned.statusCode, 200);
  return { scheduleId, occurrenceId };
};

test("teams bootstrap summarizes schedules outside the hydration window", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("schedule_summary_mode");
  const team = await seedTeam(context, {
    teamName: "Praise",
    positions: [{ name: "Lead" }],
    members: [{ firstName: "Ada", lastName: "Lovelace", positions: ["Lead"] }],
  });
  const memberId = team.memberIds.Ada;
  const positionId = team.positionIds.Lead;

  const current = await seedDatedSchedule(context, {
    name: "This month",
    teamId: team.teamId,
    positionId,
    memberId,
    monthsFromNow: 0,
  });
  const distant = await seedDatedSchedule(context, {
    name: "Next year",
    teamId: team.teamId,
    positionId,
    memberId,
    monthsFromNow: 12,
  });

  // Default (older clients): every schedule still arrives fully hydrated.
  const full = await callHandler(authHandlers.getTeamsBootstrap, { context });
  const fullDistant = full.payload.schedules.find(
    (schedule) => schedule.scheduleId === distant.scheduleId,
  );
  assert.equal(fullDistant.assignmentsOmitted, undefined);
  assert.equal(
    getMemberId(
      fullDistant.assignments?.[distant.occurrenceId]?.[`${positionId}::0`],
    ),
    memberId,
  );

  // Opt-in: in-window schedules keep assignments, out-of-window are summarized.
  const summary = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
    query: { schedules: "summary" },
  });
  const summaryCurrent = summary.payload.schedules.find(
    (schedule) => schedule.scheduleId === current.scheduleId,
  );
  const summaryDistant = summary.payload.schedules.find(
    (schedule) => schedule.scheduleId === distant.scheduleId,
  );

  assert.equal(summaryCurrent.assignmentsOmitted, undefined);
  assert.equal(
    getMemberId(
      summaryCurrent.assignments?.[current.occurrenceId]?.[`${positionId}::0`],
    ),
    memberId,
  );

  assert.equal(summaryDistant.assignmentsOmitted, true);
  assert.equal(summaryDistant.hasScheduleData, true);
  assert.equal(summaryDistant.assignments, undefined);
  assert.equal(summaryDistant.microphoneAssignments, undefined);
  assert.equal(summaryDistant.assignmentCounts.byMemberId[memberId], 1);
  assert.equal(
    summaryDistant.assignmentCounts.lastAssignmentDateByMemberId[memberId],
    isoDateMonthsFromNow(12),
  );
  // The fields the picker and occurrence matching rely on must survive.
  assert.equal(summaryDistant.name, "Next year");
  assert.equal(summaryDistant.teamId, team.teamId);
  assert.equal(summaryDistant.startDate, isoDateMonthsFromNow(12));
  assert.equal(summaryDistant.occurrences.length, 1);
  assert.ok(summary.payload.scheduleHydrationWindow.startDate);
  assert.ok(summary.payload.scheduleHydrationWindow.endDate);
});

test("schedule hydration window clamps month-end dates instead of rolling over", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("schedule_hydration_month_end");
  // Mar 31 − 1 month must stay in February (not roll to Mar 2/3 via setUTCMonth).
  const realDate = globalThis.Date;
  const pinnedMs = Date.parse("2026-03-31T15:00:00.000Z");
  class PinnedDate extends realDate {
    constructor(...args) {
      if (args.length === 0) super(pinnedMs);
      else super(...args);
    }
    static now() {
      return pinnedMs;
    }
  }
  globalThis.Date = PinnedDate;
  try {
    const summary = await callHandler(authHandlers.getTeamsBootstrap, {
      context,
      query: { schedules: "summary" },
    });
    assert.equal(summary.statusCode, 200);
    assert.equal(
      summary.payload.scheduleHydrationWindow.startDate,
      "2026-02-28",
    );
    assert.equal(summary.payload.scheduleHydrationWindow.endDate, "2026-05-31");
  } finally {
    globalThis.Date = realDate;
  }
});

test("schedule detail hydrates one schedule plus overlapping other-team schedules", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("schedule_detail_hydration");
  const praise = await seedTeam(context, {
    teamName: "Praise",
    positions: [{ name: "Lead" }],
    members: [{ firstName: "Ada", lastName: "Lovelace", positions: ["Lead"] }],
  });
  const media = await seedTeam(context, {
    teamName: "Media",
    positions: [{ name: "Camera" }],
    members: [
      { firstName: "Grace", lastName: "Hopper", positions: ["Camera"] },
    ],
  });
  const sharedMemberId = praise.memberIds.Ada;

  // Same distant month for both teams, so they overlap each other but sit well
  // outside the bootstrap hydration window.
  const target = await seedDatedSchedule(context, {
    name: "Praise next year",
    teamId: praise.teamId,
    positionId: praise.positionIds.Lead,
    memberId: sharedMemberId,
    monthsFromNow: 12,
  });
  const overlapping = await seedDatedSchedule(context, {
    name: "Media next year",
    teamId: media.teamId,
    positionId: media.positionIds.Camera,
    memberId: media.memberIds.Grace,
    monthsFromNow: 12,
  });
  const unrelated = await seedDatedSchedule(context, {
    name: "Media much later",
    teamId: media.teamId,
    positionId: media.positionIds.Camera,
    memberId: media.memberIds.Grace,
    monthsFromNow: 18,
  });

  const detail = await callHandler(authHandlers.getTeamScheduleDetail, {
    context,
    params: { scheduleId: target.scheduleId },
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.payload.schedule.scheduleId, target.scheduleId);
  assert.equal(
    getMemberId(
      detail.payload.schedule.assignments?.[target.occurrenceId]?.[
        `${praise.positionIds.Lead}::0`
      ],
    ),
    sharedMemberId,
  );

  const relatedIds = detail.payload.relatedSchedules.map(
    (schedule) => schedule.scheduleId,
  );
  // The overlapping other-team schedule comes back hydrated — the grid needs its
  // assignments to warn "also scheduled on Media".
  assert.ok(relatedIds.includes(overlapping.scheduleId));
  assert.ok(!relatedIds.includes(unrelated.scheduleId));
  assert.ok(!relatedIds.includes(target.scheduleId));
  const relatedOverlapping = detail.payload.relatedSchedules.find(
    (schedule) => schedule.scheduleId === overlapping.scheduleId,
  );
  assert.equal(
    getMemberId(
      relatedOverlapping.assignments?.[overlapping.occurrenceId]?.[
        `${media.positionIds.Camera}::0`
      ],
    ),
    media.memberIds.Grace,
  );
});

test("schedule detail rejects a schedule from another church", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const owner = await createAdminContext("schedule_detail_owner");
  const stranger = await createAdminContext("schedule_detail_stranger");
  const team = await seedTeam(owner, {
    teamName: "Praise",
    positions: [{ name: "Lead" }],
    members: [{ firstName: "Ada", lastName: "Lovelace", positions: ["Lead"] }],
  });
  const { scheduleId } = await seedDatedSchedule(owner, {
    name: "Owner schedule",
    teamId: team.teamId,
    positionId: team.positionIds.Lead,
    memberId: team.memberIds.Ada,
    monthsFromNow: 0,
  });

  const cross = await callHandler(authHandlers.getTeamScheduleDetail, {
    context: stranger,
    params: { scheduleId },
  });
  assert.equal(cross.statusCode, 404);
  assert.equal(cross.payload.success, false);
});

// ---------------------------------------------------------------------------
// Member contact email + account linking (Phase 0)
//
// A member's email is a contact address, never an identity. Linking happens
// only through paths that carry a certain identity (an accepted invite bound to
// a memberId, or a logged-in intake submission) — never by matching addresses,
// because addresses are legitimately shared between people.
// ---------------------------------------------------------------------------

test("a member stores a normalized contact email", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_email_normalize");

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Ada",
      lastName: "Reed",
      email: "  Ada.Reed@Example.COM ",
    },
  });

  assert.equal(created.statusCode, 200);
  // Must match how account emails normalize, or linked/unlinked comparisons
  // would differ by case alone.
  assert.equal(created.payload.member.email, "ada.reed@example.com");
});

test("a member without an email is still valid", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_email_optional");

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "No", lastName: "Address" },
  });

  // Existing rosters have no addresses; requiring one would break them.
  assert.equal(created.statusCode, 200);
  assert.ok(!created.payload.member.email);
});

test("an unparseable member email is rejected", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_email_invalid");

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Bad", lastName: "Address", email: "not-an-email" },
  });

  assert.equal(created.statusCode, 400);
  assert.equal(created.payload.success, false);
});

test("two members may share one contact email", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_email_shared");

  // A parent's address covering two teen volunteers is normal in this domain;
  // a uniqueness constraint would force a fake address on the second child.
  const first = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Kid", lastName: "One", email: "parent@example.com" },
  });
  const second = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Kid", lastName: "Two", email: "parent@example.com" },
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(second.payload.member.email, "parent@example.com");
});

test("updating a member without an email field keeps the existing address", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_email_partial_update");

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Keep", lastName: "Mine", email: "keep@example.com" },
  });
  const memberId = created.payload.member.memberId;

  const updated = await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId },
    body: { firstName: "Keep", lastName: "Mine", notes: "changed" },
  });

  assert.equal(updated.statusCode, 200);
  // A partial save must not silently drop the address.
  assert.equal(updated.payload.member.email, "keep@example.com");
});

test("a member email can be cleared explicitly", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_email_clear");

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Clear", lastName: "Me", email: "clear@example.com" },
  });
  const memberId = created.payload.member.memberId;

  const updated = await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId },
    body: { firstName: "Clear", lastName: "Me", email: "" },
  });

  assert.equal(updated.statusCode, 200);
  assert.ok(!updated.payload.member.email);
});

test("intake requires email when email is selected", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_email_optin");
  const worship = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
  });

  const openForm = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Open form",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      teamIds: [worship.teamId],
      active: true,
    },
  });
  assert.equal(openForm.statusCode, 200);

  // Email is selected on the default form, so a submission without it is rejected.
  // is public and live — defaulting to required would reject real volunteers.
  const withoutEmail = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token: openForm.payload.publicToken },
      body: { firstName: "No", lastName: "Email", positionIds: [] },
    },
    withoutEmail,
  );
  assert.equal(withoutEmail.statusCode, 400);

  // And an address is captured when supplied.
  const withEmail = createRes();
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token: openForm.payload.publicToken },
      body: {
        firstName: "Has",
        lastName: "Email",
        email: "Has.Email@Example.com",
        positionIds: [],
      },
    },
    withEmail,
  );
  assert.equal(withEmail.statusCode, 200);
});

test("unlinking a member clears the account link but keeps the member", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_unlink");

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Linked",
      lastName: "Person",
      email: "linked@example.com",
    },
  });
  const memberId = created.payload.member.memberId;

  // Unlinking an already-unlinked member is a no-op, not an error, so the
  // action is safe to expose without extra state checks in the UI.
  const unlinked = await callHandler(authHandlers.unlinkTeamRosterMember, {
    context,
    params: { memberId },
  });
  assert.equal(unlinked.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const member = (bootstrap.payload.members || []).find(
    (item) => item.memberId === memberId,
  );
  // The person and their contact address survive; only the link is removed.
  assert.ok(member);
  assert.equal(member.email, "linked@example.com");
  assert.ok(!member.userId);
});

test("a member can be claimed by the signed-in account", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_self_link");

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Me", lastName: "Myself", email: "me@example.com" },
  });
  const memberId = created.payload.member.memberId;

  const linked = await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
  });
  assert.equal(linked.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const member = (bootstrap.payload.members || []).find(
    (item) => item.memberId === memberId,
  );
  assert.ok(member.userId);
});

test("claiming the same member twice is a no-op", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_link_idempotent");

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Twice", lastName: "Claimed" },
  });
  const memberId = created.payload.member.memberId;

  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
  });
  const second = await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
  });

  // Safe to expose without the UI tracking link state.
  assert.equal(second.statusCode, 200);
});

test("an account cannot claim a second member in the same church", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_link_one_per_church");

  const first = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "First", lastName: "Record" },
  });
  const second = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Second", lastName: "Record" },
  });

  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId: first.payload.member.memberId },
  });
  const conflict = await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId: second.payload.member.memberId },
  });

  // Two candidate records for one person would make notification routing
  // ambiguous.
  assert.equal(conflict.statusCode, 400);
  assert.equal(conflict.payload.success, false);
});

test("unlinking frees the account to claim a different member", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_link_after_unlink");

  const first = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Wrong", lastName: "Record" },
  });
  const second = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Right", lastName: "Record" },
  });

  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId: first.payload.member.memberId },
  });
  await callHandler(authHandlers.unlinkTeamRosterMember, {
    context,
    params: { memberId: first.payload.member.memberId },
  });
  const relinked = await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId: second.payload.member.memberId },
  });

  // A wrong link must be correctable, or the mistake is permanent.
  assert.equal(relinked.statusCode, 200);
});

test("linking to an account outside the church is refused", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_link_outsider");

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Target", lastName: "Record" },
  });

  const res = await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId: created.payload.member.memberId },
    body: { userId: "uid-from-another-church" },
  });

  // Without this gate a typo'd or guessed uid would hand an outsider a
  // member's schedule and notifications.
  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.success, false);
});

test("an explicit userId matching the caller behaves as a self-claim", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const selfUid = "member_link_explicit_self_uid";
  const context = await createHumanContext("member_link_explicit_self", {
    userId: selfUid,
  });

  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Explicit", lastName: "Self" },
  });
  const memberId = created.payload.member.memberId;

  const res = await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
    body: { userId: selfUid },
  });

  assert.equal(res.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const member = (bootstrap.payload.members || []).find(
    (item) => item.memberId === memberId,
  );
  assert.equal(member.userId, selfUid);
});

test("my assignments returns only the caller's own member and slots", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_assignments_scope");

  const mine = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "My", lastName: "Record" },
  });
  await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Someone", lastName: "Else" },
  });
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId: mine.payload.member.memberId },
  });

  const res = await callHandler(authHandlers.getMyTeamAssignments, { context });

  assert.equal(res.statusCode, 200);
  // Only the caller's own record — never the roster.
  assert.equal(res.payload.member.memberId, mine.payload.member.memberId);
  assert.ok(Array.isArray(res.payload.occurrences));
});

test("my assignments is empty rather than an error when nothing is claimed", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_assignments_unlinked");

  await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Not", lastName: "Mine" },
  });

  const res = await callHandler(authHandlers.getMyTeamAssignments, { context });

  // Normal for staff who are not on a team; erroring would make the client
  // treat an ordinary state as a failure.
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.member, null);
  assert.deepEqual(res.payload.occurrences, []);
});

test("my assignments refuses a church the session does not belong to", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_assignments_cross_church");

  const res = await callHandler(authHandlers.getMyTeamAssignments, {
    context,
    params: { churchId: "some_other_church" },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.success, false);
});

test("my assignments attaches the plan for a combined occurrence", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_assignments_group_plan");
  const media = await seedTeam(context, {
    teamName: "Media",
    positions: [{ name: "Camera", icon: "Camera" }],
  });

  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Group",
      lastName: "Member",
      positionIds: [media.positionIds.Camera],
    },
  });
  const memberId = member.payload.member.memberId;
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
  });

  // A combined occurrence id is `group:<groupId>@<date>` — its suffix is a
  // calendar date, so matching a plan on the id's timestamp never worked.
  const occurrenceId = "group:grp-1@2026-07-05";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Combined schedule",
      teamId: media.teamId,
      serviceIds: ["svc-a", "svc-b"],
      startDate: "2026-07-05",
      endDate: "2026-07-05",
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc-a",
          serviceIds: ["svc-a", "svc-b"],
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(schedule.statusCode, 200);

  const assigned = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: schedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${media.positionIds.Camera}::0`,
        memberId,
      },
    },
  );
  assert.equal(assigned.statusCode, 200);

  const res = await callHandler(authHandlers.getMyTeamAssignments, { context });
  assert.equal(res.statusCode, 200);
  const entry = (res.payload.occurrences || [])[0];
  assert.ok(entry, "the combined occurrence should be returned");
  // Identity comes from the schedule's occurrence record, not the id.
  assert.deepEqual(entry.serviceIds, ["svc-a", "svc-b"]);
  assert.equal(entry.date, "2026-07-05");
  assert.equal(entry.startsAt, "2026-07-05T10:00:00.000Z");
});

test("my assignments includes occurrence name and published plan share urls", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_assignments_plan_share");
  const media = await seedTeam(context, {
    teamName: "Media",
    positions: [{ name: "Camera", icon: "Camera" }],
  });

  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Share",
      lastName: "Viewer",
      positionIds: [media.positionIds.Camera],
    },
  });
  const memberId = member.payload.member.memberId;
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
  });

  const occurrenceId = "svc-morning@2026-08-10";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Morning schedule",
      teamId: media.teamId,
      serviceIds: ["svc-morning"],
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc-morning",
          serviceIds: ["svc-morning"],
          name: "Sunday Morning",
          startsAt: "2026-08-10T14:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(schedule.statusCode, 200);

  const assigned = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId: schedule.payload.schedule.scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${media.positionIds.Camera}::0`,
        memberId,
      },
    },
  );
  assert.equal(assigned.statusCode, 200);

  const planKey = "svc-morning@2026-08-10";
  const saved = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      serviceId: "svc-morning",
      date: "2026-08-10",
      name: "Morning Plan",
      startsAt: "2026-08-10T14:00:00.000Z",
      timezone: "America/New_York",
      sections: [
        {
          id: "section-1",
          name: "Worship",
          elements: [
            {
              id: "el-1",
              type: "song",
              title: richText("Blessed Be Your Name"),
              durationMinutes: 4,
            },
          ],
        },
      ],
    },
  });
  assert.equal(saved.statusCode, 200);

  const beforePublish = await callHandler(authHandlers.getMyTeamAssignments, {
    context,
  });
  assert.equal(beforePublish.statusCode, 200);
  const unpublished = (beforePublish.payload.occurrences || [])[0];
  assert.equal(unpublished.name, "Sunday Morning");
  assert.equal(unpublished.plan?.name, "Morning Plan");
  assert.equal(unpublished.plan?.published, false);
  assert.equal(unpublished.plan?.publicUrls, undefined);

  const published = await callHandler(authHandlers.publishServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(published.statusCode, 200);
  assert.ok(published.payload.teamPublicUrl);

  const afterPublish = await callHandler(authHandlers.getMyTeamAssignments, {
    context,
  });
  assert.equal(afterPublish.statusCode, 200);
  const entry = (afterPublish.payload.occurrences || [])[0];
  assert.equal(entry.plan?.published, true);
  assert.equal(entry.plan?.publicUrls?.team, published.payload.teamPublicUrl);
  assert.equal(
    entry.plan?.publicUrls?.general,
    published.payload.generalPublicUrl,
  );
});

// The self-service blockout write requires an `expectedUpdatedAt` precondition,
// so every save has to start from the record's current write stamp.
const currentMemberStamp = async (context) => {
  const res = await callHandler(authHandlers.getMyTeamAssignments, { context });
  return res.payload.member?.updatedAt || "";
};

test("my blockout dates writes only the caller's own record", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_blockouts_self");
  const media = await seedTeam(context, {
    teamName: "Media",
    positions: [{ name: "Camera", icon: "Camera" }],
  });

  const mine = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Self",
      lastName: "Serve",
      positionIds: [media.positionIds.Camera],
      notes: "Keep me",
    },
  });
  const memberId = mine.payload.member.memberId;
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
  });

  const res = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: [
        { startDate: "2026-09-06", endDate: "2026-09-13", notes: "Away" },
      ],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.member.blockoutDates, [
    { startDate: "2026-09-06", endDate: "2026-09-13", notes: "Away" },
  ]);
  // Only blockoutDates is written — this endpoint must never become a path to
  // self-granting eligibility.
  assert.deepEqual(res.payload.member.positionIds, [media.positionIds.Camera]);
  assert.equal(res.payload.member.notes, "Keep me");
});

test("my blockout dates ignores a memberId supplied by the caller", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_blockouts_other");

  const mine = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Mine", lastName: "Record" },
  });
  const theirs = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Someone", lastName: "Else" },
  });
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId: mine.payload.member.memberId },
  });

  const res = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    params: { memberId: theirs.payload.member.memberId },
    body: {
      memberId: theirs.payload.member.memberId,
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: [{ startDate: "2026-09-06", endDate: "2026-09-06" }],
    },
  });

  assert.equal(res.statusCode, 200);
  // The record is resolved from the session, never from the request.
  assert.equal(res.payload.member.memberId, mine.payload.member.memberId);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const other = (bootstrap.payload.members || []).find(
    (item) => item.memberId === theirs.payload.member.memberId,
  );
  assert.deepEqual(other.blockoutDates, []);
});

test("my blockout dates accepts a date the member is already scheduled for", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_blockouts_conflict");
  const media = await seedTeam(context, {
    teamName: "Media",
    positions: [{ name: "Camera", icon: "Camera" }],
  });

  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Booked",
      lastName: "Away",
      positionIds: [media.positionIds.Camera],
    },
  });
  const memberId = member.payload.member.memberId;
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
  });

  const occurrenceId = "svc-conflict@2026-09-06";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Conflict schedule",
      teamId: media.teamId,
      serviceIds: ["svc-conflict"],
      startDate: "2026-09-06",
      endDate: "2026-09-06",
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc-conflict",
          serviceIds: ["svc-conflict"],
          name: "Sunday Gathering",
          startsAt: "2026-09-06T14:00:00.000Z",
        },
      ],
    },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId: schedule.payload.schedule.scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${media.positionIds.Camera}::0`,
      memberId,
    },
  });

  const res = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: [{ startDate: "2026-09-06", endDate: "2026-09-06" }],
    },
  });

  // Refusing would leave the owner believing the slot is covered. The blockout
  // is stored and the assignment is left in place for them to resolve.
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.member.blockoutDates.length, 1);

  const after = await callHandler(authHandlers.getMyTeamAssignments, {
    context,
  });
  assert.equal(after.payload.occurrences.length, 1);
  assert.equal(after.payload.occurrences[0].occurrenceId, occurrenceId);
});

test("my blockout dates rejects an unlinked account and a foreign church", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_blockouts_guards");

  await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Not", lastName: "Mine" },
  });

  const unlinked = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: { blockoutDates: [] },
  });
  assert.equal(unlinked.statusCode, 404);
  assert.equal(unlinked.payload.success, false);

  const crossChurch = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    params: { churchId: "some_other_church" },
    body: { blockoutDates: [] },
  });
  assert.equal(crossChurch.statusCode, 403);
  assert.equal(crossChurch.payload.success, false);
});

test("my blockout dates bounds upcoming entries without counting expired ones", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_blockouts_cap");

  const mine = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Cap", lastName: "Test" },
  });
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId: mine.payload.member.memberId },
  });

  const offsetDay = (offsetDays) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return date.toISOString().slice(0, 10);
  };
  const entries = (count, startOffset, step = 1) =>
    Array.from({ length: count }, (_, index) => {
      const day = offsetDay(startOffset + index * step);
      return { startDate: day, endDate: day };
    });

  // Recent history is kept and must not consume the allowance a volunteer
  // needs for next summer, or a long-serving member eventually cannot book
  // time off because of trips they already took.
  const withHistory = [...entries(200, -200), ...entries(100, 1)];
  const accepted = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: withHistory,
    },
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.payload.member.blockoutDates.length, 300);

  const tooManyUpcoming = await callHandler(
    authHandlers.updateMyBlockoutDates,
    {
      context,
      body: {
        expectedUpdatedAt: await currentMemberStamp(context),
        blockoutDates: entries(101, 1),
      },
    },
  );
  assert.equal(tooManyUpcoming.statusCode, 400);
  assert.match(
    tooManyUpcoming.payload.errorMessage,
    /over 100 upcoming blockout entries/,
  );

  // The absolute ceiling is about stored document size. Distinct dates cannot
  // reach it inside the retention window, but duplicates can.
  const sameDay = offsetDay(-30);
  const tooLarge = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: Array.from({ length: 401 }, () => ({
        startDate: sameDay,
        endDate: sameDay,
      })),
    },
  });
  assert.equal(tooLarge.statusCode, 400);
  assert.match(tooLarge.payload.errorMessage, /too many blockout entries/);
});

test("my blockout dates rejects a save built on a stale record", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_blockouts_conflict_guard");

  const mine = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Concurrent", lastName: "Editor" },
  });
  const memberId = mine.payload.member.memberId;
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
  });

  const loaded = await callHandler(authHandlers.getMyTeamAssignments, {
    context,
  });
  const staleUpdatedAt = loaded.payload.member.updatedAt;
  assert.ok(staleUpdatedAt, "the member record should carry a write stamp");

  // `updatedAt` is millisecond-granular, so under a loaded full-suite run the
  // admin edit can land in the same millisecond as the read above and produce
  // an identical stamp. Wait past the tick so the test exercises a genuinely
  // moved record rather than passing or failing on scheduling luck.
  await new Promise((resolve) => setTimeout(resolve, 5));

  // Something else edits the record — an admin on the roster screen.
  const adminEdit = await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId },
    body: {
      firstName: "Concurrent",
      lastName: "Editor",
      blockoutDates: [{ startDate: "2099-07-04", endDate: "2099-07-04" }],
    },
  });
  assert.equal(adminEdit.statusCode, 200);
  assert.notEqual(
    adminEdit.payload.member.updatedAt,
    staleUpdatedAt,
    "the admin edit must move the write stamp for this test to mean anything",
  );

  // The member saves a page loaded before that edit. Without the precondition
  // this silently discards the admin's change.
  const stale = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: staleUpdatedAt,
      blockoutDates: [{ startDate: "2099-08-01", endDate: "2099-08-01" }],
    },
  });
  assert.equal(stale.statusCode, 409);
  assert.match(stale.payload.errorMessage, /changed somewhere else/i);

  // The admin's edit is still there.
  const afterConflict = await callHandler(authHandlers.getMyTeamAssignments, {
    context,
  });
  assert.deepEqual(
    afterConflict.payload.member.blockoutDates.map((r) => r.startDate),
    ["2099-07-04"],
  );

  // Reloading and saving again succeeds.
  const retry = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: afterConflict.payload.member.updatedAt,
      blockoutDates: [{ startDate: "2099-08-01", endDate: "2099-08-01" }],
    },
  });
  assert.equal(retry.statusCode, 200);
});

test("my blockout dates refuses a write with no precondition", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_blockouts_no_precondition");

  const mine = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "No", lastName: "Stamp" },
  });
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId: mine.payload.member.memberId },
  });

  const res = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: { blockoutDates: [] },
  });

  // Required, not advisory — an omitted stamp is the same lost-update risk.
  assert.equal(res.statusCode, 409);
});

test("my blockout dates prunes history past the retention window", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("my_blockouts_prune");

  const mine = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { firstName: "Long", lastName: "Serving" },
  });
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId: mine.payload.member.memberId },
  });

  const offsetDay = (offsetDays) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return date.toISOString().slice(0, 10);
  };
  const ancient = offsetDay(-800);
  const recent = offsetDay(-30);
  const upcoming = offsetDay(30);

  const res = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: [
        { startDate: ancient, endDate: ancient, notes: "Two years ago" },
        { startDate: recent, endDate: recent, notes: "Last month" },
        { startDate: upcoming, endDate: upcoming, notes: "Next month" },
      ],
    },
  });

  assert.equal(res.statusCode, 200);
  // A year of history stays — it still explains a recent past service — while
  // anything older is dropped so the array reaches a steady state.
  assert.deepEqual(
    res.payload.member.blockoutDates.map((range) => range.startDate),
    [recent, upcoming],
  );
});

test("schedule-only access cannot retain teams or services permissions", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createHumanContext("member_tier_perms", {
    userId: "member_tier_target",
    role: "member",
    appAccess: "view",
    permissions: { teams: "edit", services: "edit" },
  });

  const bootstrap = await callHandler(authHandlers.getAuthMe, { context });
  assert.equal(bootstrap.statusCode, 200);
  // Sanity: the seeded grants are real before narrowing the tier.
  assert.equal(bootstrap.payload.permissions.teams, "edit");

  const narrowed = await createHumanContext("member_tier_perms_narrow", {
    userId: "member_tier_narrow",
    role: "member",
    appAccess: "member",
    permissions: { teams: "edit", services: "edit" },
  });
  const narrowedBootstrap = await callHandler(authHandlers.getAuthMe, {
    context: narrowed,
  });

  // A schedule-only volunteer cannot reach those surfaces, so a retained grant
  // would read as active in Account while doing nothing — and would come back
  // to life if their tier were widened later. Normalized on read, so already
  // stored contradictions are corrected without a migration.
  assert.equal(narrowedBootstrap.statusCode, 200);
  assert.equal(narrowedBootstrap.payload.permissions.teams, "none");
  assert.equal(narrowedBootstrap.payload.permissions.services, "none");
});

/** YYYY-MM-DD that stays ahead of `fromDate` in blockout conflict recording. */
const calendarDaysFromToday = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const seedAssignedSchedule = async (
  context,
  suffix,
  { link = true, cameraSlots = 1, serviceDate } = {},
) => {
  // Default two weeks out so blockout-conflict tests still see an upcoming
  // service after the fixture calendar day rolls past "today".
  const date = serviceDate || calendarDaysFromToday(14);
  const media = await seedTeam(context, {
    teamName: `Media ${suffix}`,
    positions: [{ name: "Camera", icon: "Camera" }],
  });
  const mine = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Res",
      lastName: "Ponder",
      positionIds: [media.positionIds.Camera],
    },
  });
  const memberId = mine.payload.member.memberId;
  // Linking is what makes the member reachable via the caller's account email,
  // so tests about *unreachable* people have to opt out of it.
  if (link) {
    await callHandler(authHandlers.linkTeamRosterMember, {
      context,
      params: { memberId },
    });
  }
  const occurrenceId = `svc-${suffix}@${date}`;
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Respond schedule",
      teamId: media.teamId,
      serviceIds: [`svc-${suffix}`],
      startDate: date,
      endDate: date,
      occurrences: [
        {
          occurrenceId,
          serviceId: `svc-${suffix}`,
          serviceIds: [`svc-${suffix}`],
          name: "Sunday Gathering",
          startsAt: `${date}T14:00:00.000Z`,
          positionRequirements: [
            { positionId: media.positionIds.Camera, count: cameraSlots },
          ],
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;
  const cellKey = `${media.positionIds.Camera}::0`;
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: { serviceId: occurrenceId, positionSlotKey: cellKey, memberId },
  });
  return {
    memberId,
    scheduleId,
    occurrenceId,
    cellKey,
    media,
    serviceDate: date,
  };
};

test("responding records the answer and leaves the assignment in place", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("respond_ok");
  const { memberId, scheduleId, occurrenceId, cellKey } =
    await seedAssignedSchedule(context, "ok");

  const res = await callHandler(authHandlers.respondToMyAssignment, {
    context,
    body: { scheduleId, occurrenceId, cellKey, response: "declined" },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.response, "declined");

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const saved = (bootstrap.payload.schedules || []).find(
    (row) => row.scheduleId === scheduleId,
  );
  // Declining must never empty the slot: the owner decides who covers it, and
  // a slot silently clearing itself is how a service ends up short.
  const cell = saved.assignments[occurrenceId][cellKey];
  assert.equal(
    typeof cell === "string" ? cell : cell.primaryMemberId,
    memberId,
  );
  assert.equal(saved.responses[occurrenceId][cellKey].response, "declined");
  assert.equal(saved.responses[occurrenceId][cellKey].memberId, memberId);

  const mine = await callHandler(authHandlers.getMyTeamAssignments, {
    context,
  });
  const own = mine.payload.occurrences[0].serving.find((p) => p.isMe);
  assert.equal(own.response, "declined");
});

test("responding refuses a slot the caller does not hold", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("respond_other");
  const { scheduleId, occurrenceId, cellKey, media } =
    await seedAssignedSchedule(context, "other");

  // An owner moves the slot to someone else after the page was loaded.
  const other = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Some",
      lastName: "One",
      positionIds: [media.positionIds.Camera],
    },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: cellKey,
      memberId: other.payload.member.memberId,
    },
  });

  const res = await callHandler(authHandlers.respondToMyAssignment, {
    context,
    body: { scheduleId, occurrenceId, cellKey, response: "accepted" },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.success, false);
});

test("responding rejects a missing answer and a foreign church", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("respond_guards");
  const { scheduleId, occurrenceId, cellKey } = await seedAssignedSchedule(
    context,
    "guards",
  );

  const noAnswer = await callHandler(authHandlers.respondToMyAssignment, {
    context,
    body: { scheduleId, occurrenceId, cellKey, response: "maybe" },
  });
  assert.equal(noAnswer.statusCode, 400);

  const crossChurch = await callHandler(authHandlers.respondToMyAssignment, {
    context,
    params: { churchId: "some_other_church" },
    body: { scheduleId, occurrenceId, cellKey, response: "accepted" },
  });
  assert.equal(crossChurch.statusCode, 403);
});

test("an emailed token answers one assignment without any session", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("respond_token");
  const { memberId, scheduleId, occurrenceId, cellKey } =
    await seedAssignedSchedule(context, "token");

  const url = authHandlers.buildAssignmentResponseUrl({
    churchId: context.churchId,
    scheduleId,
    memberId,
  });
  const token = decodeURIComponent(url.split("/schedule-response/")[1]);

  // No context headers and no session: this is the whole point of the path.
  const res = await callHandler(authHandlers.respondToAssignmentByToken, {
    context: { churchId: context.churchId, headers: {}, session: {} },
    body: { token, response: "accepted" },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.response, "accepted");
  // Comes back with the reader's own slots so the page can show what it just
  // answered — never the roster or anyone else's response.
  assert.equal(res.payload.applied, 1);
  assert.equal(res.payload.assignments[0].serviceName, "Sunday Gathering");
  assert.equal(res.payload.assignments[0].response, "accepted");
  assert.equal(res.payload.serving, undefined);
  assert.equal(res.payload.members, undefined);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const saved = (bootstrap.payload.schedules || []).find(
    (row) => row.scheduleId === scheduleId,
  );
  assert.equal(saved.responses[occurrenceId][cellKey].response, "accepted");
  assert.equal(saved.responses[occurrenceId][cellKey].memberId, memberId);
  const confirmationPreviews = await queryDocs("notificationIntents", [
    { field: "churchId", value: context.churchId },
    { field: "intentType", value: "assignment_confirmation" },
  ]);
  assert.equal(confirmationPreviews.length, 1);
  assert.equal(confirmationPreviews[0].status, "preview");
});

test("a tampered or unsigned token is refused", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("respond_token_bad");
  const { memberId, scheduleId, occurrenceId, cellKey } =
    await seedAssignedSchedule(context, "tokenbad");

  const url = authHandlers.buildAssignmentResponseUrl({
    churchId: context.churchId,
    scheduleId,
    memberId,
  });
  const token = decodeURIComponent(url.split("/schedule-response/")[1]);
  const anonymous = { churchId: context.churchId, headers: {}, session: {} };

  // Repointing the token at another member must not work.
  const parts = token.split(".");
  parts[2] = Buffer.from("someone-else").toString("base64url");
  const tampered = await callHandler(authHandlers.respondToAssignmentByToken, {
    context: anonymous,
    body: { token: parts.join("."), response: "accepted" },
  });
  assert.equal(tampered.statusCode, 404);

  const garbage = await callHandler(authHandlers.respondToAssignmentByToken, {
    context: anonymous,
    body: { token: "nope", response: "accepted" },
  });
  assert.equal(garbage.statusCode, 404);

  const noAnswer = await callHandler(authHandlers.respondToAssignmentByToken, {
    context: anonymous,
    body: { token, response: "" },
  });
  assert.equal(noAnswer.statusCode, 400);

  // Nothing was written by any of the rejected attempts.
  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const saved = (bootstrap.payload.schedules || []).find(
    (row) => row.scheduleId === scheduleId,
  );
  assert.equal(saved.responses?.[occurrenceId]?.[cellKey], undefined);
});

const publicContext = (churchId) => ({ churchId, headers: {}, session: {} });

const tokenForMember = (churchId, scheduleId, memberId) =>
  decodeURIComponent(
    authHandlers
      .buildAssignmentResponseUrl({ churchId, scheduleId, memberId })
      .split("/schedule-response/")[1]
      .split("?")[0],
  );

test("asking for an account invites the roster address, not a supplied one", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("self_invite");
  const media = await seedTeam(context, {
    teamName: "Media invite",
    positions: [{ name: "Camera", icon: "Camera" }],
  });
  const created = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Vol",
      lastName: "Unteer",
      positionIds: [media.positionIds.Camera],
      email: "vol@church.test",
    },
  });
  const memberId = created.payload.member.memberId;
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Invite schedule",
      teamId: media.teamId,
      serviceIds: ["svc-invite"],
      startDate: "2026-09-06",
      endDate: "2026-09-06",
      occurrences: [
        {
          occurrenceId: "svc-invite@2026-09-06",
          serviceId: "svc-invite",
          serviceIds: ["svc-invite"],
          name: "Sunday Gathering",
          startsAt: "2026-09-06T14:00:00.000Z",
          positionRequirements: [
            { positionId: media.positionIds.Camera, count: 1 },
          ],
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  const res = await callHandler(
    authHandlers.requestAccountFromAssignmentToken,
    {
      context: publicContext(context.churchId),
      body: {
        token: tokenForMember(context.churchId, scheduleId, memberId),
        // An unauthenticated caller must not be able to aim the invite. If this
        // were ever honoured, the endpoint would be a way to send
        // WorshipSync-branded mail to anyone.
        email: "attacker@evil.test",
      },
    },
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.email, "vol@church.test");

  const invites = await callHandler(authHandlers.listChurchInvites, {
    context,
    params: { churchId: context.churchId },
  });
  const invite = invites.payload.invites.find(
    (row) => row.memberId === memberId,
  );
  assert.equal(invite.email, "vol@church.test");
  // The narrowest tier there is: accepting produces an account that can see its
  // own schedule and nothing else. Self-service is only defensible with that
  // ceiling.
  assert.equal(invite.appAccess, "member");
  assert.equal(invite.role, "member");
  assert.deepEqual(invite.permissions, {
    teams: "none",
    services: "none",
    teamScopes: {},
  });

  // Shown on the roster so an owner is not surprised by an account appearing.
  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const member = (bootstrap.payload.members || []).find(
    (row) => row.memberId === memberId,
  );
  assert.ok(member.invitedAt);
});

test("asking for an account refuses when there is nowhere to send it", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("self_invite_guards");
  const { memberId, scheduleId } = await seedAssignedSchedule(
    context,
    "inviteguard",
  );

  // seedAssignedSchedule links the member to the caller's account.
  const linked = await callHandler(
    authHandlers.requestAccountFromAssignmentToken,
    {
      context: publicContext(context.churchId),
      body: { token: tokenForMember(context.churchId, scheduleId, memberId) },
    },
  );
  assert.equal(linked.statusCode, 409);

  // Someone the token names who is not on the roster — a schedule guest gets
  // emailed too, and an account for them would show an empty schedule for ever.
  const stranger = await callHandler(
    authHandlers.requestAccountFromAssignmentToken,
    {
      context: publicContext(context.churchId),
      body: {
        token: tokenForMember(context.churchId, scheduleId, "guest-nobody"),
      },
    },
  );
  assert.equal(stranger.statusCode, 404);
});

test("asking for an account refuses a member with no email", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("self_invite_noemail");
  const { memberId, scheduleId } = await seedAssignedSchedule(
    context,
    "invitenoemail",
    { link: false },
  );

  // Scheduling someone with no address stays allowed, so this is a normal
  // state, not a corrupt one — and the reader needs to be told which it is.
  const res = await callHandler(
    authHandlers.requestAccountFromAssignmentToken,
    {
      context: publicContext(context.churchId),
      body: { token: tokenForMember(context.churchId, scheduleId, memberId) },
    },
  );

  assert.equal(res.statusCode, 400);
  const invites = await callHandler(authHandlers.listChurchInvites, {
    context,
    params: { churchId: context.churchId },
  });
  assert.equal(
    invites.payload.invites.some((row) => row.memberId === memberId),
    false,
  );
});

test("a forged token cannot request an invite", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("self_invite_forged");
  const { memberId, scheduleId } = await seedAssignedSchedule(
    context,
    "inviteforged",
    { link: false },
  );
  const token = tokenForMember(context.churchId, scheduleId, memberId);

  const tampered = await callHandler(
    authHandlers.requestAccountFromAssignmentToken,
    {
      context: publicContext(context.churchId),
      body: { token: `${token.slice(0, -3)}xyz` },
    },
  );
  assert.equal(tampered.statusCode, 404);

  const garbage = await callHandler(
    authHandlers.requestAccountFromAssignmentToken,
    {
      context: publicContext(context.churchId),
      body: { token: "not-a-token" },
    },
  );
  assert.equal(garbage.statusCode, 404);
});

test("an emailed token stops working once the slot moves on", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("respond_token_moved");
  const { memberId, scheduleId, occurrenceId, cellKey, media } =
    await seedAssignedSchedule(context, "tokenmoved");

  const url = authHandlers.buildAssignmentResponseUrl({
    churchId: context.churchId,
    scheduleId,
    memberId,
  });
  const token = decodeURIComponent(url.split("/schedule-response/")[1]);

  const other = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Re",
      lastName: "Assigned",
      positionIds: [media.positionIds.Camera],
    },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: cellKey,
      memberId: other.payload.member.memberId,
    },
  });

  const res = await callHandler(authHandlers.respondToAssignmentByToken, {
    context: { churchId: context.churchId, headers: {}, session: {} },
    body: { token, response: "declined" },
  });

  // An old link must not write an answer about a slot someone else now holds.
  assert.equal(res.statusCode, 409);
});

test("declining an assignment records a vacancy without messaging the volunteer who declined", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("decline_vacancy_no_invite");
  const { memberId, scheduleId } = await seedAssignedSchedule(
    context,
    "declinevacancy",
  );
  const url = authHandlers.buildAssignmentResponseUrl({
    churchId: context.churchId,
    scheduleId,
    memberId,
  });
  const token = decodeURIComponent(url.split("/schedule-response/")[1]);

  const response = await callHandler(authHandlers.respondToAssignmentByToken, {
    context: { churchId: context.churchId, headers: {}, session: {} },
    body: { token, response: "declined" },
  });
  assert.equal(response.statusCode, 200);
  const intents = await queryDocs("notificationIntents", [
    { field: "churchId", value: context.churchId },
    { field: "sourceId", value: scheduleId },
  ]);
  assert.equal(
    intents.filter((intent) => intent.intentType === "replacement_request")
      .length,
    0,
  );
  assert.equal(
    intents.length,
    0,
    "recording a decline does not create an SMS draft",
  );
});

test("sending a schedule notifies once and is idempotent", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("send_sched");
  const { memberId, scheduleId, occurrenceId } = await seedAssignedSchedule(
    context,
    "send",
  );
  // Reachable via the roster address; no linked account needed.
  await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId },
    body: { firstName: "Res", lastName: "Ponder", email: "vol@church.test" },
  });

  const first = await callHandler(authHandlers.sendTeamSchedule, {
    context,
    params: { scheduleId },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.notified, 1);
  assert.ok(first.payload.sentAt, "sending records when it happened");
  assert.deepEqual(first.payload.unreachableMemberIds, []);
  const assignmentMessagePreviews = await queryDocs("notificationIntents", [
    { field: "churchId", value: context.churchId },
    { field: "intentType", value: "assignment_notification" },
  ]);
  assert.equal(assignmentMessagePreviews.length, 1);
  assert.equal(assignmentMessagePreviews[0].status, "preview");

  // Pressing send again must not re-mail anyone.
  const second = await callHandler(authHandlers.sendTeamSchedule, {
    context,
    params: { scheduleId },
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.payload.notified, 0);
  assert.equal(second.payload.alreadyNotified, 1);
  const previewsAfterRepeat = await queryDocs("notificationIntents", [
    { field: "churchId", value: context.churchId },
    { field: "intentType", value: "assignment_notification" },
  ]);
  assert.equal(previewsAfterRepeat.length, 1);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const saved = (bootstrap.payload.schedules || []).find(
    (row) => row.scheduleId === scheduleId,
  );
  assert.ok(saved.sentAt);
  assert.ok(occurrenceId);
});

test("sending reports who could not be reached instead of skipping quietly", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("send_unreachable");
  // No email and no linked account — the common shape for a volunteer added
  // straight to the roster.
  const { memberId: strandedId, scheduleId } = await seedAssignedSchedule(
    context,
    "unreach",
    { link: false },
  );

  const res = await callHandler(authHandlers.sendTeamSchedule, {
    context,
    params: { scheduleId },
  });

  assert.equal(res.statusCode, 200);
  // The dangerous failure is an owner assuming everyone was told, so the
  // people who could not be reached come back by id rather than being skipped.
  assert.deepEqual(res.payload.unreachableMemberIds, [strandedId]);
});

test("sending skips someone who muted schedule assignments", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("send_muted");
  const { memberId, scheduleId } = await seedAssignedSchedule(context, "muted");
  // Link the roster member to the calling account, then mute the category.
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
  });
  const muted = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: [],
    },
  });
  assert.equal(muted.statusCode, 200);

  const res = await callHandler(authHandlers.sendTeamSchedule, {
    context,
    params: { scheduleId },
  });

  // The account has an address, so this is a preference decision, not a
  // reachability one — it must not show up as "could not reach".
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.unreachableMemberIds, []);
});

test("one emailed link shows every service and can answer them all", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("respond_all");
  const { memberId, scheduleId, occurrenceId, cellKey, media } =
    await seedAssignedSchedule(context, "all");

  // A second service on the same schedule, same person.
  const secondOccurrence = "svc-all-2@2026-09-13";
  await callHandler(authHandlers.updateTeamSchedule, {
    context,
    params: { scheduleId },
    body: {
      name: "Respond schedule",
      teamId: media.teamId,
      serviceIds: ["svc-all", "svc-all-2"],
      startDate: "2026-09-06",
      endDate: "2026-09-13",
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc-all",
          serviceIds: ["svc-all"],
          name: "Sunday Gathering",
          startsAt: "2026-09-06T14:00:00.000Z",
        },
        {
          occurrenceId: secondOccurrence,
          serviceId: "svc-all-2",
          serviceIds: ["svc-all-2"],
          name: "Evening Service",
          startsAt: "2026-09-13T14:00:00.000Z",
        },
      ],
    },
  });
  // Editing the schedule's occurrences clears assignments, so both slots are
  // (re)assigned after the reshape.
  for (const serviceId of [occurrenceId, secondOccurrence]) {
    await callHandler(authHandlers.updateTeamScheduleAssignment, {
      context,
      params: { scheduleId },
      body: { serviceId, positionSlotKey: cellKey, memberId },
    });
  }

  const url = authHandlers.buildAssignmentResponseUrl({
    churchId: context.churchId,
    scheduleId,
    memberId,
  });
  const token = decodeURIComponent(url.split("/schedule-response/")[1]);
  const anonymous = { churchId: context.churchId, headers: {}, session: {} };

  // The page can name what it is asking about — the first version could not.
  const context_ = await callHandler(
    authHandlers.getAssignmentResponseContext,
    { context: anonymous, query: { token } },
  );
  assert.equal(context_.statusCode, 200);
  assert.deepEqual(
    context_.payload.assignments.map((slot) => slot.serviceName),
    ["Sunday Gathering", "Evening Service"],
  );
  assert.equal(context_.payload.assignments[0].response, "pending");

  // Omitting the slot answers every one of them at once.
  const all = await callHandler(authHandlers.respondToAssignmentByToken, {
    context: anonymous,
    body: { token, response: "accepted" },
  });
  assert.equal(all.statusCode, 200);
  assert.equal(all.payload.applied, 2);
  assert.deepEqual(
    all.payload.assignments.map((slot) => slot.response),
    ["accepted", "accepted"],
  );

  // And a single slot can still be answered on its own.
  const one = await callHandler(authHandlers.respondToAssignmentByToken, {
    context: anonymous,
    body: {
      token,
      response: "declined",
      occurrenceId: secondOccurrence,
      cellKey,
    },
  });
  assert.equal(one.payload.applied, 1);
  assert.deepEqual(
    one.payload.assignments.map((slot) => slot.response),
    ["accepted", "declined"],
  );
});

test("clearing a slot drops the answer that was about it", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("prune_stale");
  const { memberId, scheduleId, occurrenceId, cellKey } =
    await seedAssignedSchedule(context, "prune");

  await callHandler(authHandlers.respondToMyAssignment, {
    context,
    body: { scheduleId, occurrenceId, cellKey, response: "declined" },
  });

  // Owner clears the slot, then puts the same person back on it.
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: { serviceId: occurrenceId, positionSlotKey: cellKey, memberId: null },
  });
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: { serviceId: occurrenceId, positionSlotKey: cellKey, memberId },
  });

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const saved = (bootstrap.payload.schedules || []).find(
    (row) => row.scheduleId === scheduleId,
  );
  // Without pruning the old "declined" comes back as though they answered
  // again — the owner sees a no nobody gave, and the slot reads uncovered.
  assert.equal(saved.responses?.[occurrenceId]?.[cellKey], undefined);

  const mine = await callHandler(authHandlers.getMyTeamAssignments, {
    context,
  });
  const own = mine.payload.occurrences[0].serving.find((p) => p.isMe);
  assert.equal(own.response, "pending");
});

test("sending notifies a schedule guest and counts one with no email", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("send_guests");
  const { scheduleId, occurrenceId, media } = await seedAssignedSchedule(
    context,
    "guests",
    { link: false, cameraSlots: 2 },
  );

  // Guests are schedule-only people, not roster members.
  const reachable = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${media.positionIds.Camera}::1`,
        guest: { name: "Gail Guest", email: "gail@church.test" },
      },
    },
  );
  assert.equal(reachable.statusCode, 200);

  const res = await callHandler(authHandlers.sendTeamSchedule, {
    context,
    params: { scheduleId },
  });

  assert.equal(res.statusCode, 200);
  // The guest is mailed like anyone else rather than being skipped in silence.
  assert.equal(res.payload.notified, 1);
  // And the roster member with no address is still reported, so the toast
  // cannot claim everyone was told.
  assert.equal(res.payload.unreachableMemberIds.length, 1);
});

test("answers open one coalescing digest window per schedule", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("response_digest");
  const { memberId, scheduleId, occurrenceId, cellKey, media } =
    await seedAssignedSchedule(context, "digest", { cameraSlots: 2 });

  const second = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Second",
      lastName: "Person",
      positionIds: [media.positionIds.Camera],
      email: "second@church.test",
    },
  });
  const secondCell = `${media.positionIds.Camera}::1`;
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: secondCell,
      memberId: second.payload.member.memberId,
    },
  });

  const readMarker = async () => {
    const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
      context,
    });
    return (bootstrap.payload.schedules || []).find(
      (row) => row.scheduleId === scheduleId,
    )?.pendingResponseDigestSince;
  };

  assert.equal(await readMarker(), undefined);

  await callHandler(authHandlers.respondToMyAssignment, {
    context,
    body: { scheduleId, occurrenceId, cellKey, response: "declined" },
  });
  const opened = await readMarker();
  assert.ok(opened, "the first answer opens a window");

  // A second answer inside the window must ride the same digest rather than
  // restarting the clock — otherwise a steady trickle never sends at all.
  const url = authHandlers.buildAssignmentResponseUrl({
    churchId: context.churchId,
    scheduleId,
    memberId: second.payload.member.memberId,
  });
  const token = decodeURIComponent(
    url.split("/schedule-response/")[1].split("?")[0],
  );
  await callHandler(authHandlers.respondToAssignmentByToken, {
    context: { churchId: context.churchId, headers: {}, session: {} },
    body: { token, response: "accepted" },
  });

  assert.equal(
    await readMarker(),
    opened,
    "the window start does not move, so the digest still fires on time",
  );
  assert.ok(memberId);
});

const readScheduleRow = async (context, scheduleId) => {
  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  return (bootstrap.payload.schedules || []).find(
    (row) => row.scheduleId === scheduleId,
  );
};

test("blocking out a date you are scheduled for tells the owner", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("blockout_conflict");
  const { memberId, scheduleId, occurrenceId, cellKey, serviceDate } =
    await seedAssignedSchedule(context, "blockconflict");

  const res = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: [{ startDate: serviceDate, endDate: serviceDate }],
    },
  });
  assert.equal(res.statusCode, 200);

  const saved = await readScheduleRow(context, scheduleId);
  assert.deepEqual(Object.values(saved.pendingBlockoutConflicts || {}), [
    {
      memberId,
      occurrenceId,
      cellKey,
      blockedAt: Object.values(saved.pendingBlockoutConflicts)[0].blockedAt,
    },
  ]);
  // It rides the existing response window rather than opening a second one.
  assert.ok(saved.pendingResponseDigestSince);

  // The slot itself is untouched: the owner decides who covers it. A volunteer
  // marking time off must not empty a service.
  const cell = saved.assignments[occurrenceId][cellKey];
  assert.equal(
    typeof cell === "string" ? cell : cell.primaryMemberId,
    memberId,
  );
});

test("blocking out a date you do not serve notifies nobody", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("blockout_clear");
  const { scheduleId, serviceDate } = await seedAssignedSchedule(
    context,
    "blockclear",
  );
  // A week after the only service on this schedule.
  const otherDate = calendarDaysFromToday(21);
  assert.notEqual(otherDate, serviceDate);

  await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: [{ startDate: otherDate, endDate: otherDate }],
    },
  });

  const saved = await readScheduleRow(context, scheduleId);
  assert.deepEqual(saved.pendingBlockoutConflicts, undefined);
  assert.equal(saved.pendingResponseDigestSince, undefined);
});

test("re-saving the same blockout does not re-notify", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("blockout_resave");
  const { scheduleId, serviceDate } = await seedAssignedSchedule(
    context,
    "blockresave",
  );
  const away = [{ startDate: serviceDate, endDate: serviceDate }];

  await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: away,
    },
  });
  const first = await readScheduleRow(context, scheduleId);
  const firstBlockedAt = Object.values(first.pendingBlockoutConflicts)[0]
    .blockedAt;

  // Editing the note keeps the same range, so nothing was newly blocked. The
  // recorded moment must stay put, or a trickle of unrelated saves would keep
  // pushing the same conflict forward and it would read as new each time.
  await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: [{ ...away[0], notes: "Wedding" }],
    },
  });

  const second = await readScheduleRow(context, scheduleId);
  assert.equal(Object.keys(second.pendingBlockoutConflicts).length, 1);
  assert.equal(
    Object.values(second.pendingBlockoutConflicts)[0].blockedAt,
    firstBlockedAt,
  );
});

test("a second blockout adds to the pending map instead of replacing it", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("blockout_accumulate");
  const media = await seedTeam(context, {
    teamName: "Media accumulate",
    positions: [{ name: "Camera", icon: "Camera" }],
  });
  const mine = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Multi",
      lastName: "Date",
      positionIds: [media.positionIds.Camera],
    },
  });
  const memberId = mine.payload.member.memberId;
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
  });
  const firstDate = calendarDaysFromToday(14);
  const secondDate = calendarDaysFromToday(21);
  const occurrences = [firstDate, secondDate].map((date) => ({
    occurrenceId: `svc-acc@${date}`,
    serviceId: "svc-acc",
    serviceIds: ["svc-acc"],
    name: "Sunday Gathering",
    startsAt: `${date}T14:00:00.000Z`,
    positionRequirements: [{ positionId: media.positionIds.Camera, count: 1 }],
  }));
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Accumulate schedule",
      teamId: media.teamId,
      serviceIds: ["svc-acc"],
      startDate: firstDate,
      endDate: secondDate,
      occurrences,
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;
  for (const occurrence of occurrences) {
    await callHandler(authHandlers.updateTeamScheduleAssignment, {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrence.occurrenceId,
        positionSlotKey: `${media.positionIds.Camera}::0`,
        memberId,
      },
    });
  }

  const away = [{ startDate: firstDate, endDate: firstDate }];
  await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: away,
    },
  });
  await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: [...away, { startDate: secondDate, endDate: secondDate }],
    },
  });

  // The second save writes only its own key. Writing the merged map back would
  // re-assert the first — and would erase anything a digest deleted in between.
  const saved = await readScheduleRow(context, scheduleId);
  assert.deepEqual(
    Object.values(saved.pendingBlockoutConflicts)
      .map((entry) => entry.occurrenceId)
      .sort(),
    [`svc-acc@${firstDate}`, `svc-acc@${secondDate}`].sort(),
  );
});

test("a past service is not reported as a new blockout conflict", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("blockout_past");
  const media = await seedTeam(context, {
    teamName: "Media past",
    positions: [{ name: "Camera", icon: "Camera" }],
  });
  const mine = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Late",
      lastName: "Logger",
      positionIds: [media.positionIds.Camera],
    },
  });
  const memberId = mine.payload.member.memberId;
  await callHandler(authHandlers.linkTeamRosterMember, {
    context,
    params: { memberId },
  });
  const occurrenceId = "svc-past@2020-01-05";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Old schedule",
      teamId: media.teamId,
      serviceIds: ["svc-past"],
      startDate: "2020-01-05",
      endDate: "2020-01-05",
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc-past",
          serviceIds: ["svc-past"],
          name: "Old Gathering",
          startsAt: "2020-01-05T14:00:00.000Z",
          positionRequirements: [
            { positionId: media.positionIds.Camera, count: 1 },
          ],
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${media.positionIds.Camera}::0`,
      memberId,
    },
  });

  // Volunteers routinely log time off after the fact; an owner cannot refill a
  // service that already happened.
  await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: [{ startDate: "2020-01-05", endDate: "2020-01-05" }],
    },
  });

  const saved = await readScheduleRow(context, scheduleId);
  assert.deepEqual(saved.pendingBlockoutConflicts, undefined);
});

test("reshaping a schedule's occurrences does not leave answers behind", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("prune_bulk");
  const { memberId, scheduleId, occurrenceId, cellKey, media } =
    await seedAssignedSchedule(context, "prunebulk");

  await callHandler(authHandlers.respondToMyAssignment, {
    context,
    body: { scheduleId, occurrenceId, cellKey, response: "declined" },
  });

  // Editing occurrences rewrites assignments wholesale — the bulk save path,
  // not the per-cell one.
  await callHandler(authHandlers.updateTeamSchedule, {
    context,
    params: { scheduleId },
    body: {
      name: "Respond schedule",
      teamId: media.teamId,
      serviceIds: ["svc-prunebulk"],
      startDate: "2026-09-06",
      endDate: "2026-09-06",
      occurrences: [
        {
          occurrenceId,
          serviceId: "svc-prunebulk",
          serviceIds: ["svc-prunebulk"],
          name: "Sunday Gathering",
          startsAt: "2026-09-06T14:00:00.000Z",
        },
      ],
    },
  });

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const saved = (bootstrap.payload.schedules || []).find(
    (row) => row.scheduleId === scheduleId,
  );
  // The slot is empty now, so the answer about it must be gone too — otherwise
  // re-adding the same person resurrects their decline.
  assert.equal(saved.responses?.[occurrenceId]?.[cellKey], undefined);
  assert.ok(memberId);
});

test("roster phone numbers normalize, validate, and allow shared numbers", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("phone_numbers");
  const body = {
    firstName: "Phone",
    lastName: "One",
    positionIds: [],
    blockoutDates: [],
    phoneNumber: "(954) 555-1234",
  };
  const first = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.member.phoneNumber, "+19545551234");

  const omitted = await callHandler(authHandlers.updateTeamRosterMember, {
    context,
    params: { memberId: first.payload.member.memberId },
    body: {
      firstName: "Phone",
      lastName: "One",
      positionIds: [],
      blockoutDates: [],
    },
  });
  assert.equal(omitted.statusCode, 200);
  assert.equal(omitted.payload.member.phoneNumber, "+19545551234");

  const duplicate = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { ...body, firstName: "Phone", lastName: "Two" },
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.payload.member.phoneNumber, "+19545551234");

  const invalid = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: { ...body, phoneNumber: "(123) 555-1234" },
  });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.payload.errorMessage, /valid U\.S\. mobile number/i);
});

test("individual intake recipients personalize and automatically apply one auditable response", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("individual_intake");
  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Vocal", icon: "mic" }],
    members: [
      { firstName: "Kevin", lastName: "Cheddar", positions: ["Vocal"] },
    ],
  });
  const memberId = memberIds.Kevin;
  const occurrenceId = "svc@2026-10-04T10:00:00.000Z";
  const otherOccurrenceId = "other@2026-10-11T10:00:00.000Z";
  await setDoc(
    "teamRosterMembers",
    memberId,
    { serviceAvailability: { [otherOccurrenceId]: "unavailable" } },
    { merge: true },
  );
  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "October availability",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      teamIds: [teamId],
      active: true,
      availabilityOccurrences: [
        {
          occurrenceId,
          serviceId: "svc",
          name: "Saturday",
          startsAt: "2026-10-04T10:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(form.statusCode, 200);
  const formId = form.payload.form.formId;

  const firstCreate = await callHandler(
    authHandlers.createTeamIntakeRecipients,
    {
      context,
      params: { formId },
      body: { memberIds: [memberId] },
    },
  );
  assert.equal(firstCreate.statusCode, 200);
  const recipient = firstCreate.payload.recipients[0];
  assert.ok(recipient.recipientId);

  const secondCreate = await callHandler(
    authHandlers.createTeamIntakeRecipients,
    {
      context,
      params: { formId },
      body: { memberIds: [memberId] },
    },
  );
  assert.equal(secondCreate.statusCode, 200);
  assert.equal(
    secondCreate.payload.recipients[0].recipientId,
    recipient.recipientId,
  );

  const link = await callHandler(authHandlers.getTeamIntakeRecipientLink, {
    context,
    params: { recipientId: recipient.recipientId },
    body: { markCopied: true },
  });
  assert.equal(link.statusCode, 200);
  assert.match(link.payload.publicUrl, /\/a\//);
  assert.ok(!link.payload.publicUrl.includes("Kevin"));
  assert.ok(!link.payload.publicUrl.includes(recipient.recipientId));
  const token = link.payload.publicUrl.split("/a/")[1];
  assert.equal(isPublicSharePathname(`/a/${token}`), true);
  assert.match(token, /^r_[A-Za-z0-9_-]{24}$/);
  assert.equal(token.length, 26);
  const storedRecipient = await getDoc(
    "teamIntakeRecipients",
    recipient.recipientId,
  );
  assert.equal(storedRecipient.recipientToken, undefined);
  assert.equal(storedRecipient.recipientTokenNonce, undefined);
  assert.ok(storedRecipient.recipientTokenCiphertext);
  assert.ok(!JSON.stringify(storedRecipient).includes(token));
  assert.match(storedRecipient.recipientTokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(storedRecipient.recipientTokenHash, token);
  const repeatedLink = await callHandler(
    authHandlers.getTeamIntakeRecipientLink,
    {
      context,
      params: { recipientId: recipient.recipientId },
    },
  );
  assert.equal(repeatedLink.payload.publicUrl, link.payload.publicUrl);

  const anonymousPath = createRes();
  await authHandlers.getTeamIntakePreview(
    { params: {}, headers: {}, session: createSession(), query: { token } },
    anonymousPath,
  );
  assert.equal(anonymousPath.statusCode, 404);

  const preview = createRes();
  await authHandlers.getTeamIntakePreview(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token, recipientOnly: "true" },
    },
    preview,
  );
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.payload.recipient.firstName, "Kevin");
  assert.ok(!JSON.stringify(preview.payload).includes("Cheddar"));
  assert.ok(!JSON.stringify(preview.payload).includes("recipientTokenNonce"));

  const beforeSubmit = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  assert.ok(
    !beforeSubmit.payload.intakeRecipients.find(
      (item) => item.recipientId === recipient.recipientId,
    ).respondedAt,
  );

  const submit = async (availability) => {
    const response = createRes();
    await authHandlers.submitTeamIntake(
      {
        params: {},
        headers: {},
        session: createSession(),
        query: { token, recipientOnly: "true" },
        body: {
          firstName: "",
          lastName: "",
          email: "",
          positionIds: [positionIds.Vocal],
          occurrenceAvailability:
            availability === undefined ? {} : { [occurrenceId]: availability },
          blockoutRanges: [],
          notes: "",
        },
      },
      response,
    );
    return response;
  };

  const firstSubmit = await submit("unavailable");
  assert.equal(
    firstSubmit.statusCode,
    200,
    JSON.stringify(firstSubmit.payload),
  );
  await flushAsyncWork();
  assert.ok(
    (await getDoc("teamIntakeForms", formId)).pendingDigestSince,
    "individualized submissions schedule the same digest",
  );
  const firstSubmissionId = firstSubmit.payload.submissionId;
  const afterFirst = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const firstSubmission = afterFirst.payload.intakeSubmissions.find(
    (item) => item.submissionId === firstSubmissionId,
  );
  const firstRecipient = afterFirst.payload.intakeRecipients.find(
    (item) => item.recipientId === recipient.recipientId,
  );
  const firstMember = afterFirst.payload.members.find(
    (item) => item.memberId === memberId,
  );
  assert.equal(firstSubmission.status, "applied");
  assert.equal(firstSubmission.appliedMemberId, memberId);
  assert.equal(firstMember.serviceAvailability[occurrenceId], "unavailable");
  assert.equal(firstRecipient.submissionId, firstSubmissionId);
  assert.ok(firstRecipient.respondedAt);

  const concurrentRepeats = await Promise.all([
    submit("available"),
    submit("available"),
  ]);
  assert.equal(concurrentRepeats[0].statusCode, 200);
  assert.equal(concurrentRepeats[1].statusCode, 200);
  assert.equal(concurrentRepeats[0].payload.submissionId, firstSubmissionId);
  assert.equal(concurrentRepeats[1].payload.submissionId, firstSubmissionId);
  const afterRepeat = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  assert.equal(
    afterRepeat.payload.intakeSubmissions.filter(
      (item) => item.formId === formId,
    ).length,
    1,
  );
  assert.equal(
    afterRepeat.payload.members.find((item) => item.memberId === memberId)
      .serviceAvailability[occurrenceId],
    "available",
  );

  const cleared = await submit();
  assert.equal(cleared.statusCode, 200);
  const afterCleared = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const clearedMember = afterCleared.payload.members.find(
    (item) => item.memberId === memberId,
  );
  assert.equal(clearedMember.serviceAvailability[occurrenceId], undefined);
  assert.equal(
    clearedMember.serviceAvailability[otherOccurrenceId],
    "unavailable",
  );

  const revoked = await callHandler(authHandlers.revokeTeamIntakeRecipient, {
    context,
    params: { recipientId: recipient.recipientId },
  });
  assert.equal(revoked.statusCode, 200);
  const revokedPreview = createRes();
  await authHandlers.getTeamIntakePreview(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token, recipientOnly: "true" },
    },
    revokedPreview,
  );
  assert.equal(revokedPreview.statusCode, 404);

  const reactivated = await callHandler(
    authHandlers.createTeamIntakeRecipients,
    {
      context,
      params: { formId },
      body: { memberIds: [memberId] },
    },
  );
  assert.equal(reactivated.statusCode, 200);
  assert.equal(
    reactivated.payload.recipients[0].recipientId,
    recipient.recipientId,
  );
  const reactivatedLink = await callHandler(
    authHandlers.getTeamIntakeRecipientLink,
    {
      context,
      params: { recipientId: recipient.recipientId },
    },
  );
  const reactivatedToken = reactivatedLink.payload.publicUrl.split("/a/")[1];
  assert.notEqual(reactivatedToken, token);
  const reactivatedPreview = createRes();
  await authHandlers.getTeamIntakePreview(
    {
      params: {},
      headers: {},
      session: createSession(),
      query: { token: reactivatedToken, recipientOnly: "true" },
    },
    reactivatedPreview,
  );
  assert.equal(reactivatedPreview.statusCode, 200);
});

test("notification requests accept personalized forms with blockout and notes fields", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("intake_form_response_request");
  const { teamId, memberIds } = await seedTeam(context, {
    teamName: "Worship",
    members: [{ firstName: "Kevin", lastName: "Cheddar" }],
  });
  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "September Schedule",
      startDate: calendarDaysFromToday(0),
      endDate: calendarDaysFromToday(30),
      responseDeadline: calendarDaysFromToday(30),
      teamIds: [teamId],
      enabledFields: [
        "firstName",
        "lastName",
        "email",
        "blockoutDates",
        "notes",
        "birthDate",
      ],
      active: true,
    },
  });
  assert.equal(form.statusCode, 200);
  const prepared = await authHandlers.prepareAvailabilityNotificationRecipients(
    {
      churchId: context.churchId,
      formId: form.payload.form.formId,
      memberIds: [memberIds.Kevin],
      purpose: "availability_request",
      actorUid: "admin",
    },
  );
  assert.equal(prepared.results.length, 1);
  assert.ok(prepared.results[0].recipient.recipientId);
  assert.match(prepared.results[0].publicUrl, /\/a\//);
  assert.equal(prepared.results[0].eligible, false);
  assert.equal(prepared.results[0].exclusionReason, "No valid mobile number.");
});

test("individual intake recipient creation requires Teams edit permission", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const admin = await createAdminContext("individual_intake_permission");
  const { teamId, memberIds } = await seedTeam(admin, {
    teamName: "Worship",
    members: [{ firstName: "Rae", lastName: "Kim" }],
  });
  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context: admin,
    body: {
      name: "October",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      teamIds: [teamId],
      active: true,
    },
  });
  const viewer = await createHumanContext("individual_intake_viewer", {
    churchId: admin.churchId,
    userId: "individual_intake_viewer",
    email: "individual-intake-viewer@example.com",
    role: "member",
    appAccess: "view",
    permissions: { teams: "view" },
  });
  const blocked = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: viewer,
    params: { formId: form.payload.form.formId },
    body: { memberIds: [memberIds.Rae] },
  });
  assert.equal(blocked.statusCode, 403);
});

test("individual intake recipient creation validates the full set before writing", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("individual_intake_atomic_create");
  const scoped = await seedTeam(context, {
    teamName: "Saturday Team",
    members: [{ firstName: "In", lastName: "Scope" }],
  });
  const outside = await seedTeam(context, {
    teamName: "Weeknight Team",
    members: [{ firstName: "Out", lastName: "Scope" }],
  });
  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Scoped availability",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      teamIds: [scoped.teamId],
      active: true,
    },
  });
  const formId = form.payload.form.formId;

  const failed = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context,
    params: { formId },
    body: {
      memberIds: [scoped.memberIds.In, outside.memberIds.Out],
    },
  });
  assert.equal(failed.statusCode, 400);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  assert.equal(
    bootstrap.payload.intakeRecipients.filter((item) => item.formId === formId)
      .length,
    0,
  );
});

test("individual intake SMS records one shared notification attempt and blocks duplicate accepted sends", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("individual_intake_sms");
  const { teamId, memberIds } = await seedTeam(context, {
    teamName: "Worship",
    members: [{ firstName: "Sms", lastName: "Recipient" }],
  });
  const memberId = memberIds.Sms;
  const phoneNumber = "+19545551234";
  await setDoc("teamRosterMembers", memberId, { phoneNumber }, { merge: true });
  await seedSmsConsentForServerTests({
    churchId: context.churchId,
    phoneNumber,
    status: "opted_in",
  });
  await setDoc(
    "churchMessagingConfigs",
    context.churchId,
    {
      churchId: context.churchId,
      provider: "twilio",
      providerAccountId: "AC_test",
      messagingServiceId: "MG_test",
      registrationStatus: "approved",
      enabled: true,
    },
    { merge: false },
  );
  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "October availability",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      teamIds: [teamId],
      active: true,
    },
  });
  const formId = form.payload.form.formId;
  const created = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context,
    params: { formId },
    body: { memberIds: [memberId] },
  });
  const recipientId = created.payload.recipients[0].recipientId;
  const previewSms = () =>
    callHandler(authHandlers.prepareTeamIntakeRecipientSms, {
      context,
      params: { formId, recipientId },
    });
  const fake = createFakeSmsProvider({
    response: { providerMessageId: "SM_first", status: "queued" },
  });
  setSmsProviderForServerTests(fake);
  try {
    const unconfirmed = await callHandler(
      authHandlers.sendTeamIntakeRecipientSms,
      {
        context,
        params: { recipientId },
        body: {},
      },
    );
    assert.equal(unconfirmed.statusCode, 400);
    assert.equal(
      fake.calls.length,
      0,
      "an individual send requires explicit operator confirmation",
    );
    const preview = await previewSms();
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.payload.preview.eligible, true);
    const first = await callHandler(authHandlers.sendTeamIntakeRecipientSms, {
      context,
      params: { formId, recipientId },
      body: {
        confirmed: true,
        approvalVersion: preview.payload.preview.approvalVersion,
      },
    });
    assert.equal(first.statusCode, 200, JSON.stringify(first.payload));
    assert.equal(first.payload.attempt.status, "accepted");
    assert.match(fake.calls[0].body, /\/a\/r_/);
    assert.doesNotMatch(fake.calls[0].body, new RegExp(memberId));
    assert.doesNotMatch(fake.calls[0].body, /19545551234/);
    const firstAttempt = await getDoc(
      "smsDeliveryAttempts",
      first.payload.attempt.attemptId,
    );
    assert.equal(firstAttempt.phoneNumberSnapshot, phoneNumber);
    assert.equal(firstAttempt.providerMessageId, "SM_first");

    fake.sendMessage = async (input) => {
      fake.calls.push(input);
      return { providerMessageId: "SM_second", status: "sent" };
    };
    const second = await callHandler(authHandlers.sendTeamIntakeRecipientSms, {
      context,
      params: { formId, recipientId },
      body: {
        confirmed: true,
        approvalVersion: preview.payload.preview.approvalVersion,
      },
    });
    assert.equal(second.statusCode, 409);
    const attempts = await queryDocs("smsDeliveryAttempts", [
      { field: "recipientId", value: recipientId },
    ]);
    assert.equal(attempts.length, 1);
    assert.equal(fake.calls.length, 1);

    const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, {
      context,
    });
    assert.equal(
      bootstrap.payload.smsEligibilityByMemberId[memberId].status,
      "enabled",
    );
    assert.equal(bootstrap.payload.smsDeliveryAttempts, undefined);
    const history = await callHandler(authHandlers.getTeamIntakeSmsAttempts, {
      context,
      params: { formId },
    });
    assert.equal(history.statusCode, 200);
    assert.equal(history.payload.attempts.length, 1);
  } finally {
    setSmsProviderForServerTests(null);
  }
});

test("admin-recorded SMS consent preserves the church-scoped consent contract and refreshes eligibility", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("admin_sms_consent");
  const { memberIds } = await seedTeam(context, {
    teamName: "Worship",
    members: [
      { firstName: "Verbal", lastName: "Consent" },
      { firstName: "Signed", lastName: "Consent" },
      { firstName: "Missing", lastName: "Phone" },
      { firstName: "Invalid", lastName: "Phone" },
      { firstName: "Web", lastName: "Consent" },
      { firstName: "Opted", lastName: "Out" },
      { firstName: "Archived", lastName: "Member" },
    ],
  });
  const members = [memberIds.Verbal, memberIds.Signed, memberIds.Missing, memberIds.Invalid, memberIds.Web, memberIds.Opted, memberIds.Archived];
  const phones = [
    "+19545551240", "+19545551241", "", "555", "+19545551244", "+19545551245", "+19545551246",
  ];
  await Promise.all(members.map((memberId, index) =>
    setDoc("teamRosterMembers", memberId, { phoneNumber: phones[index] }, { merge: true }),
  ));
  const requestConsent = (memberId, source = "admin_verbal", consentedAt = "2026-10-01", using = context, confirmed = true, phoneNumberSnapshot = phones[members.indexOf(memberId)]) =>
    callHandler(authHandlers.recordMemberSmsConsent, {
      context: using,
      params: { churchId: context.churchId },
      body: { memberId, phoneNumberSnapshot, source, consentedAt, confirmed },
    });

  const verbal = await requestConsent(members[0]);
  assert.equal(verbal.statusCode, 200, JSON.stringify(verbal.payload));
  const verbalRecord = await getDoc("smsConsents", smsConsentIdForChurchPhone(context.churchId, phones[0]));
  assert.equal(verbalRecord.source, "admin_verbal");
  assert.equal(verbalRecord.consentedAt, "2026-10-01");
  assert.equal(verbalRecord.recordedByUid, "teams_api_admin_admin_sms_consent");
  assert.ok(verbalRecord.recordedAt);
  assert.ok(verbalRecord.consentVersion);
  assert.ok(verbalRecord.consentText);

  const pendingPhone = phones[1];
  const pendingConsentId = smsConsentIdForChurchPhone(context.churchId, pendingPhone);
  await setDoc("smsConsents", pendingConsentId, {
    consentId: pendingConsentId,
    churchId: context.churchId,
    phoneNumber: pendingPhone,
    status: "pending",
    source: "web_form",
    createdAt: "2026-09-01T12:00:00.000Z",
    consentSubmittedAt: "2026-09-01T12:00:00.000Z",
    verificationCodeHash: "obsolete-hash",
    verificationCodeSalt: "obsolete-salt",
    verificationExpiresAt: "2026-09-01T12:10:00.000Z",
    verificationChallengeId: "obsolete-challenge",
    verificationCancellationTokenHash: "obsolete-cancellation-hash",
    verificationCancellationExpiresAt: "2026-09-01T12:10:00.000Z",
    verificationAttempts: 2,
    lastCancelledVerificationChallengeId: "old-challenge",
    lastCancelledVerificationTokenHash: "old-cancellation-hash",
    lastCancelledVerificationTokenExpiresAt: "2026-09-01T12:10:00.000Z",
    verificationSentAt: "2026-09-01T12:00:05.000Z",
  }, { merge: false });
  const signed = await requestConsent(members[1], "admin_signed_form");
  assert.equal(signed.statusCode, 200);
  const signedRecord = await getDoc("smsConsents", pendingConsentId);
  assert.equal(signedRecord.status, "opted_in");
  assert.equal(signedRecord.source, "admin_signed_form");
  assert.equal(signedRecord.createdAt, "2026-09-01T12:00:00.000Z");
  assert.equal(signedRecord.consentSubmittedAt, "2026-09-01T12:00:00.000Z");
  for (const field of [
    "verificationCodeHash", "verificationCodeSalt", "verificationExpiresAt",
    "verificationChallengeId", "verificationCancellationTokenHash",
    "verificationCancellationExpiresAt", "lastCancelledVerificationChallengeId",
    "lastCancelledVerificationTokenHash", "lastCancelledVerificationTokenExpiresAt",
  ]) assert.equal(signedRecord[field], null, field);
  assert.equal(signedRecord.verificationAttempts, 0);
  assert.equal(signedRecord.verificationSentAt, "2026-09-01T12:00:05.000Z");
  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, { context });
  assert.equal(bootstrap.payload.smsEligibilityByMemberId[members[0]].status, "enabled");
  assert.equal(bootstrap.payload.smsEligibilityByMemberId[members[1]].eligible, true);
  assert.equal(bootstrap.payload.smsEligibilityByMemberId[members[2]].status, "no_mobile");

  assert.equal((await requestConsent(members[2])).statusCode, 400);
  assert.equal((await requestConsent(members[3])).statusCode, 400);
  assert.equal((await requestConsent(members[0], "admin_verbal", "2099-01-01")).statusCode, 400);
  assert.equal((await requestConsent(members[2], "admin_verbal", "2026-10-01", context, false)).statusCode, 400);
  await setDoc("teamRosterMembers", members[6], { archivedAt: "2026-09-30T12:00:00.000Z" }, { merge: true });
  assert.equal((await requestConsent(members[6])).statusCode, 409);
  await setDoc("teamRosterMembers", members[0], { phoneNumber: "+19545551299" }, { merge: true });
  assert.equal((await requestConsent(members[0], "admin_verbal", "2026-10-01", context, true, phones[0])).statusCode, 409);
  await seedSmsConsentForServerTests({ churchId: context.churchId, phoneNumber: phones[5], status: "opted_out", optedOutAt: "2026-09-30T00:00:00.000Z" });
  assert.equal((await requestConsent(members[5], "admin_signed_form")).statusCode, 409);
  const optedOutRecord = await getDoc("smsConsents", smsConsentIdForChurchPhone(context.churchId, phones[5]));
  assert.equal(optedOutRecord.status, "opted_out");
  assert.equal(optedOutRecord.optedOutAt, "2026-09-30T00:00:00.000Z");

  const webRecordId = smsConsentIdForChurchPhone(context.churchId, phones[4]);
  await setDoc("smsConsents", webRecordId, {
    consentId: webRecordId,
    churchId: context.churchId,
    phoneNumber: phones[4],
    status: "opted_in",
    source: "web_form",
    consentedAt: "2026-09-29T12:00:00.000Z",
    verifiedAt: "2026-09-29T12:00:00.000Z",
    consentVersion: "existing-web-version",
    consentText: "existing web consent text",
  }, { merge: false });
  assert.equal((await requestConsent(members[4], "admin_verbal")).statusCode, 409);
  const unchangedWebRecord = await getDoc("smsConsents", webRecordId);
  assert.equal(unchangedWebRecord.source, "web_form");
  assert.equal(unchangedWebRecord.consentVersion, "existing-web-version");
  assert.equal(unchangedWebRecord.consentText, "existing web consent text");

  const editor = await createHumanContext("admin_sms_consent_editor", {
    churchId: context.churchId,
    role: "member",
    permissions: { teams: "edit" },
  });
  const unauthorized = await requestConsent(members[0], "admin_verbal", "2026-10-01", editor);
  assert.equal(unauthorized.statusCode, 403);
});

test("individual intake SMS records provider failure and blocks missing consent, disabled messaging, revoked requests, and closed forms", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("individual_intake_sms_guards");
  const { teamId, memberIds } = await seedTeam(context, {
    teamName: "Worship",
    members: [{ firstName: "Sms", lastName: "Guarded" }],
  });
  const memberId = memberIds.Sms;
  const phoneNumber = "+19545551235";
  await setDoc("teamRosterMembers", memberId, { phoneNumber }, { merge: true });
  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Guarded availability",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      teamIds: [teamId],
      active: true,
    },
  });
  const created = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context,
    params: { formId: form.payload.form.formId },
    body: { memberIds: [memberId] },
  });
  const recipientId = created.payload.recipients[0].recipientId;
  const previewSms = () =>
    callHandler(authHandlers.prepareTeamIntakeRecipientSms, {
      context,
      params: { formId: form.payload.form.formId, recipientId },
    });
  await setDoc(
    "churchMessagingConfigs",
    context.churchId,
    {
      churchId: context.churchId,
      provider: "twilio",
      providerAccountId: "AC_test",
      messagingServiceId: "MG_test",
      registrationStatus: "approved",
      enabled: true,
    },
    { merge: false },
  );
  const noConsent = await previewSms();
  assert.equal(noConsent.statusCode, 200);
  assert.equal(noConsent.payload.preview.eligible, false);
  assert.equal(noConsent.payload.preview.eligibilityStatus, "consent_needed");

  await seedSmsConsentForServerTests({
    churchId: context.churchId,
    phoneNumber,
    status: "opted_in",
  });
  await setDoc(
    "churchMessagingConfigs",
    context.churchId,
    {
      churchId: context.churchId,
      provider: "twilio",
      providerAccountId: "AC_test",
      messagingServiceId: "MG_test",
      registrationStatus: "approved",
      enabled: true,
    },
    { merge: false },
  );
  const failingProvider = createFakeSmsProvider({
    sendMessage: async () => {
      const error = new Error("provider rejected message");
      error.code = "30007";
      throw error;
    },
  });
  setSmsProviderForServerTests(failingProvider);
  try {
    const preview = await previewSms();
    const failed = await callHandler(authHandlers.sendTeamIntakeRecipientSms, {
      context,
      params: { formId: form.payload.form.formId, recipientId },
      body: {
        confirmed: true,
        approvalVersion: preview.payload.preview.approvalVersion,
      },
    });
    assert.equal(failed.statusCode, 502);
    const attempts = await queryDocs("smsDeliveryAttempts", [
      { field: "recipientId", value: recipientId },
    ]);
    assert.equal(attempts.at(-1).status, "failed");
    assert.equal(attempts.at(-1).failureCode, "30007");
  } finally {
    setSmsProviderForServerTests(null);
  }

  await setDoc(
    "churchMessagingConfigs",
    context.churchId,
    { enabled: true },
    { merge: true },
  );
  const beforeDisabled = await previewSms();

  await setDoc(
    "churchMessagingConfigs",
    context.churchId,
    { enabled: false },
    { merge: true },
  );
  const disabled = await callHandler(authHandlers.sendTeamIntakeRecipientSms, {
    context,
    params: { formId: form.payload.form.formId, recipientId },
    body: {
      confirmed: true,
      approvalVersion: beforeDisabled.payload.preview.approvalVersion,
    },
  });
  assert.equal(disabled.statusCode, 503);

  await setDoc(
    "churchMessagingConfigs",
    context.churchId,
    { enabled: true },
    { merge: true },
  );
  await setDoc(
    "teamIntakeForms",
    form.payload.form.formId,
    { active: true },
    { merge: true },
  );
  const beforeClosed = await previewSms();
  await setDoc(
    "teamIntakeForms",
    form.payload.form.formId,
    { active: false },
    { merge: true },
  );
  const closed = await callHandler(authHandlers.sendTeamIntakeRecipientSms, {
    context,
    params: { formId: form.payload.form.formId, recipientId },
    body: {
      confirmed: true,
      approvalVersion: beforeClosed.payload.preview.approvalVersion,
    },
  });
  assert.equal(closed.statusCode, 400);
  assert.match(closed.payload.errorMessage, /closed/i);

  const revoked = await callHandler(authHandlers.revokeTeamIntakeRecipient, {
    context,
    params: { recipientId },
  });
  assert.equal(revoked.statusCode, 200);
  const revokedSend = await callHandler(
    authHandlers.sendTeamIntakeRecipientSms,
    {
      context,
      params: { formId: form.payload.form.formId, recipientId },
      body: {
        confirmed: true,
        approvalVersion: beforeClosed.payload.preview.approvalVersion,
      },
    },
  );
  assert.equal(revokedSend.statusCode, 404);
});

test("default position IEM must come from equipment categorized as IEM", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("position_default_iem_category");
  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Worship", memberIds: [] },
  });
  const teamId = team.payload.team.teamId;
  const enabled = await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId },
    body: { name: "Worship", memberIds: [], usesIemAssignments: true },
  });
  assert.equal(enabled.statusCode, 200);
  const church = await getDoc("churches", context.churchId);
  await setDoc("churches", context.churchId, {
    ...church,
    serviceEquipment: [
      { id: "iem-1", category: "iem", name: "IEM 1" },
      { id: "speaker-1", category: "speaker", name: "Speaker" },
    ],
  });

  const invalid = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Invalid IEM", teamId, defaultIemId: "speaker-1" },
  });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.payload.errorMessage, /default IEM/i);

  const valid = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Valid IEM", teamId, defaultIemId: "iem-1" },
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.payload.position.defaultIemId, "iem-1");
});

test("generic IEM catalog rejects microphones and concurrent schedule maps coexist", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("iem_catalog_and_schedule");
  const missingCatalog = await callHandler(authHandlers.saveServiceEquipment, {
    context,
    body: {},
  });
  assert.equal(missingCatalog.statusCode, 400);
  const invalid = await callHandler(authHandlers.saveServiceEquipment, {
    context,
    body: {
      equipment: [{ id: "not-a-mic", category: "microphone", name: "Mic 1" }],
    },
  });
  assert.equal(invalid.statusCode, 400);

  const catalog = await callHandler(authHandlers.saveServiceEquipment, {
    context,
    body: {
      equipment: [
        {
          id: "iem-1",
          category: "iem",
          name: "IEM 1",
          subtype: "wireless-beltpack",
        },
        {
          id: "iem-custom",
          category: "iem",
          name: "Custom pack",
          subtype: "Auracast receiver",
          color: "#Ab12Ef",
        },
      ],
    },
  });
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.payload.equipment[0].category, "iem");
  assert.equal(catalog.payload.equipment[0].id, "iem-1");
  assert.equal(catalog.payload.equipment[0].color, "#9ca3af");
  assert.equal(catalog.payload.equipment[1].id, "iem-custom");
  assert.equal(catalog.payload.equipment[1].subtype, "Auracast receiver");
  assert.equal(catalog.payload.equipment[1].color, "#ab12ef");
  const loadedCatalog = await callHandler(authHandlers.getServiceEquipment, {
    context,
  });
  assert.equal(loadedCatalog.statusCode, 200);
  assert.deepEqual(loadedCatalog.payload.equipment, catalog.payload.equipment);
  await callHandler(authHandlers.saveServicePlanMicrophones, {
    context,
    body: {
      microphones: [
        { id: "iem-1", name: "Mic 1", type: "Handheld", color: "#22d3ee" },
      ],
      audiences: [],
    },
  });
  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Worship", memberIds: [] },
  });
  const teamId = team.payload.team.teamId;
  await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId },
    body: {
      name: "Worship",
      memberIds: [],
      usesMicrophoneAssignments: true,
      usesIemAssignments: true,
    },
  });
  const position = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Lead", teamId, defaultIemId: "iem-1" },
  });
  const positionId = position.payload.position.positionId;
  const occurrenceId = "service-sunday@2026-09-06T10:00:00.000Z";
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "September",
      teamId,
      startDate: "2026-09-06",
      endDate: "2026-09-06",
      serviceIds: ["service-sunday"],
      occurrences: [
        {
          occurrenceId,
          serviceId: "service-sunday",
          name: "Sunday",
          startsAt: "2026-09-06T10:00:00.000Z",
          positionRequirements: [{ positionId, count: 1 }],
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;
  const slotKey = `${positionId}::0`;
  const results = await Promise.all([
    callHandler(authHandlers.updateTeamScheduleAssignmentMicrophones, {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: slotKey,
        microphoneIds: ["iem-1"],
      },
    }),
    callHandler(authHandlers.updateTeamScheduleAssignmentIems, {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: slotKey,
        iemIds: ["iem-1"],
      },
    }),
  ]);
  assert.equal(
    results.every((result) => result.statusCode === 200),
    true,
  );
  const final = await callHandler(authHandlers.getTeamScheduleDetail, {
    context,
    params: { scheduleId },
  });
  assert.deepEqual(
    final.payload.schedule.microphoneAssignments[occurrenceId][slotKey],
    ["iem-1"],
  );
  assert.deepEqual(
    final.payload.schedule.iemAssignments[occurrenceId][slotKey],
    ["iem-1"],
  );

  const saveEquipment = (kind, ids) =>
    callHandler(
      kind === "microphone"
        ? authHandlers.updateTeamScheduleAssignmentMicrophones
        : authHandlers.updateTeamScheduleAssignmentIems,
      {
        context,
        params: { scheduleId },
        body: {
          serviceId: occurrenceId,
          positionSlotKey: slotKey,
          [kind === "microphone" ? "microphoneIds" : "iemIds"]: ids,
        },
      },
    );
  for (const kind of ["microphone", "iem"]) {
    const unknown = await saveEquipment(kind, ["deleted-equipment"]);
    assert.equal(unknown.statusCode, 409);
    const mixed = await saveEquipment(kind, ["iem-1", "deleted-equipment"]);
    assert.equal(mixed.statusCode, 409);
    const unchanged = await callHandler(authHandlers.getTeamScheduleDetail, {
      context,
      params: { scheduleId },
    });
    const assignmentMap =
      kind === "microphone"
        ? unchanged.payload.schedule.microphoneAssignments
        : unchanged.payload.schedule.iemAssignments;
    assert.deepEqual(assignmentMap[occurrenceId][slotKey], ["iem-1"]);
    const cleared = await saveEquipment(kind, []);
    assert.equal(cleared.statusCode, 200);
    const afterClear =
      kind === "microphone"
        ? cleared.payload.schedule.microphoneAssignments
        : cleared.payload.schedule.iemAssignments;
    assert.equal(afterClear[occurrenceId]?.[slotKey], undefined);
    assert.equal((await saveEquipment(kind, ["iem-1"])).statusCode, 200);
  }

  await setDoc(
    "churches",
    context.churchId,
    {
      serviceEquipment: [
        { id: "not-an-iem", category: "speaker", name: "Speaker" },
      ],
    },
    { merge: true },
  );
  const arbitraryEquipment = await saveEquipment("iem", ["not-an-iem"]);
  assert.equal(arbitraryEquipment.statusCode, 409);
});

test("schedule assignment paths share requirement and implicit slot validation", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("shared_schedule_slot_validation");
  await callHandler(authHandlers.saveServicePlanMicrophones, {
    context,
    body: {
      microphones: [{ id: "mic-1", name: "Mic 1", type: "Handheld" }],
      audiences: [],
    },
  });
  await callHandler(authHandlers.saveServiceEquipment, {
    context,
    body: {
      equipment: [{ id: "iem-1", category: "iem", name: "IEM 1" }],
    },
  });
  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Lead" }, { name: "Keys" }],
    members: [
      { firstName: "Avery", lastName: "Stone", positions: ["Lead"] },
      { firstName: "Jordan", lastName: "Reed", positions: ["Keys"] },
      { firstName: "Sam", lastName: "Cole", positions: ["Lead"] },
      { firstName: "Taylor", lastName: "Gray", positions: ["Lead"] },
    ],
  });
  await callHandler(authHandlers.updateTeam, {
    context,
    params: { teamId },
    body: {
      name: "Worship",
      memberIds: Object.values(memberIds),
      usesMicrophoneAssignments: true,
      usesIemAssignments: true,
    },
  });
  const otherTeam = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Media", memberIds: [] },
  });
  const otherPosition = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Camera", teamId: otherTeam.payload.team.teamId },
  });
  const occurrenceIds = {
    implicit: "service-sunday@2026-09-06T10:00:00.000Z",
    one: "service-sunday@2026-09-13T10:00:00.000Z",
    two: "service-sunday@2026-09-20T10:00:00.000Z",
  };
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "September",
      teamId,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      serviceIds: ["service-sunday"],
      occurrences: [
        {
          occurrenceId: occurrenceIds.implicit,
          serviceId: "service-sunday",
          name: "Implicit slots",
          startsAt: "2026-09-06T10:00:00.000Z",
        },
        {
          occurrenceId: occurrenceIds.one,
          serviceId: "service-sunday",
          name: "One slot",
          startsAt: "2026-09-13T10:00:00.000Z",
          positionRequirements: [{ positionId: positionIds.Lead, count: 1 }],
        },
        {
          occurrenceId: occurrenceIds.two,
          serviceId: "service-sunday",
          name: "Two slots",
          startsAt: "2026-09-20T10:00:00.000Z",
          positionRequirements: [{ positionId: positionIds.Lead, count: 2 }],
        },
      ],
    },
  });
  assert.equal(schedule.statusCode, 200);
  const scheduleId = schedule.payload.schedule.scheduleId;

  const saveForPath = (kind, occurrenceId, slotKey, value) => {
    const body = { serviceId: occurrenceId, positionSlotKey: slotKey };
    if (kind === "member") {
      body.memberId = value;
      body.serviceDate =
        occurrenceId === occurrenceIds.two
          ? "2026-09-20"
          : occurrenceId === occurrenceIds.one
            ? "2026-09-13"
            : "2026-09-06";
      return callHandler(authHandlers.updateTeamScheduleAssignment, {
        context,
        params: { scheduleId },
        body,
      });
    }
    body[kind === "microphone" ? "microphoneIds" : "iemIds"] = value;
    return callHandler(
      kind === "microphone"
        ? authHandlers.updateTeamScheduleAssignmentMicrophones
        : authHandlers.updateTeamScheduleAssignmentIems,
      { context, params: { scheduleId }, body },
    );
  };
  const paths = [
    ["member", memberIds.Avery],
    ["microphone", ["mic-1"]],
    ["iem", ["iem-1"]],
  ];
  const assertAllPaths = async (
    occurrenceId,
    positionId,
    slotIndex,
    expected,
  ) => {
    const slotKey = `${positionId}::${slotIndex}`;
    const results = await Promise.all(
      paths.map(([kind, value]) =>
        saveForPath(
          kind,
          occurrenceId,
          slotKey,
          kind === "member"
            ? positionId === positionIds.Keys
              ? memberIds.Jordan
              : [memberIds.Avery, memberIds.Sam, memberIds.Taylor][slotIndex]
            : value,
        ),
      ),
    );
    for (const result of results)
      assert.equal(result.statusCode === 200, expected);
    return results;
  };

  // With no explicit requirements, every team position has its implicit slot 0.
  await assertAllPaths(occurrenceIds.implicit, positionIds.Lead, 0, true);
  await assertAllPaths(occurrenceIds.implicit, positionIds.Keys, 0, true);
  await assertAllPaths(occurrenceIds.implicit, positionIds.Lead, 1, false);

  // Explicit count 1 permits slot 0, rejects slot 1, then permits it when added.
  await assertAllPaths(occurrenceIds.one, positionIds.Lead, 0, true);
  await assertAllPaths(occurrenceIds.one, positionIds.Lead, 1, false);
  const addOneExtra = await callHandler(
    authHandlers.addTeamSchedulePositionSlot,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceIds.one,
        positionSlotKey: `${positionIds.Lead}::1`,
      },
    },
  );
  assert.equal(addOneExtra.statusCode, 200);
  await assertAllPaths(occurrenceIds.one, positionIds.Lead, 1, true);

  // Explicit count 2 permits slots 0 and 1, rejects slot 2, then permits it when added.
  await assertAllPaths(occurrenceIds.two, positionIds.Lead, 0, true);
  await assertAllPaths(occurrenceIds.two, positionIds.Lead, 1, true);
  await assertAllPaths(occurrenceIds.two, positionIds.Lead, 2, false);
  const addTwoExtra = await callHandler(
    authHandlers.addTeamSchedulePositionSlot,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceIds.two,
        positionSlotKey: `${positionIds.Lead}::2`,
      },
    },
  );
  assert.equal(addTwoExtra.statusCode, 200);
  await assertAllPaths(occurrenceIds.two, positionIds.Lead, 2, true);

  const concurrentAdds = await Promise.all([
    callHandler(authHandlers.addTeamSchedulePositionSlot, {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceIds.two,
        positionSlotKey: `${positionIds.Lead}::3`,
      },
    }),
    callHandler(authHandlers.addTeamSchedulePositionSlot, {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceIds.two,
        positionSlotKey: `${positionIds.Keys}::0`,
      },
    }),
  ]);
  assert.deepEqual(
    concurrentAdds.map(({ statusCode }) => statusCode),
    [200, 200],
  );
  const afterConcurrentAdds = await callHandler(
    authHandlers.getTeamScheduleDetail,
    {
      context,
      params: { scheduleId },
    },
  );
  assert.deepEqual(
    new Set(
      afterConcurrentAdds.payload.schedule.additionalPositionSlots[
        occurrenceIds.two
      ],
    ),
    new Set([
      `${positionIds.Lead}::2`,
      `${positionIds.Lead}::3`,
      `${positionIds.Keys}::0`,
    ]),
  );

  // Race both equipment writers with removal after the slot has been created.
  // Whichever write reaches the in-memory save queue first, no equipment map
  // may retain an assignment for the removed slot.
  const racedSlotKey = `${positionIds.Lead}::2`;
  const raced = await Promise.all([
    saveForPath("microphone", occurrenceIds.two, racedSlotKey, ["mic-1"]),
    saveForPath("iem", occurrenceIds.two, racedSlotKey, ["iem-1"]),
    callHandler(authHandlers.removeTeamSchedulePositionSlot, {
      context,
      params: { scheduleId },
      body: { serviceId: occurrenceIds.two, positionSlotKey: racedSlotKey },
    }),
  ]);
  assert.equal(raced[2].statusCode, 200);
  const afterRemovalRace = await callHandler(
    authHandlers.getTeamScheduleDetail,
    {
      context,
      params: { scheduleId },
    },
  );
  assert.equal(
    Boolean(
      afterRemovalRace.payload.schedule.additionalPositionSlots?.[
        occurrenceIds.two
      ]?.includes(racedSlotKey),
    ),
    false,
  );
  assert.equal(
    afterRemovalRace.payload.schedule.microphoneAssignments?.[
      occurrenceIds.two
    ]?.[racedSlotKey],
    undefined,
  );
  assert.equal(
    afterRemovalRace.payload.schedule.iemAssignments?.[occurrenceIds.two]?.[
      racedSlotKey
    ],
    undefined,
  );

  // The fallback does not bypass team ownership or position existence checks.
  for (const [kind, value] of paths) {
    const wrongTeam = await saveForPath(
      kind,
      occurrenceIds.implicit,
      `${otherPosition.payload.position.positionId}::0`,
      value,
    );
    assert.notEqual(wrongTeam.statusCode, 200);
    const missingPosition = await saveForPath(
      kind,
      occurrenceIds.implicit,
      "missing-position::0",
      value,
    );
    assert.notEqual(missingPosition.statusCode, 200);
  }

  // Empty equipment arrays still clear assignments for a valid slot.
  for (const kind of ["microphone", "iem"]) {
    const cleared = await saveForPath(
      kind,
      occurrenceIds.implicit,
      `${positionIds.Lead}::0`,
      [],
    );
    assert.equal(cleared.statusCode, 200);
  }
  const reloaded = await callHandler(authHandlers.getTeamScheduleDetail, {
    context,
    params: { scheduleId },
  });
  assert.equal(
    reloaded.payload.schedule.microphoneAssignments[occurrenceIds.implicit][
      `${positionIds.Lead}::0`
    ],
    undefined,
  );
  assert.equal(
    reloaded.payload.schedule.iemAssignments[occurrenceIds.implicit][
      `${positionIds.Lead}::0`
    ],
    undefined,
  );
  assert.deepEqual(
    reloaded.payload.schedule.microphoneAssignments[occurrenceIds.implicit][
      `${positionIds.Keys}::0`
    ],
    ["mic-1"],
  );
  assert.deepEqual(
    reloaded.payload.schedule.iemAssignments[occurrenceIds.implicit][
      `${positionIds.Keys}::0`
    ],
    ["iem-1"],
  );
});

test("portable CSV preview is read-only and commit never links imported members to accounts", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_import");
  const { teamId } = await seedTeam(context, { teamName: "Worship" });
  const csv =
    "first_name,last_name,email\nJane,Volunteer,shared@example.com\nJohn,Volunteer,shared@example.com\n";
  const inspected = await callHandler(authHandlers.inspectPortableImport, {
    context,
    body: { type: "members", csv },
  });
  assert.equal(inspected.statusCode, 200);
  assert.equal(inspected.payload.rowCount, 2);
  assert.equal(inspected.payload.mapping.firstName, "first_name");
  assert.equal(inspected.payload.mapping.lastName, "last_name");
  assert.deepEqual(inspected.payload.columnStats.email, { nonBlank: 2, blank: 0 });
  const aliased = await callHandler(authHandlers.inspectPortableImport, {
    context,
    body: {
      type: "members",
      csv: "Volunteer,Ministry,Role,Mobile\nJane Doe,Praise Team,Vocalist,555-0100\n",
    },
  });
  assert.equal(aliased.payload.mapping.name, "Volunteer");
  assert.equal(aliased.payload.mapping.teams, "Ministry");
  assert.deepEqual(aliased.payload.columnStats.Ministry, { nonBlank: 1, blank: 0 });
  const partiallyAssigned = await callHandler(authHandlers.inspectPortableImport, {
    context,
    body: {
      type: "members",
      csv: "First Name,Last Name,Teams\nJane,Doe,Worship\nJanet,Smith,\n",
    },
  });
  assert.deepEqual(partiallyAssigned.payload.columnStats.Teams, {
    nonBlank: 1,
    blank: 1,
  });
  assert.equal(aliased.payload.mapping.positions, "Role");
  assert.equal(aliased.payload.mapping.phone, "Mobile");
  const preview = await callHandler(authHandlers.previewPortableImport, {
    context,
    body: { type: "members", csv, mapping: inspected.payload.mapping, destinationTeamId: teamId },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.payload.previewToken.length > 0, true);
  assert.equal(preview.payload.previewCsvHash, hashPortableCsv(csv));
  assert.equal(preview.payload.summary.create, 2);
  assert.equal(preview.payload.summary.update, 0);
  const before = await callHandler(authHandlers.getTeamsBootstrap, { context });
  assert.equal(
    before.payload.members.some(
      (member) => member.email === "shared@example.com",
    ),
    false,
  );
  const committed = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members",
      previewToken: preview.payload.previewToken,
      previewCsvHash: hashPortableCsv(csv),
      mapping: inspected.payload.mapping,
      destinationTeamId: teamId,
      approvedRows: preview.payload.rows.map(
        ({ row, action, matchedId, record }) => ({
          row,
          action,
          recordId: matchedId || undefined,
          record,
        }),
      ),
    },
  });
  console.log("DEBUG preview commit output", committed.payload);
  assert.equal(committed.statusCode, 200);
  assert.equal(committed.payload.summary.created, 2);
  const after = await callHandler(authHandlers.getTeamsBootstrap, { context });
  const imported = after.payload.members.filter(
    (member) => member.email === "shared@example.com",
  );
  assert.equal(imported.length, 2);
  assert.equal(
    imported.every((member) => !member.userId),
    true,
  );
});

test("portable create commits deduplicate safe entity identities across rows and retries", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_idempotent_creates");
  const teamRows = [1, 2].map((row) => ({
    row,
    action: "create",
    record: { name: "Import Team" },
  }));
  const teamCommit = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: { type: "teams", approvedRows: teamRows },
  });
  assert.equal(teamCommit.payload.summary.created, 2);
  const retry = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: { type: "teams", approvedRows: teamRows },
  });
  assert.equal(retry.payload.summary.created, 2);
  assert.deepEqual(
    retry.payload.results.map(({ id }) => id),
    teamCommit.payload.results.map(({ id }) => id),
  );
  const teamsAfter = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  assert.equal(
    teamsAfter.payload.teams.filter((team) => team.name === "Import Team")
      .length,
    1,
  );

  const teamId = teamsAfter.payload.teams.find(
    (team) => team.name === "Import Team",
  ).teamId;
  const unsupportedCustomIcon = await callHandler(
    authHandlers.createTeamPosition,
    {
      context,
      body: {
        name: "Unsupported Icon",
        teamId,
        icon: { source: "custom", id: "church-icon" },
      },
    },
  );
  assert.equal(unsupportedCustomIcon.statusCode, 400);
  const positionRows = [1, 2].map((row) => ({
    row,
    action: "create",
    record: { name: "Imported Role", team: "Import Team", teamId },
  }));
  const firstPositionCommit = await callHandler(
    authHandlers.commitPortableImport,
    { context, body: { type: "positions", approvedRows: positionRows } },
  );
  const retriedPositionCommit = await callHandler(
    authHandlers.commitPortableImport,
    { context, body: { type: "positions", approvedRows: positionRows } },
  );
  assert.deepEqual(
    retriedPositionCommit.payload.results.map(({ id }) => id),
    firstPositionCommit.payload.results.map(({ id }) => id),
  );
  const afterPositions = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  assert.equal(
    afterPositions.payload.positions.filter(
      (position) => position.name === "Imported Role",
    ).length,
    1,
  );

  const memberPreview = await previewMemberCsv(context, "First Name,Last Name,Email\nAlex,Same,alex@example.com\nAlex,Same,alex@example.com\nAlex,Same,alex2@example.com\nAlex,Same,\nAlex,Same,\n", { destinationTeamId: teamId });
  const approvedMemberRows = memberPreview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash }));
  const firstMemberCommit = await callHandler(
    authHandlers.commitPortableImport,
    { context, body: { type: "members", destinationTeamId: teamId, previewToken: memberPreview.payload.previewToken, previewCsvHash: memberPreview.previewCsvHash, mapping: memberPreview.mapping, approvedRows: approvedMemberRows } },
  );
  const retriedMemberCommit = await callHandler(
    authHandlers.commitPortableImport,
    { context, body: { type: "members", destinationTeamId: teamId, previewToken: memberPreview.payload.previewToken, previewCsvHash: memberPreview.previewCsvHash, mapping: memberPreview.mapping, approvedRows: approvedMemberRows } },
  );
  assert.deepEqual(
    retriedMemberCommit.payload.results.map(({ id }) => id),
    firstMemberCommit.payload.results.map(({ id }) => id),
  );
  const afterMembers = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  assert.equal(
    afterMembers.payload.members.filter(
      (member) => member.firstName === "Alex" && member.lastName === "Same",
    ).length,
    4,
  );
  assert.equal(
    afterMembers.payload.members.filter(
      (member) => member.email === "alex@example.com",
    ).length,
    1,
  );

  const existing = afterMembers.payload.members.find(
    (member) => member.email === "alex@example.com",
  );
  const updatePreview = await previewMemberCsv(context, `First Name,Last Name,Email,WorshipSync Member ID\nAlex Updated,Same,alex@example.com,${existing.memberId}\n`, { destinationTeamId: teamId });
  const update = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members",
      destinationTeamId: teamId,
      previewToken: updatePreview.payload.previewToken,
      previewCsvHash: updatePreview.previewCsvHash,
      mapping: updatePreview.mapping,
      approvedRows: [
        {
          row: 2,
          action: "update",
          recordId: existing.memberId,
          record: updatePreview.payload.rows[0].record,
          expectedStateHash: updatePreview.payload.rows[0].expectedStateHash,
        },
      ],
    },
  });
  assert.equal(update.payload.summary.updated, 1);
  assert.equal(
    (
      await callHandler(authHandlers.getTeamsBootstrap, { context })
    ).payload.members.find((member) => member.memberId === existing.memberId)
      .firstName,
    "Alex Updated",
  );
});

test("portable create claims serialize concurrent retries and stay church-scoped", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const churchA = await createAdminContext("portable_claim_church_a");
  const churchB = await createAdminContext("portable_claim_church_b");
  const createTeamRows = [
    { row: 2, action: "create", record: { name: "Concurrent Team" } },
  ];
  const teamBody = { type: "teams", approvedRows: createTeamRows };
  const [teamA1, teamA2] = await Promise.all([
    callHandler(authHandlers.commitPortableImport, {
      context: churchA,
      body: teamBody,
    }),
    callHandler(authHandlers.commitPortableImport, {
      context: churchA,
      body: teamBody,
    }),
  ]);
  assert.equal(teamA1.payload.summary.created, 1);
  assert.equal(teamA2.payload.summary.created, 1);
  // Retrying after the first response has been discarded resolves through the
  // persisted claim to the same entity.
  await callHandler(authHandlers.commitPortableImport, {
    context: churchA,
    body: teamBody,
  });
  const teamB = await callHandler(authHandlers.commitPortableImport, {
    context: churchB,
    body: teamBody,
  });
  assert.equal(teamB.payload.summary.created, 1);

  const bootA = await callHandler(authHandlers.getTeamsBootstrap, {
    context: churchA,
  });
  const bootB = await callHandler(authHandlers.getTeamsBootstrap, {
    context: churchB,
  });
  const aTeam = bootA.payload.teams.find(
    (item) => item.name === "Concurrent Team",
  );
  const bTeam = bootB.payload.teams.find(
    (item) => item.name === "Concurrent Team",
  );
  assert.ok(aTeam && bTeam);
  assert.notEqual(aTeam.teamId, bTeam.teamId);
  assert.equal(
    bootA.payload.teams.filter((item) => item.name === "Concurrent Team")
      .length,
    1,
  );
  assert.equal(
    bootB.payload.teams.filter((item) => item.name === "Concurrent Team")
      .length,
    1,
  );
  const churchAClaims = await queryDocs(
    COLLECTIONS.portableImportCreates,
    [{ field: "churchId", value: churchA.churchId }],
    { limit: 0 },
  );
  const churchBClaims = await queryDocs(
    COLLECTIONS.portableImportCreates,
    [{ field: "churchId", value: churchB.churchId }],
    { limit: 0 },
  );
  assert.equal(churchAClaims.length, 1);
  assert.equal(churchBClaims.length, 1);

  const positionRows = [
    {
      row: 2,
      action: "create",
      record: {
        name: "Concurrent Role",
        team: "Concurrent Team",
        teamId: aTeam.teamId,
      },
    },
  ];
  await Promise.all([
    callHandler(authHandlers.commitPortableImport, {
      context: churchA,
      body: { type: "positions", approvedRows: positionRows },
    }),
    callHandler(authHandlers.commitPortableImport, {
      context: churchA,
      body: { type: "positions", approvedRows: positionRows },
    }),
  ]);
  const afterPositions = await callHandler(authHandlers.getTeamsBootstrap, {
    context: churchA,
  });
  assert.equal(
    afterPositions.payload.positions.filter(
      (item) => item.name === "Concurrent Role",
    ).length,
    1,
  );

  const memberPreview = await previewMemberCsv(churchA, "First Name,Last Name,Email\nCasey,Concurrent,shared-concurrent@example.com\n", { destinationTeamId: aTeam.teamId });
  await Promise.all([
    callHandler(authHandlers.commitPortableImport, {
      context: churchA,
      body: { type: "members", destinationTeamId: aTeam.teamId, previewToken: memberPreview.payload.previewToken, previewCsvHash: memberPreview.previewCsvHash, mapping: memberPreview.mapping, approvedRows: memberPreview.payload.rows.map(({ row, action, record, matchedId }) => ({ row, action, record, recordId: matchedId || undefined })) },
    }),
    callHandler(authHandlers.commitPortableImport, {
      context: churchA,
      body: { type: "members", destinationTeamId: aTeam.teamId, previewToken: memberPreview.payload.previewToken, previewCsvHash: memberPreview.previewCsvHash, mapping: memberPreview.mapping, approvedRows: memberPreview.payload.rows.map(({ row, action, record, matchedId }) => ({ row, action, record, recordId: matchedId || undefined })) },
    }),
  ]);
  const afterMembers = await callHandler(authHandlers.getTeamsBootstrap, {
    context: churchA,
  });
  assert.equal(
    afterMembers.payload.members.filter(
      (item) => item.email === "shared-concurrent@example.com",
    ).length,
    1,
  );
  const allClaims = await queryDocs(
    COLLECTIONS.portableImportCreates,
    [{ field: "churchId", value: churchA.churchId }],
    { limit: 0 },
  );
  assert.deepEqual(allClaims.map((claim) => claim.kind).sort(), [
    "member",
    "position",
    "team",
  ]);
});

test("portable create rows with stale natural matches require a fresh preview", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("portable_stale_create_preview");
  const teamRow = { row: 2, action: "create", record: { name: "Media" } };
  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Media", description: "Do not overwrite" },
  });
  const teamImport = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: { type: "teams", approvedRows: [teamRow] },
  });
  assert.equal(teamImport.payload.summary.failed, 1);
  assert.match(teamImport.payload.results[0].message, /preview/i);
  assert.equal(
    (await getDoc(COLLECTIONS.teams, team.payload.team.teamId)).description,
    "Do not overwrite",
  );

  const position = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: {
      name: "Camera",
      teamId: team.payload.team.teamId,
      description: "Keep this",
    },
  });
  const positionImport = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "positions",
      approvedRows: [
        {
          row: 2,
          action: "create",
          record: {
            name: "Camera",
            team: "Media",
            teamId: team.payload.team.teamId,
            description: "Overwrite attempt",
          },
        },
      ],
    },
  });
  assert.equal(positionImport.payload.summary.failed, 1);
  assert.equal(
    (
      await getDoc(
        COLLECTIONS.teamPositions,
        position.payload.position.positionId,
      )
    ).description,
    "Keep this",
  );

  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Taylor",
      lastName: "Member",
      email: "taylor@example.com",
      notes: "Keep this",
    },
  });
  const memberPreview = await previewMemberCsv(context, "First Name,Last Name,Email,Notes\nTaylor,Member,taylor@example.com,Keep this\n");
  const memberImport = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members",
      previewToken: memberPreview.payload.previewToken,
      previewCsvHash: memberPreview.previewCsvHash,
      mapping: memberPreview.mapping,
      approvedRows: [
        {
          row: 2,
          action: "create",
          record: {
            firstName: "Taylor",
            lastName: "Member",
            email: "taylor@example.com",
            notes: "Keep this",
          },
        },
      ],
    },
  });
  assert.equal(memberImport.payload.summary.failed, 1);
  assert.equal(
    (
      await getDoc(
        COLLECTIONS.teamRosterMembers,
        member.payload.member.memberId,
      )
    ).notes,
    "Keep this",
  );
});

test("portable service preview and commit validate actual calendar dates", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext(
    "data_transfer_service_calendar_dates",
  );
  const previewCsv = async (csv) => {
    const inspected = await callHandler(authHandlers.inspectPortableImport, {
      context,
      body: { type: "services", csv },
    });
    return callHandler(authHandlers.previewPortableImport, {
      context,
      body: { type: "services", csv, mapping: inspected.payload.mapping },
    });
  };
  for (const date of ["2026-02-30", "2026-13-01", "2025-02-29"]) {
    const preview = await previewCsv(
      `Service,Recurrence,Date\nHoliday,one_time,${date}\n`,
    );
    assert.equal(preview.payload.rows[0].action, "invalid");
  }
  const invalidRange = await previewCsv(
    "Service,Recurrence,Start Date,End Date\nSunday,weekly,2026-06-01,2026-05-01\n",
  );
  assert.equal(invalidRange.payload.rows[0].action, "invalid");
  assert.equal(
    invalidRange.payload.rows[0].issues.some(
      (issue) => issue.field === "endDate",
    ),
    true,
  );
  const leap = await previewCsv(
    "Service,Recurrence,Date\nLeap Day,one_time,2024-02-29\n",
  );
  assert.equal(leap.payload.rows[0].action, "create");
  const approved = leap.payload.rows.map(
    ({ row, action, matchedId, record }) => ({
      row,
      action,
      recordId: matchedId || undefined,
      record,
    }),
  );
  assert.equal(
    (
      await callHandler(authHandlers.commitPortableImport, {
        context,
        body: { type: "services", approvedRows: approved },
      })
    ).payload.summary.created,
    1,
  );
  const exported = await callHandler(authHandlers.exportPortableData, {
    context,
    params: { type: "services" },
  });
  const roundTrip = await previewCsv(String(exported.body));
  assert.equal(roundTrip.payload.summary.update, 1);
  const tampered = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "services",
      approvedRows: [
        {
          row: 2,
          action: "create",
          record: {
            name: "Bad Date",
            recurrence: "one_time",
            date: "2026-02-30",
          },
        },
      ],
    },
  });
  assert.equal(tampered.payload.summary.failed, 1);
});

test("portable member IDs only match records in the current church", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const sourceChurch = await createAdminContext(
    "data_transfer_foreign_id_source",
  );
  const targetChurch = await createAdminContext(
    "data_transfer_foreign_id_target",
  );
  const localTeam = await seedTeam(targetChurch, { teamName: "Local" });
  const foreignMember = await callHandler(authHandlers.createTeamRosterMember, {
    context: sourceChurch,
    body: {
      firstName: "Alex",
      lastName: "Source",
      teamIds: [],
      positionIds: [],
    },
  });
  const localMember = await callHandler(authHandlers.createTeamRosterMember, {
    context: targetChurch,
    body: {
      firstName: "Alex",
      lastName: "Source",
      teamIds: [],
      positionIds: [],
    },
  });
  const csv = `First Name,Last Name,WorshipSync Member ID\nUpdated,Local,${localMember.payload.member.memberId}\nAlex,Source,${foreignMember.payload.member.memberId}\n`;
  const inspected = await callHandler(authHandlers.inspectPortableImport, {
    context: targetChurch,
    body: { type: "members", csv },
  });
  const preview = await callHandler(authHandlers.previewPortableImport, {
    context: targetChurch,
    body: { type: "members", csv, mapping: inspected.payload.mapping, destinationTeamId: localTeam.teamId },
  });
  assert.deepEqual(
    preview.payload.rows.map((row) => row.action),
    ["update", "review"],
  );
  assert.equal(
    preview.payload.rows[0].matchedId,
    localMember.payload.member.memberId,
  );
  assert.equal(preview.payload.rows[1].matchedId, null);
  assert.equal(
    preview.payload.rows[1].issues.some(
      (issue) => issue.code === "foreign_or_unknown_record_id",
    ),
    true,
  );
  assert.equal(
    preview.payload.rows[1].candidates[0].id,
    localMember.payload.member.memberId,
  );
});

test("portable team ID from another church does not auto-match a same-named local team", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const source = await createAdminContext("data_transfer_team_id_source");
  const target = await createAdminContext("data_transfer_team_id_target");
  const foreign = await callHandler(authHandlers.createTeam, {
    context: source,
    body: { name: "Media", memberIds: [] },
  });
  const local = await callHandler(authHandlers.createTeam, {
    context: target,
    body: { name: "Media", memberIds: [] },
  });
  const csv = `Team,WorshipSync Team ID\nMedia,${foreign.payload.team.teamId}\n`;
  const inspected = await callHandler(authHandlers.inspectPortableImport, {
    context: target,
    body: { type: "teams", csv },
  });
  const preview = await callHandler(authHandlers.previewPortableImport, {
    context: target,
    body: { type: "teams", csv, mapping: inspected.payload.mapping },
  });
  assert.equal(preview.payload.rows[0].action, "review");
  assert.equal(preview.payload.rows[0].matchedId, null);
  assert.equal(
    preview.payload.rows[0].candidates[0].id,
    local.payload.team.teamId,
  );
  assert.equal(
    preview.payload.rows[0].issues[0].code,
    "foreign_or_unknown_record_id",
  );
  const forgedReference = await callHandler(authHandlers.commitPortableImport, {
    context: target,
    body: {
      type: "positions",
      approvedRows: [
        {
          row: 2,
          action: "create",
          record: { name: "Keys", team: "Media" },
          resolutions: { team: foreign.payload.team.teamId },
        },
      ],
    },
  });
  assert.equal(forgedReference.payload.results[0].code, "stale_preview");
  const forgedRecord = await callHandler(authHandlers.commitPortableImport, {
    context: target,
    body: {
      type: "teams",
      approvedRows: [
        {
          row: 2,
          action: "update",
          recordId: foreign.payload.team.teamId,
          record: { name: "Media" },
        },
      ],
    },
  });
  assert.equal(forgedRecord.payload.results[0].code, "stale_preview");

  const secondLocal = await callHandler(authHandlers.createTeam, {
    context: target,
    body: { name: "Media", memberIds: [] },
  });
  const positionCsv = "Position,Team\nKeys,Media\n";
  const positionInspection = await callHandler(
    authHandlers.inspectPortableImport,
    { context: target, body: { type: "positions", csv: positionCsv } },
  );
  const positionPreview = await callHandler(
    authHandlers.previewPortableImport,
    {
      context: target,
      body: {
        type: "positions",
        csv: positionCsv,
        mapping: positionInspection.payload.mapping,
      },
    },
  );
  const relationshipIssue = positionPreview.payload.rows[0].issues.find(
    (issue) => issue.field === "team",
  );
  assert.equal(positionPreview.payload.rows[0].action, "review");
  assert.equal(relationshipIssue.code, "ambiguous_reference");
  assert.equal(relationshipIssue.candidates.length, 2);
  const selectedTeamId = relationshipIssue.candidates[0].id;
  const resolvedCommit = await callHandler(authHandlers.commitPortableImport, {
    context: target,
    body: {
      type: "positions",
      approvedRows: [
        {
          row: 2,
          action: "create",
          record: { name: "Keys", team: "Media" },
          resolutions: { team: selectedTeamId },
        },
      ],
    },
  });
  assert.equal(resolvedCommit.payload.summary.created, 1);
  const selectedTeam = [local.payload.team, secondLocal.payload.team].find(
    (team) => team.teamId === selectedTeamId,
  );
  await setDoc("teams", selectedTeamId, {
    ...selectedTeam,
    archivedAt: "2026-09-29T12:00:00.000Z",
  });
  const staleResolution = await callHandler(authHandlers.commitPortableImport, {
    context: target,
    body: {
      type: "positions",
      approvedRows: [
        {
          row: 2,
          action: "create",
          record: { name: "Vocal", team: "Media" },
          resolutions: { team: selectedTeamId },
        },
      ],
    },
  });
  assert.equal(staleResolution.payload.results[0].code, "stale_preview");

  const archivedCsv = "Team,Archived\nOld Media,true\n";
  const archivedInspection = await callHandler(
    authHandlers.inspectPortableImport,
    { context: target, body: { type: "teams", csv: archivedCsv } },
  );
  const archivedPreview = await callHandler(
    authHandlers.previewPortableImport,
    {
      context: target,
      body: {
        type: "teams",
        csv: archivedCsv,
        mapping: archivedInspection.payload.mapping,
      },
    },
  );
  assert.equal(archivedPreview.payload.rows[0].action, "invalid");
  assert.equal(
    archivedPreview.payload.rows[0].issues.some(
      (issue) => issue.code === "archive_import_unsupported",
    ),
    true,
  );
});

test("portable service import offers and applies an explicit local position match", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const source = await createAdminContext(
    "data_transfer_service_position_source",
  );
  const target = await createAdminContext(
    "data_transfer_service_position_target",
  );
  const sourceTeam = await callHandler(authHandlers.createTeam, {
    context: source,
    body: { name: "Media", memberIds: [] },
  });
  const targetTeam = await callHandler(authHandlers.createTeam, {
    context: target,
    body: { name: "Media", memberIds: [] },
  });
  const foreignPosition = await callHandler(authHandlers.createTeamPosition, {
    context: source,
    body: { name: "Keys", teamId: sourceTeam.payload.team.teamId },
  });
  const localPosition = await callHandler(authHandlers.createTeamPosition, {
    context: target,
    body: { name: "Keys", teamId: targetTeam.payload.team.teamId },
  });
  const csv = `Service,Recurrence,Time,Weekday,Position,Required Slots,WorshipSync Position ID\nSunday,weekly,10:00,Sunday,Keys,1,${foreignPosition.payload.position.positionId}\n`;
  const inspected = await callHandler(authHandlers.inspectPortableImport, {
    context: target,
    body: { type: "services", csv },
  });
  const preview = await callHandler(authHandlers.previewPortableImport, {
    context: target,
    body: { type: "services", csv, mapping: inspected.payload.mapping },
  });
  const relationship = preview.payload.rows[0].issues.find(
    (issue) => issue.field === "position",
  );
  assert.equal(preview.payload.rows[0].action, "review");
  assert.equal(relationship.code, "foreign_or_unknown_reference_id");
  assert.equal(relationship.candidates.length, 1);
  assert.equal(
    relationship.candidates[0].id,
    localPosition.payload.position.positionId,
  );

  const committed = await callHandler(authHandlers.commitPortableImport, {
    context: target,
    body: {
      type: "services",
      approvedRows: [
        {
          row: preview.payload.rows[0].row,
          action: "create",
          record: preview.payload.rows[0].record,
          resolutions: { position: localPosition.payload.position.positionId },
        },
      ],
    },
  });
  assert.equal(committed.payload.summary.created, 1, JSON.stringify(committed.payload));
  const exported = await callHandler(authHandlers.exportPortableData, {
    context: target,
    params: { type: "services" },
  });
  assert.match(
    String(exported.body),
    new RegExp(localPosition.payload.position.positionId),
  );
  assert.doesNotMatch(
    String(exported.body),
    new RegExp(foreignPosition.payload.position.positionId),
  );
});

test("portable CSV transfer requires an admin and export reads complete schedule records", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const nonAdmin = await createHumanContext("data_transfer_member", {
    role: "member",
  });
  const denied = await callHandler(authHandlers.exportPortableData, {
    context: nonAdmin,
    params: { type: "members" },
  });
  assert.equal(denied.statusCode, 403);

  const context = await createAdminContext("data_transfer_export");
  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "=1+1", memberIds: [] },
  });
  const teamId = team.payload.team.teamId;
  const scheduleId = "data-transfer-full-schedule";
  await setDoc("teamSchedules", scheduleId, {
    scheduleId,
    churchId: context.churchId,
    name: "Older schedule",
    teamId,
    startDate: "2020-01-05",
    endDate: "2020-01-05",
    serviceIds: ["service-old"],
    occurrences: [
      {
        occurrenceId: "service-old@2020-01-05T15:00:00.000Z",
        serviceId: "service-old",
        name: "Sunday",
        startsAt: "2020-01-05T15:00:00.000Z",
        positionRequirements: [],
      },
    ],
    assignments: {
      "service-old@2020-01-05T15:00:00.000Z": {
        "position-old::0": { primaryMemberId: "member-old" },
      },
    },
  });
  const schedules = await callHandler(authHandlers.exportPortableData, {
    context,
    params: { type: "schedules" },
  });
  assert.equal(schedules.statusCode, 200);
  assert.match(String(schedules.body), /Older schedule/);
  assert.match(String(schedules.body), /member-old/);
  const teams = await callHandler(authHandlers.exportPortableData, {
    context,
    params: { type: "teams" },
  });
  assert.equal(teams.statusCode, 200);
  assert.match(String(teams.body), /'\\=1\+1/);
  const archive = await callHandler(authHandlers.exportPortableData, {
    context,
    params: { type: "all" },
  });
  assert.equal(archive.statusCode, 200);
  assert.equal(archive.body.readUInt32LE(0), 0x04034b50);
});

test("portable schedule import validates and preserves the schedule assignment model", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_schedule_import");
  const { teamId, positionIds } = await seedTeam(context, {
    teamName: "Worship",
    positions: [{ name: "Keys" }],
  });
  const positionId = positionIds.Keys;
  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Sam",
      lastName: "Singer",
      teamIds: [teamId],
      positionIds: [positionId],
    },
  });
  const memberId = member.payload.member.memberId;
  const shadowMember = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Taylor",
      lastName: "Shadow",
      teamIds: [teamId],
      positionIds: [positionId],
    },
  });
  const reverseMember = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Morgan",
      lastName: "Reverse",
      teamIds: [teamId],
      positionIds: [positionId],
    },
  });
  seedChurchServiceTimesForServerTests({
    churchId: context.churchId,
    services: [
      {
        id: "service-sunday",
        serviceId: "service-sunday",
        name: "Sunday",
        timerType: "countdown",
        reccurence: "weekly",
        time: "20:00",
        dayOfWeek: 0,
        positionRequirements: [{ positionId, count: 1 }],
      },
    ],
  });
  const csv =
    "Schedule,Start Date,End Date,Service,Date,Start Time,Team,Position,Slot,Person,Email,Assignment Type,Guest,WorshipSync Service ID,WorshipSync Team ID,WorshipSync Position ID,WorshipSync Member ID\nMay,2026-10-03,2026-10-03,Sunday,2026-10-03,20:00,Worship,Keys,1,Sam Singer,,primary,false,service-sunday," +
    teamId +
    "," +
    positionId +
    "," +
    memberId +
    "\nMay,2026-10-03,2026-10-03,Sunday,2026-10-03,20:00,Worship,Keys,1,Taylor Shadow,,shadow,false,service-sunday," +
    teamId +
    "," +
    positionId +
    "," +
    shadowMember.payload.member.memberId +
    "\nMay,2026-10-03,2026-10-03,Sunday,2026-10-03,20:00,Worship,Keys,1,Morgan Reverse,,reverse_shadow,false,service-sunday," +
    teamId +
    "," +
    positionId +
    "," +
    reverseMember.payload.member.memberId +
    "\nMay,2026-10-03,2026-10-03,Sunday,2026-10-03,20:00,Worship,Keys,2,Guest Singer,guest@example.com,primary,true,service-sunday," +
    teamId +
    "," +
    positionId +
    ",\n";
  const inspected = await callHandler(authHandlers.inspectPortableImport, {
    context,
    body: { type: "schedules", csv },
  });
  const preview = await callHandler(authHandlers.previewPortableImport, {
    context,
    body: { type: "schedules", csv, mapping: inspected.payload.mapping },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.payload.summary.create, 4);
  const imported = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "schedules",
      timeZone: "America/New_York",
      approvedRows: preview.payload.rows.map(
        ({ row, action, matchedId, record }) => ({
          row,
          action,
          recordId: matchedId || undefined,
          record,
        }),
      ),
    },
  });
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.payload.summary.created, 4);
  const detail = await callHandler(authHandlers.getTeamScheduleDetail, {
    context,
    params: { scheduleId: imported.payload.results[0].id },
  });
  const occurrence = detail.payload.schedule.occurrences[0];
  assert.equal(detail.payload.schedule.teamId, teamId);
  assert.equal(
    detail.payload.schedule.assignments[occurrence.occurrenceId][
      `${positionId}::0`
    ].primaryMemberId,
    memberId,
  );
  assert.deepEqual(
    detail.payload.schedule.assignments[occurrence.occurrenceId][
      `${positionId}::0`
    ].shadows.map(({ memberId: id, kind }) => [id, kind]),
    [
      [shadowMember.payload.member.memberId, "shadow"],
      [reverseMember.payload.member.memberId, "reverse_shadow"],
    ],
  );
  assert.equal(detail.payload.schedule.guests.length, 1);
  assert.equal(detail.payload.schedule.assignmentsOmitted, undefined);

  const repeatedPreview = await callHandler(
    authHandlers.previewPortableImport,
    {
      context,
      body: { type: "schedules", csv, mapping: inspected.payload.mapping },
    },
  );
  const repeatedImport = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "schedules",
      timeZone: "America/New_York",
      approvedRows: repeatedPreview.payload.rows.map(
        ({ row, action, matchedId, record }) => ({
          row,
          action,
          recordId: matchedId || undefined,
          record,
        }),
      ),
    },
  });
  assert.equal(repeatedImport.payload.summary.failed, 0);
  const replacement = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Jordan",
      lastName: "Replacement",
      teamIds: [teamId],
      positionIds: [positionId],
    },
  });
  const replacementCsv = csv
    .replace("Sam Singer", "Jordan Replacement")
    .replace(memberId, replacement.payload.member.memberId);
  const replacementInspection = await callHandler(
    authHandlers.inspectPortableImport,
    { context, body: { type: "schedules", csv: replacementCsv } },
  );
  const replacementPreview = await callHandler(
    authHandlers.previewPortableImport,
    {
      context,
      body: {
        type: "schedules",
        csv: replacementCsv,
        mapping: replacementInspection.payload.mapping,
      },
    },
  );
  const replaced = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "schedules",
      timeZone: "America/New_York",
      approvedRows: replacementPreview.payload.rows.map(
        ({ row, action, matchedId, record }) => ({
          row,
          action,
          recordId: matchedId || undefined,
          record,
        }),
      ),
    },
  });
  assert.equal(replaced.payload.summary.failed, 0);
  const afterReplacement = await callHandler(
    authHandlers.getTeamScheduleDetail,
    { context, params: { scheduleId: detail.payload.schedule.scheduleId } },
  );
  assert.equal(
    afterReplacement.payload.schedule.assignments[occurrence.occurrenceId][
      `${positionId}::0`
    ].primaryMemberId,
    replacement.payload.member.memberId,
  );
  const emptySlotCsv =
    "Schedule,Start Date,End Date,Service,Date,Start Time,Team,Position,Slot,Person,Email,Assignment Type,Guest\nMay,2026-10-03,2026-10-03,Sunday,2026-10-03,20:00,Worship,Keys,1,,,,false\n";
  const emptyInspection = await callHandler(
    authHandlers.inspectPortableImport,
    { context, body: { type: "schedules", csv: emptySlotCsv } },
  );
  const emptyPreview = await callHandler(authHandlers.previewPortableImport, {
    context,
    body: {
      type: "schedules",
      csv: emptySlotCsv,
      mapping: emptyInspection.payload.mapping,
    },
  });
  const emptyCommit = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "schedules",
      timeZone: "America/New_York",
      approvedRows: emptyPreview.payload.rows.map(
        ({ row, action, matchedId, record }) => ({
          row,
          action,
          recordId: matchedId || undefined,
          record,
        }),
      ),
    },
  });
  assert.equal(emptyCommit.payload.summary.failed, 0);
  const afterEmpty = await callHandler(authHandlers.getTeamScheduleDetail, {
    context,
    params: { scheduleId: detail.payload.schedule.scheduleId },
  });
  assert.equal(
    afterEmpty.payload.schedule.assignments[occurrence.occurrenceId][
      `${positionId}::0`
    ].primaryMemberId,
    replacement.payload.member.memberId,
  );

  const exportResponse = await callHandler(authHandlers.exportPortableData, {
    context,
    params: { type: "schedules" },
    query: { timeZone: "America/New_York" },
  });
  const exportedScheduleCsv = String(exportResponse.body);
  const invalidTimeZoneExport = await callHandler(
    authHandlers.exportPortableData,
    {
      context,
      params: { type: "schedules" },
      query: { timeZone: "Not/A_Time_Zone" },
    },
  );
  assert.equal(invalidTimeZoneExport.statusCode, 400);
  const roundTripInspection = await callHandler(
    authHandlers.inspectPortableImport,
    { context, body: { type: "schedules", csv: exportedScheduleCsv } },
  );
  const roundTripPreview = await callHandler(
    authHandlers.previewPortableImport,
    {
      context,
      body: {
        type: "schedules",
        csv: exportedScheduleCsv,
        mapping: roundTripInspection.payload.mapping,
      },
    },
  );
  assert.equal(roundTripPreview.payload.summary.update, 4);
  assert.equal(roundTripPreview.payload.rows[0].record.date, "2026-10-03");
  assert.equal(roundTripPreview.payload.rows[0].record.startTime, "20:00");
  const roundTripRows = roundTripPreview.payload.rows.map(
    ({ row, action, matchedId, record }) => ({
      row,
      action,
      recordId: matchedId || undefined,
      record,
    }),
  );
  assert.equal(
    (
      await callHandler(authHandlers.commitPortableImport, {
        context,
        body: {
          type: "schedules",
          timeZone: "America/New_York",
          approvedRows: roundTripRows,
        },
      })
    ).payload.summary.failed,
    0,
  );
  assert.equal(
    (
      await callHandler(authHandlers.commitPortableImport, {
        context,
        body: {
          type: "schedules",
          timeZone: "America/New_York",
          approvedRows: roundTripRows,
        },
      })
    ).payload.summary.failed,
    0,
  );
  const roundTripDetail = await callHandler(
    authHandlers.getTeamScheduleDetail,
    { context, params: { scheduleId: detail.payload.schedule.scheduleId } },
  );
  assert.equal(roundTripDetail.payload.schedule.guests.length, 1);
  assert.equal(
    roundTripDetail.payload.schedule.assignments[occurrence.occurrenceId][
      `${positionId}::0`
    ].shadows.length,
    2,
  );
  assert.equal(
    roundTripDetail.payload.schedule.occurrences[0].startsAt,
    "2026-10-04T00:00:00.000Z",
  );
});

test("foreign schedule ID does not auto-match a local schedule with the same name and date", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const source = await createAdminContext("data_transfer_schedule_id_source");
  const target = await createAdminContext("data_transfer_schedule_id_target");
  const sourceTeam = await callHandler(authHandlers.createTeam, {
    context: source,
    body: { name: "Worship", memberIds: [] },
  });
  const targetTeam = await callHandler(authHandlers.createTeam, {
    context: target,
    body: { name: "Worship", memberIds: [] },
  });
  const foreignId = "foreign-schedule-id";
  const localId = "local-schedule-id";
  await setDoc("teamSchedules", foreignId, {
    scheduleId: foreignId,
    churchId: source.churchId,
    name: "May",
    teamId: sourceTeam.payload.team.teamId,
    startDate: "2026-05-03",
    endDate: "2026-05-03",
    occurrences: [],
    assignments: {},
  });
  await setDoc("teamSchedules", localId, {
    scheduleId: localId,
    churchId: target.churchId,
    name: "May",
    teamId: targetTeam.payload.team.teamId,
    startDate: "2026-05-03",
    endDate: "2026-05-03",
    occurrences: [],
    assignments: {},
  });
  seedChurchServiceTimesForServerTests({
    churchId: target.churchId,
    services: [
      {
        serviceId: "target-sunday",
        id: "target-sunday",
        name: "Sunday",
        reccurence: "weekly",
        time: "10:00",
        dayOfWeek: 0,
      },
    ],
  });
  const csv = `Schedule,Start Date,End Date,Service,Date,Start Time,Team,WorshipSync Schedule ID,Service ID,Team ID\nMay,2026-05-03,2026-05-03,Sunday,2026-05-03,10:00,Worship,${foreignId},target-sunday,${targetTeam.payload.team.teamId}\n`;
  const inspected = await callHandler(authHandlers.inspectPortableImport, {
    context: target,
    body: { type: "schedules", csv },
  });
  const preview = await callHandler(authHandlers.previewPortableImport, {
    context: target,
    body: { type: "schedules", csv, mapping: inspected.payload.mapping },
  });
  assert.equal(preview.payload.rows[0].action, "review");
  assert.equal(preview.payload.rows[0].matchedId, null);
  assert.equal(
    preview.payload.rows[0].candidates.some((item) => item.id === localId),
    true,
    JSON.stringify(preview.payload.rows[0]),
  );
  assert.equal(
    preview.payload.rows[0].issues.some(
      (issue) => issue.code === "foreign_or_unknown_record_id",
    ),
    true,
  );
});

test("portable member import resolves repeated team and position references independently", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const target = await createAdminContext(
    "data_transfer_multi_member_references",
  );
  const praiseA = await callHandler(authHandlers.createTeam, {
    context: target,
    body: { name: "Praise", memberIds: [] },
  });
  const praiseB = await callHandler(authHandlers.createTeam, {
    context: target,
    body: { name: "Praise", memberIds: [] },
  });
  const mediaA = await callHandler(authHandlers.createTeam, {
    context: target,
    body: { name: "Media", memberIds: [] },
  });
  const mediaB = await callHandler(authHandlers.createTeam, {
    context: target,
    body: { name: "Media", memberIds: [] },
  });
  const vocalist = await callHandler(authHandlers.createTeamPosition, {
    context: target,
    body: { name: "Vocalist", teamId: praiseA.payload.team.teamId },
  });
  const otherVocalist = await callHandler(authHandlers.createTeamPosition, {
    context: target,
    body: { name: "Vocalist", teamId: praiseB.payload.team.teamId },
  });
  const camera = await callHandler(authHandlers.createTeamPosition, {
    context: target,
    body: { name: "Camera", teamId: mediaB.payload.team.teamId },
  });
  const otherCamera = await callHandler(authHandlers.createTeamPosition, {
    context: target,
    body: { name: "Camera", teamId: mediaA.payload.team.teamId },
  });
  const csv =
    "First Name,Last Name,Teams,Positions\nJane,Doe,Praise | Media,Vocalist | Camera\n";
  const inspected = await callHandler(authHandlers.inspectPortableImport, {
    context: target,
    body: { type: "members", csv },
  });
  const preview = await callHandler(authHandlers.previewPortableImport, {
    context: target,
    body: { type: "members", csv, mapping: inspected.payload.mapping },
  });
  assert.equal(preview.payload.rows[0].action, "review");
  const relationshipIssues = preview.payload.rows[0].issues.filter((issue) =>
    ["teams", "positions"].includes(issue.field),
  );
  assert.deepEqual(
    relationshipIssues.map(
      ({ field, referenceIndex }) => `${field}:${referenceIndex}`,
    ),
    ["teams:0", "teams:1", "positions:0", "positions:1"],
  );
  assert.equal(relationshipIssues.filter((issue) => issue.field === "positions").flatMap((issue) => issue.candidates || []).every((candidate) => Boolean(candidate.teamName)), true);
  const resolutions = [
    {
      field: "teams",
      referenceIndex: 0,
      selectedId: praiseA.payload.team.teamId,
    },
    {
      field: "teams",
      referenceIndex: 1,
      selectedId: mediaB.payload.team.teamId,
    },
    {
      field: "positions",
      referenceIndex: 0,
      selectedId: vocalist.payload.position.positionId,
    },
    {
      field: "positions",
      referenceIndex: 1,
      selectedId: camera.payload.position.positionId,
    },
  ];
  const stalePositionId = otherVocalist.payload.position.positionId;
  const stalePosition = await getDoc("teamPositions", stalePositionId);
  await setDoc("teamPositions", stalePositionId, {
    ...stalePosition,
    archivedAt: "2026-09-29T12:00:00.000Z",
  });
  const staleCommit = await callHandler(authHandlers.commitPortableImport, {
    context: target,
    body: {
      type: "members",
      previewToken: preview.payload.previewToken,
      previewCsvHash: hashPortableCsv(csv),
      mapping: inspected.payload.mapping,
      approvedRows: [
        {
          row: 2,
          action: "create",
          record: preview.payload.rows[0].record,
          resolutions: resolutions.map((item) =>
            item.referenceIndex === 0 && item.field === "positions"
              ? { ...item, selectedId: stalePositionId }
              : item,
          ),
        },
      ],
    },
  });
  assert.equal(staleCommit.payload.results[0].code, "stale_preview");
  const teamActions = [
    { sourceValue: "Praise", action: "match", teamId: praiseA.payload.team.teamId },
    { sourceValue: "Media", action: "match", teamId: mediaB.payload.team.teamId },
  ];
  const refreshed = await previewMemberCsv(target, csv, { teamActions });
  assert.deepEqual(refreshed.payload.rows[0].issues, []);
  const committed = await callHandler(authHandlers.commitPortableImport, {
    context: target,
    body: {
      type: "members",
      teamActions,
      previewToken: refreshed.payload.previewToken,
      previewCsvHash: hashPortableCsv(csv),
      mapping: refreshed.mapping,
      approvedRows: [
        {
          row: 2,
          action: "create",
          record: preview.payload.rows[0].record,
        },
      ],
    },
  });
  assert.equal(committed.payload.summary.created, 1, JSON.stringify(committed.payload));
  const imported = await getDoc(
    "teamRosterMembers",
    committed.payload.results[0].id,
  );
  assert.deepEqual(imported.positionIds, [
    vocalist.payload.position.positionId,
    camera.payload.position.positionId,
  ]);
  assert.deepEqual(
    imported.positionIds.includes(otherVocalist.payload.position.positionId),
    false,
  );
  assert.deepEqual(
    imported.positionIds.includes(otherCamera.payload.position.positionId),
    false,
  );
  const importedPraise = await getDoc("teams", praiseA.payload.team.teamId);
  const importedMedia = await getDoc("teams", mediaB.payload.team.teamId);
  assert.equal(importedPraise.memberIds.includes(imported.memberId), true);
  assert.equal(importedMedia.memberIds.includes(imported.memberId), true);
});

test("portable member imports preserve unmapped positions and clear mapped blank positions and teams", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_member_blank_fields");
  const team = await callHandler(authHandlers.createTeam, {
    context,
    body: { name: "Worship", memberIds: [] },
  });
  const firstPosition = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Camera", teamId: team.payload.team.teamId },
  });
  const secondPosition = await callHandler(authHandlers.createTeamPosition, {
    context,
    body: { name: "Sound", teamId: team.payload.team.teamId },
  });
  const memberResult = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Jane",
      lastName: "Doe",
      teamIds: [team.payload.team.teamId],
      positionIds: [firstPosition.payload.position.positionId],
    },
  });
  const memberId = memberResult.payload.member.memberId;

  const updateFromCsv = async (csv, updateMode = "merge") => {
    const inspected = await callHandler(authHandlers.inspectPortableImport, {
      context,
      body: { type: "members", csv },
    });
    const preview = await callHandler(authHandlers.previewPortableImport, {
      context,
      body: { type: "members", csv, mapping: inspected.payload.mapping, destinationTeamId: team.payload.team.teamId, updateMode },
    });
    assert.equal(preview.payload.rows[0].matchedId, memberId);
    const committed = await callHandler(authHandlers.commitPortableImport, {
      context,
      body: {
        type: "members",
        destinationTeamId: team.payload.team.teamId,
        updateMode,
        previewToken: preview.payload.previewToken,
        previewCsvHash: hashPortableCsv(csv),
        mapping: inspected.payload.mapping,
        approvedRows: [
          {
            row: preview.payload.rows[0].row,
            action: "update",
            recordId: memberId,
            record: preview.payload.rows[0].record,
            expectedStateHash: preview.payload.rows[0].expectedStateHash,
          },
        ],
      },
    });
    assert.equal(
      committed.payload.summary.updated + committed.payload.summary.unchanged,
      1,
      JSON.stringify(committed.payload.results),
    );
    return getDoc("teamRosterMembers", memberId);
  };

  let saved = await updateFromCsv(
    `First Name,Last Name,WorshipSync Member ID\nJane,Doe,${memberId}\n`,
  );
  assert.deepEqual(saved.positionIds, [
    firstPosition.payload.position.positionId,
  ]);

  saved = await updateFromCsv(
    `First Name,Last Name,Positions,WorshipSync Member ID\nJane,Doe,,${memberId}\n`,
  );
  assert.deepEqual(saved.positionIds, [firstPosition.payload.position.positionId]);

  saved = await updateFromCsv(
    `First Name,Last Name,Positions,WorshipSync Member ID\nJane,Doe,Sound,${memberId}\n`,
  );
  assert.deepEqual(new Set(saved.positionIds), new Set([
    firstPosition.payload.position.positionId,
    secondPosition.payload.position.positionId,
  ]));

  saved = await updateFromCsv(
    `First Name,Last Name,Teams,Positions,WorshipSync Member ID\nJane,Doe,,,${memberId}\n`,
  );
  assert.deepEqual(new Set(saved.positionIds), new Set([
    firstPosition.payload.position.positionId,
    secondPosition.payload.position.positionId,
  ]));
  const clearedTeam = await getDoc("teams", team.payload.team.teamId);
  assert.equal(clearedTeam.memberIds.includes(memberId), true);

  saved = await updateFromCsv(
    `First Name,Last Name,Teams,Positions,WorshipSync Member ID\nJane,Doe,Worship,,${memberId}\n`,
    "replace",
  );
  assert.deepEqual(saved.positionIds, []);
  assert.equal((await getDoc("teams", team.payload.team.teamId)).memberIds.includes(memberId), true);
  const createCsv = "First Name,Last Name,Positions\nNew,Member,\n";
  const createInspection = await callHandler(
    authHandlers.inspectPortableImport,
    {
      context,
      body: { type: "members", csv: createCsv },
    },
  );
  const createPreview = await callHandler(authHandlers.previewPortableImport, {
    context,
    body: {
      type: "members",
      csv: createCsv,
      mapping: createInspection.payload.mapping,
      destinationTeamId: team.payload.team.teamId,
    },
  });
  const created = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members",
      destinationTeamId: team.payload.team.teamId,
      previewToken: createPreview.payload.previewToken,
      previewCsvHash: hashPortableCsv(createCsv),
      mapping: createInspection.payload.mapping,
      approvedRows: [
        {
          row: createPreview.payload.rows[0].row,
          action: "create",
          record: createPreview.payload.rows[0].record,
        },
      ],
    },
  });
  assert.equal(created.payload.summary.created, 1);
  const createdMember = await getDoc(
    "teamRosterMembers",
    created.payload.results[0].id,
  );
  assert.deepEqual(createdMember.positionIds, []);
  assert.equal((await getDoc("teams", team.payload.team.teamId)).memberIds.includes(createdMember.memberId), true);
});

test("portable schedule import can resolve foreign service and member references with local candidates", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const target = await createAdminContext(
    "data_transfer_schedule_relationship_candidates",
  );
  const { teamId, positionIds } = await seedTeam(target, {
    teamName: "Worship",
    positions: [{ name: "Keys" }],
  });
  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context: target,
    body: {
      firstName: "Sam",
      lastName: "Singer",
      teamIds: [teamId],
      positionIds: [positionIds.Keys],
    },
  });
  seedChurchServiceTimesForServerTests({
    churchId: target.churchId,
    services: [
      {
        serviceId: "local-sunday",
        id: "local-sunday",
        name: "Sunday",
        reccurence: "weekly",
        time: "10:00",
        dayOfWeek: 0,
      },
    ],
  });
  const csv = `Schedule,Start Date,End Date,Service,Date,Start Time,Team,Position,Slot,Person,Guest,WorshipSync Service ID,WorshipSync Team ID,WorshipSync Position ID,WorshipSync Member ID\nMay,2026-05-03,2026-05-03,Sunday,2026-05-03,10:00,Worship,Keys,1,Sam Singer,false,foreign-service,${teamId},${positionIds.Keys},foreign-member\n`;
  const inspected = await callHandler(authHandlers.inspectPortableImport, {
    context: target,
    body: { type: "schedules", csv },
  });
  const preview = await callHandler(authHandlers.previewPortableImport, {
    context: target,
    body: { type: "schedules", csv, mapping: inspected.payload.mapping },
  });
  assert.equal(preview.payload.rows[0].action, "review");
  const serviceIssue = preview.payload.rows[0].issues.find(
    (issue) => issue.field === "serviceId",
  );
  const memberIssue = preview.payload.rows[0].issues.find(
    (issue) => issue.field === "person",
  );
  assert.equal(serviceIssue.code, "foreign_or_unknown_reference_id");
  assert.equal(memberIssue.code, "foreign_or_unknown_reference_id");
  assert.equal(serviceIssue.candidates[0].id, "local-sunday");
  assert.equal(memberIssue.candidates[0].id, member.payload.member.memberId);
  const committed = await callHandler(authHandlers.commitPortableImport, {
    context: target,
    body: {
      type: "schedules",
      approvedRows: [
        {
          row: preview.payload.rows[0].row,
          action: "create",
          record: preview.payload.rows[0].record,
          resolutions: [
            {
              field: "serviceId",
              referenceIndex: 0,
              selectedId: "local-sunday",
            },
            {
              field: "person",
              referenceIndex: 0,
              selectedId: member.payload.member.memberId,
            },
          ],
        },
      ],
    },
  });
  assert.equal(committed.payload.summary.created, 1);
  const unresolvedCsv = csv
    .replace("Sunday", "Not imported")
    .replace("Sam Singer", "No Local Member")
    .replace("foreign-service", "unknown-service")
    .replace("foreign-member", "unknown-member");
  const unresolvedInspection = await callHandler(
    authHandlers.inspectPortableImport,
    { context: target, body: { type: "schedules", csv: unresolvedCsv } },
  );
  const unresolvedPreview = await callHandler(
    authHandlers.previewPortableImport,
    {
      context: target,
      body: {
        type: "schedules",
        csv: unresolvedCsv,
        mapping: unresolvedInspection.payload.mapping,
      },
    },
  );
  assert.equal(unresolvedPreview.payload.rows[0].action, "invalid");
});


test("generated period rejects incomplete canonical reuse without overwriting any saved map", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("canonical_missing_rows");
  const { teamId } = await seedTeam(context, { teamName: "Media" });
  const first = { occurrenceId: "first@2026-10-03T10:00:00.000Z", serviceId: "first", name: "First", startsAt: "2026-10-03T10:00:00.000Z", positionRequirements: [] };
  const second = { ...first, occurrenceId: "second@2026-10-03T10:00:00.000Z", serviceId: "second", name: "Second" };
  seedChurchServiceTimesForServerTests({ churchId: context.churchId, services: [first, second].map((item) => ({ id: item.serviceId, name: item.name, reccurence: "one_time", dateTimeISO: item.startsAt })) });
  const body = { name: "October", teamId, startDate: "2026-10-01", endDate: "2026-10-31", timeZone: "UTC", serviceIds: ["first"], occurrences: [first] };
  const created = await callHandler(authHandlers.ensureTeamScheduleForPeriod, { context, body });
  assert.equal(created.statusCode, 200);
  const scheduleId = created.payload.schedule.scheduleId;
  await setDoc("teamSchedules", scheduleId, {
    assignments: { [first.occurrenceId]: { "camera::0": { primaryMemberId: "member" } } },
    microphoneAssignments: { [first.occurrenceId]: { "camera::0": ["mic"] } },
    iemAssignments: { [first.occurrenceId]: { "camera::0": ["iem"] } },
    additionalPositionSlots: { [first.occurrenceId]: ["camera::1"] },
  }, { merge: true });
  const before = await getDoc("teamSchedules", scheduleId);
  const requests = [1, 2].map(() => callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context, body: { ...body, serviceIds: ["first", "second"], occurrences: [first, second], preferredScheduleId: scheduleId },
  }));
  const results = await Promise.all(requests);
  assert.deepEqual(results.map((result) => result.statusCode), [409, 409]);
  assert.match(results[0].payload.errorMessage, /Edit its services or create a custom schedule/);
  assert.deepEqual(await getDoc("teamSchedules", scheduleId), before);
});

test("generated ensure reuses semantically equivalent occurrences after service IDs change", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("semantic_id_drift");
  const { teamId } = await seedTeam(context, { teamName: "Media" });
  const current = { occurrenceId: "new@2026-10-03T10:00:00.000Z", serviceId: "new", name: "Saturday service", startsAt: "2026-10-03T10:00:00.000Z", positionRequirements: [] };
  seedChurchServiceTimesForServerTests({ churchId: context.churchId, services: [{ id: "new", name: current.name, reccurence: "one_time", dateTimeISO: current.startsAt }] });
  const saved = { ...current, occurrenceId: "old@2026-10-03T10:00:00.000Z", serviceId: "old" };
  const schedule = { scheduleId: "custom-old", churchId: context.churchId, name: "October", teamId, source: "custom", startDate: "2026-10-01", endDate: "2026-10-31", serviceIds: ["old"], occurrences: [saved], assignments: { [saved.occurrenceId]: { "camera::0": { primaryMemberId: "member" } } } };
  await setDoc("teamSchedules", schedule.scheduleId, schedule);
  const before = await getDoc("teamSchedules", schedule.scheduleId);
  const result = await callHandler(authHandlers.ensureTeamScheduleForPeriod, { context, body: { name: "October", teamId, startDate: schedule.startDate, endDate: schedule.endDate, timeZone: "UTC", serviceIds: ["new"], occurrences: [current] } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.created, false);
  assert.equal(result.payload.schedule.scheduleId, schedule.scheduleId);
  assert.deepEqual(await getDoc("teamSchedules", schedule.scheduleId), before);
});

test("member preview settings and approved row content are bound to the server preview", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_preview_approval_binding");
  const destination = await seedTeam(context, { teamName: "Worship", positions: [{ name: "Keys" }, { name: "Piano" }] });
  const other = await seedTeam(context, { teamName: "Production" });
  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context, body: { firstName: "Jane", lastName: "Doe", email: "jane@example.com", positionIds: [destination.positionIds.Piano], teamIds: [destination.teamId] },
  });
  const csv = `First Name,Last Name,Email,WorshipSync Member ID\nJane,Doe,,${member.payload.member.memberId}\n`;
  const preview = await previewMemberCsv(context, csv, { destinationTeamId: destination.teamId, updateMode: "merge", clearBlankScalars: false });
  const approved = preview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash }));
  const commitWith = (options = {}) => callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", previewToken: preview.payload.previewToken,
      previewCsvHash: options.previewCsvHash ?? preview.previewCsvHash,
      mapping: options.mapping ?? preview.mapping,
      destinationTeamId: options.destinationTeamId ?? destination.teamId,
      updateMode: options.updateMode ?? "merge",
      clearBlankScalars: options.clearBlankScalars ?? false,
      approvedRows: options.approvedRows ?? approved,
    },
  });
  for (const changedSettings of [
    { updateMode: "replace" },
    { destinationTeamId: other.teamId },
    { clearBlankScalars: true },
    { mapping: { firstName: "Last Name", lastName: "First Name", email: "Email", memberId: "WorshipSync Member ID" } },
    { previewCsvHash: hashPortableCsv(csv.replace("Jane,Doe", "Janet,Doe")) },
  ]) {
    const rejected = await commitWith(changedSettings);
    assert.equal(rejected.statusCode, 409);
    assert.match(rejected.payload.errorMessage, /settings or preview changed/i);
  }
  const tamperedRows = approved.map((row) => ({ ...row, record: { ...row.record, email: "changed@example.com" } }));
  const tampered = await commitWith({ approvedRows: tamperedRows });
  assert.equal(tampered.payload.results[0].code, "stale_preview");
  const saved = await getDoc(COLLECTIONS.teamRosterMembers, member.payload.member.memberId);
  assert.equal(saved.email, "jane@example.com");
  assert.deepEqual(saved.positionIds, [destination.positionIds.Piano]);
});

test("a member changed after commit validation fails stale without blocking other rows", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_import_concurrent_edit");
  const { teamId, positionIds } = await seedTeam(context, { teamName: "Worship", positions: [{ name: "Keys" }] });
  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context, body: { firstName: "Sam", lastName: "Singer", email: "sam@example.com", notes: "Original", teamIds: [teamId], positionIds: [positionIds.Keys], recurringAvailability: { weekdays: ["sunday"] } },
  });
  const csv = `First Name,Last Name,Email,Notes,WorshipSync Member ID\nSamuel,Singer,sam@example.com,Imported,${member.payload.member.memberId}\nTaylor,New,taylor@example.com,New member,\n`;
  const preview = await previewMemberCsv(context, csv, { destinationTeamId: teamId });
  const approvedRows = preview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash }));
  let memberQueries = 0;
  setAuthReadObserverForServerTests(({ type, collectionName }) => {
    if (type === "queryDocs" && collectionName === COLLECTIONS.teamRosterMembers && ++memberQueries === 2) {
      void setDoc(COLLECTIONS.teamRosterMembers, member.payload.member.memberId, { notes: "Concurrent edit" }, { merge: true });
    }
  });
  let committed;
  try {
    committed = await callHandler(authHandlers.commitPortableImport, {
      context, body: { type: "members", previewToken: preview.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: preview.mapping, destinationTeamId: teamId, approvedRows },
    });
  } finally {
    setAuthReadObserverForServerTests(null);
  }
  assert.equal(committed.payload.results.find((result) => result.row === 2).code, "stale_preview");
  assert.equal(committed.payload.results.find((result) => result.row === 3).status, "created");
  const saved = await getDoc(COLLECTIONS.teamRosterMembers, member.payload.member.memberId);
  assert.equal(saved.notes, "Concurrent edit");
  assert.deepEqual(saved.positionIds, [positionIds.Keys]);
  assert.deepEqual(saved.recurringAvailability, member.payload.member.recurringAvailability);
  const retried = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: { type: "members", previewToken: preview.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: preview.mapping, destinationTeamId: teamId, approvedRows },
  });
  assert.equal(retried.payload.results.find((result) => result.row === 2).code, "stale_preview");
  assert.equal(retried.payload.results.find((result) => result.row === 3).status, "unchanged");
  assert.equal((await callHandler(authHandlers.getTeamsBootstrap, { context })).payload.members.filter((item) => item.email === "taylor@example.com").length, 1);
});

test("team membership and position changes invalidate an approved member preview", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_import_team_position_stale");
  const first = await seedTeam(context, { teamName: "Worship", positions: [{ name: "Keys" }] });
  const other = await seedTeam(context, { teamName: "Production", positions: [{ name: "Camera" }] });
  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context, body: { firstName: "Alex", lastName: "Singer", teamIds: [first.teamId], positionIds: [first.positionIds.Keys] },
  });
  const csv = `First Name,Last Name,WorshipSync Member ID\nAlex,Updated,${member.payload.member.memberId}\n`;
  const preview = await previewMemberCsv(context, csv, { destinationTeamId: first.teamId });
  await setDoc(COLLECTIONS.teams, other.teamId, { memberIds: [member.payload.member.memberId] }, { merge: true });
  const changedRoster = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: { type: "members", destinationTeamId: first.teamId, previewToken: preview.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: preview.mapping, approvedRows: preview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash })) },
  });
  assert.equal(changedRoster.payload.results[0].code, "stale_preview");
  const secondPreview = await previewMemberCsv(context, csv, { destinationTeamId: first.teamId });
  await setDoc(COLLECTIONS.teamRosterMembers, member.payload.member.memberId, { positionIds: [first.positionIds.Keys, other.positionIds.Camera] }, { merge: true });
  const changedPositions = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: { type: "members", destinationTeamId: first.teamId, previewToken: secondPreview.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: secondPreview.mapping, approvedRows: secondPreview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash })) },
  });
  assert.equal(changedPositions.payload.results[0].code, "stale_preview");
});

test("member import retry resumes roster synchronization after a partial in-memory write", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_import_partial_retry");
  const { teamId } = await seedTeam(context, { teamName: "Worship" });
  const { teamId: secondTeamId } = await seedTeam(context, { teamName: "Production" });
  const member = await callHandler(authHandlers.createTeamRosterMember, {
    context, body: { firstName: "Jamie", lastName: "Member", email: "jamie@example.com", notes: "Keep", teamIds: [] },
  });
  const csv = `First Name,Last Name,Email,Notes,Teams,WorshipSync Member ID\nJamie,Updated,jamie@example.com,Imported,Worship; Production,${member.payload.member.memberId}\n`;
  const preview = await previewMemberCsv(context, csv, { destinationTeamId: teamId });
  const approvedRows = preview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash }));
  let memberDocReads = 0;
  let failRosterRead = false;
  setAuthReadObserverForServerTests(({ type, collectionName, id }) => {
    if (type === "getDoc" && collectionName === COLLECTIONS.teamRosterMembers && id === member.payload.member.memberId) {
      memberDocReads += 1;
      if (memberDocReads === 2) failRosterRead = true;
    }
    if (failRosterRead && type === "getDoc" && collectionName === COLLECTIONS.teams && id === secondTeamId) {
      failRosterRead = false;
      throw new Error("Injected roster read failure");
    }
  });
  let interrupted;
  try {
    interrupted = await callHandler(authHandlers.commitPortableImport, {
      context, body: { type: "members", destinationTeamId: teamId, previewToken: preview.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: preview.mapping, approvedRows },
    });
  } finally {
    setAuthReadObserverForServerTests(null);
  }
  assert.equal(interrupted.payload.results[0].status, "failed");
  const afterMemberWrite = await getDoc(COLLECTIONS.teamRosterMembers, member.payload.member.memberId);
  assert.equal(afterMemberWrite.lastName, "Updated");
  assert.equal((await getDoc(COLLECTIONS.teams, teamId)).memberIds.includes(afterMemberWrite.memberId), true);
  assert.equal((await getDoc(COLLECTIONS.teams, secondTeamId)).memberIds.includes(afterMemberWrite.memberId), false);

  const retried = await callHandler(authHandlers.commitPortableImport, {
    context, body: { type: "members", destinationTeamId: teamId, previewToken: preview.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: preview.mapping, approvedRows },
  });
  assert.equal(retried.payload.results[0].status, "updated");
  assert.equal((await getDoc(COLLECTIONS.teams, teamId)).memberIds.includes(afterMemberWrite.memberId), true);
  assert.equal((await getDoc(COLLECTIONS.teams, secondTeamId)).memberIds.includes(afterMemberWrite.memberId), true);
  assert.equal((await getDoc(COLLECTIONS.teamRosterMembers, member.payload.member.memberId)).notes, "Imported");
});

test("member import retry completes a partially persisted new member without replaying member fields", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("member_import_create_partial_retry");
  const { teamId } = await seedTeam(context, { teamName: "Worship" });
  const { teamId: otherTeamId, positionIds: otherPositions } = await seedTeam(context, {
    teamName: "Production", positions: [{ name: "Camera" }],
  });
  const csv = "First Name,Last Name,Email,Notes,Positions\nCasey,Creator,casey.creator@example.com,Imported note,Stage Manager\n";
  const positionActions = [{ teamId, sourceValue: "Stage Manager", action: "create", name: "Stage Manager" }];
  const preview = await previewMemberCsv(context, csv, { destinationTeamId: teamId, positionActions });
  const approvedRows = preview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({
    row, action, recordId: matchedId || undefined, record, expectedStateHash,
  }));
  assert.equal(preview.payload.rows[0].action, "create", JSON.stringify(preview.payload.rows[0]));
  let memberWasPersisted = false;
  let failRosterRead = true;
  setAuthReadObserverForServerTests(({ type, collectionName, id }) => {
    if (type === "getDoc" && collectionName === COLLECTIONS.teamRosterMembers) memberWasPersisted = true;
    if (failRosterRead && memberWasPersisted && type === "getDoc" && collectionName === COLLECTIONS.teams && id === teamId) {
      failRosterRead = false;
      throw new Error("Injected roster read failure");
    }
  });
  let interrupted;
  try {
    interrupted = await callHandler(authHandlers.commitPortableImport, {
      context,
      body: { type: "members", destinationTeamId: teamId, positionActions, previewToken: preview.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: preview.mapping, approvedRows },
    });
  } finally {
    setAuthReadObserverForServerTests(null);
  }
  assert.equal(interrupted.payload.results[0].status, "failed", JSON.stringify(interrupted.payload.results[0]));
  const created = (await queryDocs(COLLECTIONS.teamRosterMembers, [
    { field: "churchId", value: context.churchId },
  ])).find((item) => item.email === "casey.creator@example.com");
  assert.ok(created);
  assert.ok(created._portableCreateKey);
  assert.equal((await queryDocs(COLLECTIONS.teamPositions, [{ field: "teamId", value: teamId }])).filter((item) => item.name === "Stage Manager").length, 1);
  assert.equal((await getDoc(COLLECTIONS.teamPositions, created.positionIds[0])).name, "Stage Manager");
  assert.equal((await getDoc(COLLECTIONS.teams, teamId)).memberIds.includes(created.memberId), false);

  // Simulate an administrator editing the newly created profile and adding a
  // separate team assignment before the import retry runs.
  await setDoc(COLLECTIONS.teamRosterMembers, created.memberId, {
    notes: "Concurrent note", profileImageUrl: "https://example.com/casey.png",
    positionIds: [otherPositions.Camera],
  }, { merge: true });
  await setDoc(COLLECTIONS.teams, otherTeamId, { memberIds: [created.memberId] }, { merge: true });
  const retried = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: { type: "members", destinationTeamId: teamId, positionActions, previewToken: preview.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: preview.mapping, approvedRows },
  });
  assert.equal(retried.payload.results[0].status, "created");
  assert.equal((await queryDocs(COLLECTIONS.teamPositions, [{ field: "teamId", value: teamId }])).filter((item) => item.name === "Stage Manager").length, 1);
  assert.equal((await getDoc(COLLECTIONS.teams, teamId)).memberIds.includes(created.memberId), true);
  assert.equal((await getDoc(COLLECTIONS.teams, otherTeamId)).memberIds.includes(created.memberId), true);
  const afterRetry = await getDoc(COLLECTIONS.teamRosterMembers, created.memberId);
  assert.equal(afterRetry.notes, "Concurrent note");
  assert.equal(afterRetry.profileImageUrl, "https://example.com/casey.png");
  assert.deepEqual(afterRetry.positionIds, [otherPositions.Camera]);

  const repeated = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: { type: "members", destinationTeamId: teamId, positionActions, previewToken: preview.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: preview.mapping, approvedRows },
  });
  assert.equal(repeated.payload.results[0].status, "created");
  assert.equal((await getDoc(COLLECTIONS.teams, otherTeamId)).memberIds.includes(created.memberId), true);
});

test("third-party member CSV categories add selected-team positions without clearing blanks", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("portable_categories_safe_merge");
  const destination = await seedTeam(context, { teamName: "Worship", positions: [{ name: "Keys" }, { name: "Piano" }] });
  const otherTeam = await seedTeam(context, { teamName: "Production", positions: [{ name: "Keys" }] });
  const area = await callHandler(authHandlers.createTeamQualificationArea, { context, body: { teamId: otherTeam.teamId, name: "Audio" } });
  const level = await callHandler(authHandlers.createTeamQualificationLevel, { context, body: { areaId: area.payload.area.areaId, name: "Intermediate", rank: 2 } });
  const existingQualification = { qualificationId: "production-audio-intermediate", teamId: otherTeam.teamId, areaId: area.payload.area.areaId, levelId: level.payload.level.levelId, status: "in_training" };
  const existing = await callHandler(authHandlers.createTeamRosterMember, {
    context,
    body: {
      firstName: "Jane", lastName: "Doe", email: "jane@example.com", phoneNumber: "+15555550123",
      notes: "Keep this note", teamIds: [otherTeam.teamId], positionIds: [otherTeam.positionIds.Keys],
      blockoutDates: [{ startDate: "2026-11-01", endDate: "2026-11-01" }],
      qualifications: [existingQualification],
    },
  });
  await setDoc(COLLECTIONS.teamRosterMembers, existing.payload.member.memberId, { profileImageUrl: "https://example.com/member.png" }, { merge: true });
  const consentId = smsConsentIdForChurchPhone(context.churchId, "+15555550123");
  const consent = { churchId: context.churchId, phoneNumber: "+15555550123", status: "opted_out", optedOutAt: "2026-01-01T00:00:00.000Z" };
  await setDoc(COLLECTIONS.smsConsents, consentId, consent);
  const csv = "First Name,Last Name,Email,Phone,Status,Categories,Skill Tiers,SMS Opt-In,Timezone\nJane,Doe,jane.new@example.com,,Active,Keys; Piano,Intermediate,true,America/Chicago\n";
  const inspected = await callHandler(authHandlers.inspectPortableImport, { context, body: { type: "members", csv } });
  assert.equal(inspected.payload.mapping.positions, "Categories");
  assert.equal(inspected.payload.mapping.status, "Status");
  const preview = await callHandler(authHandlers.previewPortableImport, {
    context,
    body: { type: "members", csv, mapping: inspected.payload.mapping, destinationTeamId: destination.teamId },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.payload.rows[0].action, "update", JSON.stringify({ existing: existing.payload, row: preview.payload.rows[0] }));
  assert.equal(preview.payload.rows[0].expectedStateHash.length, 64);
  assert.equal(preview.payload.rows[0].record.skillTiers, "Intermediate");
  assert.equal(preview.payload.rows[0].issues.some((issue) => issue.code === "missing_reference"), false);
  assert.equal(preview.payload.rows[0].changes.some((change) => change.field === "Email" && change.before === "jane@example.com" && change.after === "jane.new@example.com"), true);
  assert.equal(preview.payload.rows[0].changes.some((change) => change.field === "Team membership" && change.after === "Worship"), true);
  assert.equal(preview.payload.rows[0].changes.some((change) => change.field === "Position" && change.after === "Keys"), true);
  const inactiveCsv = csv.replace(",Active,", ",Inactive,");
  const inactiveInspection = await callHandler(authHandlers.inspectPortableImport, { context, body: { type: "members", csv: inactiveCsv } });
  const inactivePreview = await callHandler(authHandlers.previewPortableImport, {
    context,
    body: { type: "members", csv: inactiveCsv, mapping: inactiveInspection.payload.mapping, destinationTeamId: destination.teamId },
  });
  assert.equal(inactivePreview.payload.rows[0].action, "review");
  assert.equal(inactivePreview.payload.rows[0].issues.some((issue) => issue.code === "source_inactive"), true);
  const imported = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", destinationTeamId: destination.teamId, updateMode: "merge",
      previewToken: preview.payload.previewToken,
      previewCsvHash: hashPortableCsv(csv),
      mapping: inspected.payload.mapping,
      approvedRows: preview.payload.rows.map(({ row, action, matchedId, record, resolutions, expectedStateHash, sourceValues }) => ({
        row, action, recordId: matchedId || undefined, record, resolutions, expectedStateHash, sourceValues,
      })),
    },
  });
  assert.equal(imported.payload.summary.failed, 0);
  assert.equal(imported.payload.summary.updated, 1);
  const saved = await getDoc(COLLECTIONS.teamRosterMembers, existing.payload.member.memberId);
  assert.equal(saved.phoneNumber, "+15555550123");
  assert.equal(saved.email, "jane.new@example.com");
  assert.deepEqual(saved.blockoutDates, [{ startDate: "2026-11-01", endDate: "2026-11-01", notes: "" }]);
  assert.deepEqual(new Set(saved.positionIds), new Set([destination.positionIds.Keys, destination.positionIds.Piano, otherTeam.positionIds.Keys]));
  const teams = await Promise.all([destination.teamId, otherTeam.teamId].map((teamId) => getDoc(COLLECTIONS.teams, teamId)));
  assert.equal(teams.every((team) => team.memberIds.includes(saved.memberId)), true);
  assert.deepEqual(saved.qualifications, existing.payload.member.qualifications);
  assert.equal(saved.profileImageUrl, "https://example.com/member.png");
  const savedConsent = await getDoc(COLLECTIONS.smsConsents, consentId);
  assert.equal(savedConsent.status, consent.status);
  assert.equal(savedConsent.optedOutAt, consent.optedOutAt);
  assert.equal(Object.hasOwn(saved, "timezone"), false);

  const repeatedPreview = await callHandler(authHandlers.previewPortableImport, {
    context,
    body: { type: "members", csv, mapping: inspected.payload.mapping, destinationTeamId: destination.teamId },
  });
  const repeated = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", destinationTeamId: destination.teamId,
      previewToken: repeatedPreview.payload.previewToken,
      previewCsvHash: hashPortableCsv(csv),
      mapping: inspected.payload.mapping,
      approvedRows: repeatedPreview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash, sourceValues }) => ({
        row, action, recordId: matchedId || undefined, record, expectedStateHash, sourceValues,
      })),
    },
  });
  assert.equal(repeated.payload.summary.unchanged, 1);

  const replaceCsv = csv.replace("Keys; Piano", "Keys");
  const replacePreview = await callHandler(authHandlers.previewPortableImport, {
    context,
    body: { type: "members", csv: replaceCsv, mapping: inspected.payload.mapping, destinationTeamId: destination.teamId, updateMode: "replace" },
  });
  assert.equal(replacePreview.payload.rows[0].changes.some((change) => change.field === "Position" && change.before === "Piano" && change.after === ""), true);
  const replaceResult = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", destinationTeamId: destination.teamId, updateMode: "replace",
      previewToken: replacePreview.payload.previewToken,
      previewCsvHash: hashPortableCsv(replaceCsv),
      mapping: inspected.payload.mapping,
      approvedRows: replacePreview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash })),
    },
  });
  assert.equal(replaceResult.payload.summary.updated, 1);
  const replacedMember = await getDoc(COLLECTIONS.teamRosterMembers, existing.payload.member.memberId);
  assert.deepEqual(new Set(replacedMember.positionIds), new Set([destination.positionIds.Keys, otherTeam.positionIds.Keys]));
  assert.equal((await getDoc(COLLECTIONS.teams, otherTeam.teamId)).memberIds.includes(replacedMember.memberId), true);

  const stalePreview = await callHandler(authHandlers.previewPortableImport, {
    context,
    body: { type: "members", csv, mapping: inspected.payload.mapping, destinationTeamId: destination.teamId },
  });
  await setDoc(COLLECTIONS.teamRosterMembers, saved.memberId, { notes: "Concurrent edit" }, { merge: true });
  const staleCommit = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", destinationTeamId: destination.teamId,
      previewToken: stalePreview.payload.previewToken,
      previewCsvHash: hashPortableCsv(csv),
      mapping: inspected.payload.mapping,
      approvedRows: stalePreview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash })),
    },
  });
  assert.equal(staleCommit.payload.results[0].code, "stale_preview");
  assert.equal((await getDoc(COLLECTIONS.teamRosterMembers, saved.memberId)).notes, "Concurrent edit");
});

test("portable member import explicitly creates one missing team position and safely reuses it on retry", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_member_position_resolution");
  const team = await seedTeam(context, { teamName: "New Test Team" });
  const csv = "First Name,Last Name,Positions\nJules,CSVTest,Video Director\nKai,CSVTest,Video Director\n";
  const initial = await previewMemberCsv(context, csv, { destinationTeamId: team.teamId });
  assert.equal(initial.payload.rows.every((row) => row.action === "review"), true);
  assert.equal((await queryDocs(COLLECTIONS.teamPositions, [{ field: "teamId", value: team.teamId }])).length, 0);
  const issue = initial.payload.rows[0].issues.find((item) => item.field === "positions");
  assert.equal(issue.code, "missing_reference");
  assert.equal(issue.teamId, team.teamId);
  const positionActions = [{ teamId: team.teamId, sourceValue: "Video Director", action: "create", name: "Video Director" }];
  const reviewed = await previewMemberCsv(context, csv, { destinationTeamId: team.teamId, positionActions });
  assert.equal(reviewed.payload.rows.every((row) => !row.issues.some((item) => item.field === "positions")), true);
  const approvedRows = reviewed.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({
    row, action, recordId: matchedId || undefined, record, expectedStateHash,
  }));
  const commitBody = {
    type: "members", destinationTeamId: team.teamId, positionActions,
    previewToken: reviewed.payload.previewToken, previewCsvHash: hashPortableCsv(csv),
    mapping: reviewed.mapping, approvedRows,
  };
  const [committed, concurrentCommit] = await Promise.all([
    callHandler(authHandlers.commitPortableImport, { context, body: commitBody }),
    callHandler(authHandlers.commitPortableImport, { context, body: commitBody }),
  ]);
  assert.equal(committed.payload.summary.created, 2);
  assert.equal(concurrentCommit.payload.summary.created, 2);
  assert.equal(committed.payload.summary.positionsCreated, 1);
  assert.equal(concurrentCommit.payload.summary.positionsCreated, 1);
  assert.deepEqual(concurrentCommit.payload.results.map((result) => result.id), committed.payload.results.map((result) => result.id));
  const firstMember = await getDoc(COLLECTIONS.teamRosterMembers, committed.payload.results[0].id);
  assert.equal(firstMember.positionIds.length, 1);
  const positionId = firstMember.positionIds[0];
  assert.equal((await getDoc(COLLECTIONS.teamPositions, positionId)).name, "Video Director");
  const [retry, concurrentRetry] = await Promise.all([
    callHandler(authHandlers.commitPortableImport, { context, body: commitBody }),
    callHandler(authHandlers.commitPortableImport, { context, body: commitBody }),
  ]);
  assert.equal(retry.payload.summary.positionsCreated, 1);
  assert.equal(concurrentRetry.payload.summary.positionsCreated, 1);
  assert.equal(retry.payload.results.length, 2);
  assert.equal((await getDoc(COLLECTIONS.teamRosterMembers, committed.payload.results[0].id)).positionIds[0], positionId);
  assert.equal((await queryDocs(COLLECTIONS.teamPositions, [{ field: "churchId", value: context.churchId }])).filter((item) => item.name === "Video Director").length, 1);
});

test("portable member position resolution supports explicit matches and ignores without Replace removals", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_member_position_match_ignore");
  const team = await seedTeam(context, { teamName: "Production", positions: [{ name: "Camera Operator" }], members: [{ firstName: "Jane", lastName: "Doe", positions: ["Camera Operator"] }] });
  const cameraId = team.positionIds["Camera Operator"];
  const matchedCsv = "First Name,Last Name,Positions\nAlex,Match,Camera Ops";
  const matchedInitial = await previewMemberCsv(context, matchedCsv, { destinationTeamId: team.teamId });
  const matchAction = [{ teamId: team.teamId, sourceValue: "Camera Ops", action: "match", positionId: cameraId, name: "Camera Operator" }];
  const matchedPreview = await previewMemberCsv(context, matchedCsv, { destinationTeamId: team.teamId, positionActions: matchAction });
  const modifiedPlan = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", destinationTeamId: team.teamId,
      positionActions: [{ teamId: team.teamId, sourceValue: "Camera Ops", action: "ignore" }],
      previewToken: matchedPreview.payload.previewToken, previewCsvHash: hashPortableCsv(matchedCsv), mapping: matchedPreview.mapping,
      approvedRows: matchedPreview.payload.rows.map(({ row, action, record }) => ({ row, action, record })),
    },
  });
  assert.equal(modifiedPlan.statusCode, 409);
  const matched = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", destinationTeamId: team.teamId, positionActions: matchAction,
      previewToken: matchedPreview.payload.previewToken, previewCsvHash: hashPortableCsv(matchedCsv), mapping: matchedPreview.mapping,
      approvedRows: matchedPreview.payload.rows.map(({ row, action, record }) => ({ row, action, record })),
    },
  });
  assert.equal(matched.payload.summary.created, 1);
  assert.deepEqual((await getDoc(COLLECTIONS.teamRosterMembers, matched.payload.results[0].id)).positionIds, [cameraId]);
  assert.equal(matchedInitial.payload.rows[0].action, "review");

  const ignoredCsv = "First Name,Last Name,Positions\nKai,NoRole,Sound Lead";
  const ignoreAction = [{ teamId: team.teamId, sourceValue: "Sound Lead", action: "ignore" }];
  const ignoredPreview = await previewMemberCsv(context, ignoredCsv, { destinationTeamId: team.teamId, positionActions: ignoreAction });
  const ignored = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", destinationTeamId: team.teamId, positionActions: ignoreAction,
      previewToken: ignoredPreview.payload.previewToken, previewCsvHash: hashPortableCsv(ignoredCsv), mapping: ignoredPreview.mapping,
      approvedRows: ignoredPreview.payload.rows.map(({ row, action, record }) => ({ row, action, record })),
    },
  });
  const ignoredMember = await getDoc(COLLECTIONS.teamRosterMembers, ignored.payload.results[0].id);
  assert.deepEqual(ignoredMember.positionIds, []);
  assert.equal((await getDoc(COLLECTIONS.teams, team.teamId)).memberIds.includes(ignoredMember.memberId), true);

  const replaceCsv = `First Name,Last Name,Positions,WorshipSync Member ID\nJane,Doe,Unknown Role,${team.memberIds.Jane}`;
  const replaceAction = [{ teamId: team.teamId, sourceValue: "Unknown Role", action: "ignore" }];
  const replacePreview = await previewMemberCsv(context, replaceCsv, { destinationTeamId: team.teamId, updateMode: "replace", positionActions: replaceAction });
  assert.equal(replacePreview.payload.rows[0].changes.some((change) => change.field === "Position" && change.before && !change.after), false);
  await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", destinationTeamId: team.teamId, updateMode: "replace", positionActions: replaceAction,
      previewToken: replacePreview.payload.previewToken, previewCsvHash: hashPortableCsv(replaceCsv), mapping: replacePreview.mapping,
      approvedRows: replacePreview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash })),
    },
  });
  assert.deepEqual((await getDoc(COLLECTIONS.teamRosterMembers, team.memberIds.Jane)).positionIds, [cameraId]);
});

test("portable member import requires an owner when a position name appears in several imported teams", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_member_position_team_scopes");
  const production = await seedTeam(context, { teamName: "Production", positions: [{ name: "Stage Manager" }] });
  const media = await seedTeam(context, { teamName: "Media", positions: [{ name: "Stage Manager" }] });
  const csv = "First Name,Last Name,Teams,Positions\nMorgan,Scope,Production | Media,Stage Manager\n";
  const initial = await previewMemberCsv(context, csv);
  const issue = initial.payload.rows[0].issues.find((item) => item.field === "positions");
  assert.equal(issue.code, "ambiguous_reference");
  assert.equal(issue.teamId, undefined);
  assert.deepEqual(new Set(issue.teamOptions.map((option) => option.teamId)), new Set([production.teamId, media.teamId]));
  const positionActions = [{ teamId: production.teamId, sourceValue: "Stage Manager", action: "match", positionId: production.positionIds["Stage Manager"], name: "Stage Manager" }];
  const preview = await previewMemberCsv(context, csv, { positionActions });
  assert.equal(preview.payload.rows[0].issues.some((item) => item.field === "positions"), false);
  const committed = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", positionActions, previewToken: preview.payload.previewToken,
      previewCsvHash: hashPortableCsv(csv), mapping: preview.mapping,
      approvedRows: preview.payload.rows.map(({ row, action, record }) => ({ row, action, record })),
    },
  });
  const member = await getDoc(COLLECTIONS.teamRosterMembers, committed.payload.results[0].id);
  assert.equal(member.positionIds.length, 1);
  const savedPositions = await Promise.all(member.positionIds.map((positionId) => getDoc(COLLECTIONS.teamPositions, positionId)));
  assert.deepEqual(new Set(savedPositions.map((position) => position.teamId)), new Set([production.teamId]));
});

test("portable member import creates approved teams and positions once across retries", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_member_team_create_retry");
  const csv = [
    "First Name,Last Name,Title,Email,Phone,Teams,Positions,Notes,Serving Frequency,Archived,WorshipSync Member ID,WorshipSync Team IDs,WorshipSync Position IDs",
    "Emery,CSVTest,,,,CSV Test Media,Camera Operator,,,,,,",
    "Finley,CSVTest,,,,CSV Test Media,Camera Operator,,,,,,",
  ].join("\n");
  const teamActions = [{ sourceValue: "CSV Test Media", action: "create", name: "New Test Team" }];
  const firstReview = await previewMemberCsv(context, csv);
  assert.equal(firstReview.payload.rows[0].issues.some((issue) => issue.field === "teams"), true);
  const pendingTeamId = `portable-pending-team-${createHash("sha256").update(`${hashPortableCsv(csv)}\u0000csv test media`).digest("hex").slice(0, 32)}`;
  const positionActions = [{ teamId: pendingTeamId, sourceValue: "Camera Operator", action: "create", name: "Camera Operator" }];
  const reviewed = await previewMemberCsv(context, csv, { teamActions, positionActions });
  assert.equal(reviewed.payload.rows.every((row) => row.issues.length === 0), true, JSON.stringify(reviewed.payload.rows));
  const approvedRows = reviewed.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({
    row, action, recordId: matchedId || undefined, record, expectedStateHash,
  }));
  const body = {
    type: "members", teamActions, positionActions,
    previewToken: reviewed.payload.previewToken, previewCsvHash: hashPortableCsv(csv),
    mapping: reviewed.mapping, approvedRows,
  };
  const alteredPlan = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: { ...body, teamActions: [{ ...teamActions[0], name: "Altered Team" }] },
  });
  assert.equal(alteredPlan.statusCode, 409);
  const [committed, concurrent] = await Promise.all([
    callHandler(authHandlers.commitPortableImport, { context, body }),
    callHandler(authHandlers.commitPortableImport, { context, body }),
  ]);
  assert.equal(committed.payload.summary.created, 2, JSON.stringify(committed.payload));
  assert.equal(committed.payload.summary.teamsCreated, 1);
  assert.equal(committed.payload.summary.positionsCreated, 1);
  assert.equal(concurrent.payload.summary.teamsCreated, 1);
  assert.equal(concurrent.payload.summary.positionsCreated, 1);
  const repeated = await callHandler(authHandlers.commitPortableImport, { context, body });
  assert.equal(repeated.payload.summary.teamsCreated, 1);
  assert.equal(repeated.payload.summary.positionsCreated, 1);
  const teams = await queryDocs(COLLECTIONS.teams, [{ field: "churchId", value: context.churchId }]);
  const createdTeam = teams.find((team) => team.name === "New Test Team");
  assert.ok(createdTeam);
  assert.equal(teams.filter((team) => team.name === "New Test Team").length, 1);
  const positions = await queryDocs(COLLECTIONS.teamPositions, [{ field: "teamId", value: createdTeam.teamId }]);
  assert.equal(positions.filter((position) => position.name === "Camera Operator").length, 1);
  assert.equal(committed.payload.results.every((result) => result.status === "created"), true);
});

test("portable member import assigns positions to explicitly selected planned teams", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_member_multiple_planned_teams");
  const csv = [
    "First Name,Last Name,Teams,Positions",
    "Emery,CSVTest,CSV Test Media | CSV Test Worship,Camera Operator | Vocals",
  ].join("\n");
  const teamActions = [
    { sourceValue: "CSV Test Media", action: "create", name: "CSV Test Media" },
    { sourceValue: "CSV Test Worship", action: "create", name: "CSV Test Worship" },
  ];
  const pendingId = (sourceValue) => `portable-pending-team-${createHash("sha256").update(`${hashPortableCsv(csv)}\u0000${sourceValue.toLocaleLowerCase()}`).digest("hex").slice(0, 32)}`;
  const reviewedTeams = await previewMemberCsv(context, csv, { teamActions });
  const ownershipIssues = reviewedTeams.payload.rows[0].issues.filter((issue) => issue.field === "positions");
  assert.equal(ownershipIssues.length, 2);
  assert.equal(ownershipIssues.every((issue) => issue.teamOptions?.length === 2), true);
  const positionActions = [
    { teamId: pendingId("CSV Test Media"), sourceValue: "Camera Operator", action: "create", name: "Camera Operator" },
    { teamId: pendingId("CSV Test Worship"), sourceValue: "Vocals", action: "create", name: "Vocals" },
  ];
  const reviewed = await previewMemberCsv(context, csv, { teamActions, positionActions });
  assert.deepEqual(reviewed.payload.rows[0].issues, []);
  const committed = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", teamActions, positionActions,
      previewToken: reviewed.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: reviewed.mapping,
      approvedRows: reviewed.payload.rows.map(({ row, action, record }) => ({ row, action, record })),
    },
  });
  assert.equal(committed.payload.summary.created, 1, JSON.stringify(committed.payload));
  assert.equal(committed.payload.summary.teamsCreated, 2);
  assert.equal(committed.payload.summary.positionsCreated, 2);
  const teams = await queryDocs(COLLECTIONS.teams, [{ field: "churchId", value: context.churchId }]);
  const media = teams.find((team) => team.name === "CSV Test Media");
  const worship = teams.find((team) => team.name === "CSV Test Worship");
  assert.ok(media && worship);
  const member = await getDoc(COLLECTIONS.teamRosterMembers, committed.payload.results[0].id);
  const positions = await Promise.all(member.positionIds.map((id) => getDoc(COLLECTIONS.teamPositions, id)));
  assert.deepEqual(new Set(positions.map((position) => `${position.teamId}:${position.name}`)), new Set([
    `${media.teamId}:Camera Operator`, `${worship.teamId}:Vocals`,
  ]));
});

test("blank native WorshipSync relationship ID columns retain destination-team fallback", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_member_blank_relationship_ids");
  const team = await seedTeam(context, { teamName: "Worship", positions: [{ name: "Keys" }] });
  const csv = "First Name,Last Name,Title,Email,Phone,Teams,Positions,Notes,Serving Frequency,Archived,WorshipSync Member ID,WorshipSync Team IDs,WorshipSync Position IDs\nRiley,Blank IDs,,,,,,,,,,,\n";
  const preview = await previewMemberCsv(context, csv, { destinationTeamId: team.teamId });
  assert.equal(preview.payload.rows[0].issues.some((issue) => issue.field === "team" || issue.field === "teams" || issue.field === "positions"), false, JSON.stringify(preview.payload.rows[0]));
  const committed = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", destinationTeamId: team.teamId,
      previewToken: preview.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: preview.mapping,
      approvedRows: preview.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash })),
    },
  });
  assert.equal(committed.payload.results[0].status, "created", JSON.stringify(committed.payload));
  const member = await getDoc(COLLECTIONS.teamRosterMembers, committed.payload.results[0].id);
  assert.equal((await getDoc(COLLECTIONS.teams, team.teamId)).memberIds.includes(member.memberId), true);
});

test("foreign native team and position IDs require explicit local mappings", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_member_foreign_relationship_ids");
  const local = await seedTeam(context, { teamName: "Local Media", positions: [{ name: "Camera Operator" }] });
  const csv = "First Name,Last Name,Title,Email,Phone,Teams,Positions,Notes,Serving Frequency,Archived,WorshipSync Member ID,WorshipSync Team IDs,WorshipSync Position IDs\nEmery,Foreign,,,,CSV Test Media,Camera Operator,,,,,foreign-team-id,foreign-position-id\n";
  const initial = await previewMemberCsv(context, csv);
  const teamIssue = initial.payload.rows[0].issues.find((issue) => issue.field === "teams");
  assert.equal(teamIssue.code, "foreign_or_unknown_reference_id");
  const teamActions = [{ sourceValue: "CSV Test Media", action: "match", teamId: local.teamId }];
  const teamReviewed = await previewMemberCsv(context, csv, { teamActions });
  const positionIssue = teamReviewed.payload.rows[0].issues.find((issue) => issue.field === "positions");
  assert.equal(positionIssue.code, "foreign_or_unknown_reference_id");
  assert.equal(positionIssue.teamId, local.teamId);
  const positionActions = [{ teamId: local.teamId, sourceValue: "Camera Operator", action: "match", positionId: local.positionIds["Camera Operator"], name: "Camera Operator" }];
  const reviewed = await previewMemberCsv(context, csv, { teamActions, positionActions });
  assert.equal(reviewed.payload.rows[0].issues.length, 0);
  const committed = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", teamActions, positionActions,
      previewToken: reviewed.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: reviewed.mapping,
      approvedRows: reviewed.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash })),
    },
  });
  assert.equal(committed.payload.results[0].status, "created", JSON.stringify(committed.payload));
  const member = await getDoc(COLLECTIONS.teamRosterMembers, committed.payload.results[0].id);
  assert.deepEqual(member.positionIds, [local.positionIds["Camera Operator"]]);
  assert.equal((await getDoc(COLLECTIONS.teams, local.teamId)).memberIds.includes(member.memberId), true);
});

test("ignoring source teams preserves existing assignments in Replace mode", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_member_ignore_team_replace");
  const existing = await seedTeam(context, {
    teamName: "Legacy Team",
    positions: [{ name: "Legacy Position" }],
    members: [{ firstName: "Jane", lastName: "Doe", positions: ["Legacy Position"] }],
  });
  const csv = `First Name,Last Name,Teams,Positions,WorshipSync Member ID\nJane,Doe,CSV Test Media,Legacy Position,${existing.memberIds.Jane}\n`;
  const teamActions = [{ sourceValue: "CSV Test Media", action: "ignore" }];
  const reviewed = await previewMemberCsv(context, csv, { updateMode: "replace", teamActions });
  assert.equal(reviewed.payload.rows[0].issues.some((issue) => issue.field === "positions" || issue.field === "teams"), false);
  assert.equal(reviewed.payload.rows[0].changes.some((change) => change.field === "Position" && change.before && !change.after), false);
  const committed = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", updateMode: "replace", teamActions,
      previewToken: reviewed.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: reviewed.mapping,
      approvedRows: reviewed.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash })),
    },
  });
  assert.equal(committed.payload.results[0].status === "updated" || committed.payload.results[0].status === "unchanged", true, JSON.stringify(committed.payload));
  const saved = await getDoc(COLLECTIONS.teamRosterMembers, existing.memberIds.Jane);
  assert.deepEqual(saved.positionIds, [existing.positionIds["Legacy Position"]]);
  assert.equal((await getDoc(COLLECTIONS.teams, existing.teamId)).memberIds.includes(saved.memberId), true);
});

test("position ownership review keeps ignored multi-team assignments out of retained teams", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_member_ignore_team_position_scope");
  const production = await seedTeam(context, { teamName: "Production", positions: [{ name: "Camera Operator" }] });
  await seedTeam(context, { teamName: "Media" });
  const csv = "First Name,Last Name,Teams,Positions\nMorgan,Ignored,Production | Media,Camera Operator\n";
  const teamActions = [{ sourceValue: "Media", action: "ignore" }];
  const initial = await previewMemberCsv(context, csv, { teamActions });
  const issue = initial.payload.rows[0].issues.find((item) => item.field === "positions");
  assert.equal(issue.code, "ambiguous_reference");
  assert.deepEqual(new Set(issue.teamOptions.map((option) => option.name)), new Set(["Production", "Media"]));
  const ignoredTeamId = `portable-ignored-team-${createHash("sha256").update("media").digest("hex").slice(0, 32)}`;
  const positionActions = [{ teamId: ignoredTeamId, sourceValue: "Camera Operator", action: "ignore" }];
  const reviewed = await previewMemberCsv(context, csv, { teamActions, positionActions });
  assert.equal(reviewed.payload.rows[0].issues.some((item) => item.field === "positions"), false);
  const committed = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", teamActions, positionActions,
      previewToken: reviewed.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: reviewed.mapping,
      approvedRows: reviewed.payload.rows.map(({ row, action, matchedId, record, expectedStateHash }) => ({ row, action, recordId: matchedId || undefined, record, expectedStateHash })),
    },
  });
  assert.equal(committed.payload.results[0].status, "created", JSON.stringify(committed.payload));
  const member = await getDoc(COLLECTIONS.teamRosterMembers, committed.payload.results[0].id);
  assert.deepEqual(member.positionIds, []);
  assert.equal((await getDoc(COLLECTIONS.teams, production.teamId)).memberIds.includes(member.memberId), true);
});

test("portable member import reuses a matching position created after its signed review", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("data_transfer_member_position_concurrent_admin");
  const team = await seedTeam(context, { teamName: "Production" });
  const csv = "First Name,Last Name,Positions\nTaylor,Concurrent,Video Director\n";
  const positionActions = [{ teamId: team.teamId, sourceValue: "Video Director", action: "create", name: "Video Director" }];
  const reviewed = await previewMemberCsv(context, csv, { destinationTeamId: team.teamId, positionActions });
  const secondAdmin = await createHumanContext("position_created_by_second_admin", {
    churchId: context.churchId,
    userId: "teams_api_second_position_admin",
    email: "second-position-admin@example.com",
  });
  const concurrentlyCreated = await callHandler(authHandlers.createTeamPosition, {
    context: secondAdmin,
    body: { teamId: team.teamId, name: "Video Director" },
  });
  const committed = await callHandler(authHandlers.commitPortableImport, {
    context,
    body: {
      type: "members", destinationTeamId: team.teamId, positionActions,
      previewToken: reviewed.payload.previewToken, previewCsvHash: hashPortableCsv(csv), mapping: reviewed.mapping,
      approvedRows: reviewed.payload.rows.map(({ row, action, record }) => ({ row, action, record })),
    },
  });
  const member = await getDoc(COLLECTIONS.teamRosterMembers, committed.payload.results[0].id);
  assert.deepEqual(member.positionIds, [concurrentlyCreated.payload.position.positionId]);
  assert.equal(committed.payload.summary.positionsCreated, 0);
  assert.equal((await queryDocs(COLLECTIONS.teamPositions, [{ field: "teamId", value: team.teamId }])).length, 1);
});
