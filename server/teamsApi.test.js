process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
// Force the in-memory auth store so this integration suite runs in every
// environment. Locally a developer's .env Firebase credentials would otherwise
// flip canSeedHumanBearerAuthForServerTests() to false and skip every test. We
// set the vars to empty (not delete) so the `import "dotenv/config"` inside
// authService.js cannot repopulate them from .env.
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";

import {
  addTeamsSseClient,
  removeTeamsSseClient,
} from "../server/teamsSse.js";

const {
  authHandlers,
  canSeedHumanBearerAuthForServerTests,
  seedActiveHumanBearerForServerTests,
} = await import("../authService.js");

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
} = {}) => ({
  params,
  headers,
  session,
  body,
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
    clearCookie() {
      return this;
    },
  };
  return res;
};

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

const callHandler = async (handler, { context, params = {}, body = {} }) => {
  const res = createRes();
  await handler(
    createReq({
      params: { churchId: context.churchId, ...params },
      headers: context.headers,
      session: context.session,
      body,
    }),
    res,
  );
  return res;
};

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
    ],
  });
  const vocalId = positionIds.Vocal;
  const keysId = positionIds.Keys;
  const availableId = memberIds.Avery;
  const unavailableId = memberIds.Morgan;

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

  // Subscribe only after creating the schedule so we observe just the
  // assignment broadcast, not the create one.
  const sseClient = createSseClient();
  addTeamsSseClient(context.churchId, sseClient);
  t.after(() => removeTeamsSseClient(context.churchId, sseClient));

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

test("team schedules persist private attendance records", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("attendance");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Hospitality",
    positions: [{ name: "Greeter", icon: "handshake" }],
    members: [
      { firstName: "Jordan", lastName: "Pace", positions: ["Greeter"] },
    ],
  });
  const greeterId = positionIds.Greeter;
  const jordanId = memberIds.Jordan;
  const serviceId = "service-sunday";
  const occurrenceId = "service-sunday@2026-07-19T10:00:00.000Z";

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
          startsAt: "2026-07-19T10:00:00.000Z",
        },
      ],
      attendance: {
        [occurrenceId]: {
          [jordanId]: {
            status: "absent",
            columnKey: `${greeterId}::0`,
            positionId: greeterId,
            positionLabel: "Greeter",
            extra: "ignored",
          },
          "not-on-team": { status: "present" },
        },
        "not-in-schedule": {
          [jordanId]: { status: "present" },
        },
      },
    },
  });

  assert.equal(schedule.statusCode, 200);
  assert.deepEqual(schedule.payload.schedule.attendance, {
    [occurrenceId]: {
      [jordanId]: {
        status: "absent",
        columnKey: `${greeterId}::0`,
        positionId: greeterId,
        positionLabel: "Greeter",
      },
    },
  });
});

test("dedicated attendance endpoint patches one cell without clobbering assignments", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("attendance_patch");

  const { teamId, positionIds, memberIds } = await seedTeam(context, {
    teamName: "Hospitality",
    positions: [{ name: "Greeter", icon: "handshake" }],
    members: [
      { firstName: "Jordan", lastName: "Pace", positions: ["Greeter"] },
      { firstName: "Sam", lastName: "Vale", positions: ["Greeter"] },
    ],
  });
  const greeterId = positionIds.Greeter;
  const jordanId = memberIds.Jordan;
  const samId = memberIds.Sam;
  const serviceId = "service-sunday";
  const occurrenceId = "service-sunday@2026-07-19T10:00:00.000Z";

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
          startsAt: "2026-07-19T10:00:00.000Z",
        },
      ],
    },
  });
  const scheduleId = schedule.payload.schedule.scheduleId;

  // Assign Jordan to the greeter slot — this must survive an attendance patch.
  await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${greeterId}::0`,
      memberId: jordanId,
      serviceDate: "2026-07-19",
    },
  });

  // Mark present via the dedicated endpoint.
  const marked = await callHandler(authHandlers.updateTeamScheduleAttendance, {
    context,
    params: { scheduleId },
    body: {
      occurrenceId,
      memberId: jordanId,
      status: "present",
      columnKey: `${greeterId}::0`,
      positionId: greeterId,
      positionLabel: "Greeter",
    },
  });
  assert.equal(marked.statusCode, 200);
  assert.equal(
    marked.payload.schedule.attendance?.[occurrenceId]?.[jordanId]?.status,
    "present",
  );
  // The assignment made before the attendance patch is untouched.
  assert.equal(
    getMemberId(
      marked.payload.schedule.assignments?.[occurrenceId]?.[`${greeterId}::0`],
    ),
    jordanId,
  );

  // Clearing the mark (empty status) removes the entry, and empties the row.
  const cleared = await callHandler(authHandlers.updateTeamScheduleAttendance, {
    context,
    params: { scheduleId },
    body: { occurrenceId, memberId: jordanId, status: "" },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.payload.schedule.attendance?.[occurrenceId], undefined);

  // An occurrence not on the schedule is rejected.
  const badOccurrence = await callHandler(
    authHandlers.updateTeamScheduleAttendance,
    {
      context,
      params: { scheduleId },
      body: {
        occurrenceId: "service-sunday@2099-01-01T10:00:00.000Z",
        memberId: jordanId,
        status: "present",
      },
    },
  );
  assert.equal(badOccurrence.statusCode, 404);

  // A member who is not on the team is rejected, even if they exist nowhere.
  const offTeam = await callHandler(authHandlers.updateTeamScheduleAttendance, {
    context,
    params: { scheduleId },
    body: { occurrenceId, memberId: "teamMember_ghost", status: "present" },
  });
  assert.equal(offTeam.statusCode, 400);

  // Sanity: Sam is on the team, so patching for Sam works.
  const samMarked = await callHandler(
    authHandlers.updateTeamScheduleAttendance,
    {
      context,
      params: { scheduleId },
      body: { occurrenceId, memberId: samId, status: "absent" },
    },
  );
  assert.equal(samMarked.statusCode, 200);
  assert.equal(
    samMarked.payload.schedule.attendance?.[occurrenceId]?.[samId]?.status,
    "absent",
  );
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
  assert.equal(publicRes.payload.teamName, "Production");
  assert.equal(
    publicRes.payload.schedule.assignments[occurrenceId][`${directorId}::0`]
      .primaryMemberId,
    kevinId,
  );

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
  assert.equal(form.payload.form.welcomeMessage, "Welcome to Worship sign-ups!");
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
        positionIds: [positionId],
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);

  const bootstrapBeforeApply = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const submission = bootstrapBeforeApply.payload.intakeSubmissions.find(
    (item) => item.firstName === "Pat",
  );
  assert.ok(submission?.submissionId);

  const applyRes = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submission.submissionId },
    body: { action: "applied", createMember: true },
  });
  assert.equal(applyRes.statusCode, 200);
  assert.ok(applyRes.payload.member?.memberId);

  // Intake positions record desire only; applying must NOT grant scheduling
  // eligibility. The new member is assignable to nothing until an admin
  // promotes a desired position into positionIds.
  assert.deepEqual(applyRes.payload.member.positionIds, []);
  assert.deepEqual(applyRes.payload.member.desiredPositionIds, [positionId]);

  const bootstrapAfterApply = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
  const team = bootstrapAfterApply.payload.teams.find(
    (item) => item.teamId === worship.teamId,
  );
  // Team visibility is still added so the admin can find and promote them.
  assert.ok(team.memberIds.includes(applyRes.payload.member.memberId));
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
        positionIds: [keysId],
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);

  const bootstrapBeforeApply = await callHandler(authHandlers.getTeamsBootstrap, {
    context,
  });
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
        positionIds: [worship.positionIds.Vocal],
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, { context });
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

test("linking intake merges overlapping blockout dates instead of duplicating", async (t) => {
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
          { startDate: "2026-06-22", endDate: "2026-06-27", notes: "Vacation" },
        ],
      },
    ],
  });
  const memberId = worship.memberIds.Sam;

  const form = await callHandler(authHandlers.createTeamIntakeForm, {
    context,
    body: {
      name: "Fall volunteers",
      startDate: "2026-06-01",
      endDate: "2026-06-30",
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
        positionIds: [worship.positionIds.Vocal],
        // A single day already inside the member's existing range, plus a
        // duplicate of that range — both should collapse into one entry.
        blockoutRanges: [
          { startDate: "2026-06-23", endDate: "2026-06-23" },
          { startDate: "2026-06-22", endDate: "2026-06-27" },
        ],
      },
    },
    submitRes,
  );
  assert.equal(submitRes.statusCode, 200);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, { context });
  const submission = bootstrap.payload.intakeSubmissions.find(
    (item) => item.firstName === "Sam",
  );

  const applyRes = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submission.submissionId },
    body: { action: "applied", memberId },
  });
  assert.equal(applyRes.statusCode, 200);

  // The single date and the duplicate range are all covered by 6/22–6/27, so
  // the member keeps exactly one blockout entry with both notes preserved.
  assert.equal(applyRes.payload.member.blockoutDates.length, 1);
  const [range] = applyRes.payload.member.blockoutDates;
  assert.equal(range.startDate, "2026-06-22");
  assert.equal(range.endDate, "2026-06-27");
  assert.match(range.notes, /Vacation/);
  assert.match(range.notes, /From intake form/);

  // Re-applying the same submission must not stack duplicate notes or entries.
  const reapply = await callHandler(authHandlers.updateTeamIntakeSubmission, {
    context,
    params: { submissionId: submission.submissionId },
    body: { action: "applied", memberId },
  });
  assert.equal(reapply.statusCode, 200);
  assert.equal(reapply.payload.member.blockoutDates.length, 1);
  assert.equal(
    reapply.payload.member.blockoutDates[0].notes.match(/From intake form/g)
      .length,
    1,
  );
});

test("intake service availability becomes a hard scheduling constraint", async (t) => {
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

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, { context });
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

  // Assigning the member to the occurrence they said they can't make is blocked.
  const blocked = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: unavailableOccurrenceId,
      positionSlotKey: `${vocalId}::0`,
      memberId,
      serviceDate: "2026-06-14",
    },
  });
  assert.equal(blocked.statusCode, 400);
  assert.match(blocked.payload.errorMessage, /unavailable for this service/i);

  // The occurrence they marked available is fine.
  const allowed = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: availableOccurrenceId,
      positionSlotKey: `${vocalId}::0`,
      memberId,
      serviceDate: "2026-06-07",
    },
  });
  assert.equal(allowed.statusCode, 200);
});
