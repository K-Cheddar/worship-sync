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

import { addTeamsSseClient, removeTeamsSseClient } from "../server/teamsSse.js";
import {
  addServiceFlowSseClient,
  removeServiceFlowSseClient,
} from "../server/serviceFlowSse.js";

const {
  authHandlers,
  canSeedHumanBearerAuthForServerTests,
  seedActiveHumanBearerForServerTests,
  seedChurchServiceTimesForServerTests,
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
  const { teamId, positionIds } = await seedTeam(context, {
    teamName: "Production",
    positions: [{ name: "Camera" }, { name: "Slides" }],
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

  const assigned = await callHandler(authHandlers.updateTeamScheduleAssignment, {
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
  });
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

  const duplicate = await callHandler(authHandlers.updateTeamScheduleAssignment, {
    context,
    params: { scheduleId },
    body: {
      serviceId: occurrenceId,
      positionSlotKey: `${positionIds.Slides}::0`,
      memberId: guest.guestId,
      serviceDate: "2026-08-16",
    },
  });
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
  assert.equal(JSON.stringify(publicSchedule.payload).includes("jordan@example.com"), false);
  assert.equal(JSON.stringify(publicSchedule.payload).includes("555-0100"), false);
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
        allowCrossTeamConflict: true,
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

  const copiedScheduleConfirmed = await callHandler(
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
  assert.equal(copiedScheduleConfirmed.statusCode, 200);
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
        allowOccurrenceConflict: true,
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

  const slotOne = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${cameraId}::1`,
        memberId: memberIds.Ben,
        serviceDate: "2026-08-09",
      },
    },
  );
  assert.equal(slotOne.statusCode, 200);

  const slotTwo = await callHandler(
    authHandlers.updateTeamScheduleAssignment,
    {
      context,
      params: { scheduleId },
      body: {
        serviceId: occurrenceId,
        positionSlotKey: `${cameraId}::2`,
        memberId: memberIds.Ada,
        serviceDate: "2026-08-09",
      },
    },
  );
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
  assert.deepEqual(preservedOptionalFields.payload.member.recurringAvailability, {
    weeksOfMonth: [4],
    includeLastWeekOfMonth: false,
  });

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
        email: "sam.lee@example.com",
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
              type: "song",
              title: richText("Great Are You Lord"),
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
    created.payload.servicePlan.sections[0].sourcePlanningManaged,
    true,
  );
  assert.equal(
    created.payload.servicePlan.sections[0].elements[0].sourcePlanningManaged,
    true,
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

  const updated = await callHandler(authHandlers.saveServicePlan, {
    context,
    params: { planKey },
    body: {
      baseRevision: created.payload.servicePlan.revision,
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
  assert.equal(updated.payload.servicePlan.sections[0].elements.length, 2);
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

  const published = await callHandler(authHandlers.publishServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(published.statusCode, 200);
  assert.match(published.payload.publicUrl, /#\/services\//);
  assert.match(published.payload.generalPublicUrl, /#\/services\//);
  assert.match(published.payload.currentTeamPublicUrl, /#\/services\//);
  assert.match(published.payload.currentGeneralPublicUrl, /#\/services\//);
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

  // An editor still gets the links back so "copy share link" keeps working.
  const editorRead = await callHandler(authHandlers.getServicePlan, {
    context,
    params: { planKey },
  });
  assert.equal(editorRead.payload.servicePlan.publicLinkToken, undefined);
  assert.equal(editorRead.payload.publicUrls.team.includes(publicToken), true);

  const viewerWrite = await callHandler(authHandlers.saveServicePlan, {
    context: viewerContext,
    params: { planKey },
    body: {
      serviceId: "svc1",
      date: "2026-07-26",
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
        allowCrossTeamConflict: true,
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
  assert.equal(summaryDistant.assignments, undefined);
  assert.equal(summaryDistant.microphoneAssignments, undefined);
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

  const tooManyUpcoming = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: entries(101, 1),
    },
  });
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

const seedAssignedSchedule = async (
  context,
  suffix,
  { link = true, cameraSlots = 1 } = {},
) => {
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
  const occurrenceId = `svc-${suffix}@2026-09-06`;
  const schedule = await callHandler(authHandlers.createTeamSchedule, {
    context,
    body: {
      name: "Respond schedule",
      teamId: media.teamId,
      serviceIds: [`svc-${suffix}`],
      startDate: "2026-09-06",
      endDate: "2026-09-06",
      occurrences: [
        {
          occurrenceId,
          serviceId: `svc-${suffix}`,
          serviceIds: [`svc-${suffix}`],
          name: "Sunday Gathering",
          startsAt: "2026-09-06T14:00:00.000Z",
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
  return { memberId, scheduleId, occurrenceId, cellKey, media };
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

  // Pressing send again must not re-mail anyone.
  const second = await callHandler(authHandlers.sendTeamSchedule, {
    context,
    params: { scheduleId },
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.payload.notified, 0);
  assert.equal(second.payload.alreadyNotified, 1);

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
  const { memberId, scheduleId } = await seedAssignedSchedule(
    context,
    "muted",
  );
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
  const { memberId, scheduleId, occurrenceId, cellKey } =
    await seedAssignedSchedule(context, "blockconflict");

  const res = await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      blockoutDates: [{ startDate: "2026-09-06", endDate: "2026-09-06" }],
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
  const { scheduleId } = await seedAssignedSchedule(context, "blockclear");

  await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: {
      expectedUpdatedAt: await currentMemberStamp(context),
      // A week after the only service on this schedule.
      blockoutDates: [{ startDate: "2026-09-13", endDate: "2026-09-13" }],
    },
  });

  const saved = await readScheduleRow(context, scheduleId);
  assert.deepEqual(saved.pendingBlockoutConflicts, undefined);
  assert.equal(saved.pendingResponseDigestSince, undefined);
});

test("re-saving the same blockout does not re-notify", async (t) => {
  if (skipUnlessInMemoryAuth(t)) return;
  const context = await createAdminContext("blockout_resave");
  const { scheduleId } = await seedAssignedSchedule(context, "blockresave");
  const away = [{ startDate: "2026-09-06", endDate: "2026-09-06" }];

  await callHandler(authHandlers.updateMyBlockoutDates, {
    context,
    body: { expectedUpdatedAt: await currentMemberStamp(context), blockoutDates: away },
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
  const occurrences = ["2026-09-06", "2026-09-13"].map((date) => ({
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
      startDate: "2026-09-06",
      endDate: "2026-09-13",
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

  const away = [{ startDate: "2026-09-06", endDate: "2026-09-06" }];
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
      blockoutDates: [...away, { startDate: "2026-09-13", endDate: "2026-09-13" }],
    },
  });

  // The second save writes only its own key. Writing the merged map back would
  // re-assert the first — and would erase anything a digest deleted in between.
  const saved = await readScheduleRow(context, scheduleId);
  assert.deepEqual(
    Object.values(saved.pendingBlockoutConflicts)
      .map((entry) => entry.occurrenceId)
      .sort(),
    ["svc-acc@2026-09-06", "svc-acc@2026-09-13"],
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
