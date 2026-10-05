import test from "node:test";
import assert from "node:assert/strict";
import { projectTeamsBootstrapForAccess } from "./teamsBootstrapProjection.js";
import { resolveEffectiveTeamAccess } from "./teamAccess.js";

const churchId = "church-1";
const makeMember = (memberId, overrides = {}) => ({
  memberId,
  churchId,
  title: "Dr.",
  firstName: memberId,
  lastName: "Volunteer",
  email: memberId + "@example.test",
  phoneNumber: "+15551234567",
  userId: memberId,
  invitedAt: "2026-01-01",
  birthDate: { month: 2, day: 3, year: 1990 },
  isMinor: false,
  servingFrequency: "weekly",
  recurringAvailability: {
    weeksOfMonth: [1, 3],
    includeLastWeekOfMonth: false,
  },
  positionIds: ["position-worship", "position-av", "position-youth"],
  desiredPositionIds: ["position-worship", "position-youth"],
  serviceAvailability: { "service-1": "unavailable" },
  teamMemberships: {
    worship: {
      teamId: "worship",
      roleId: "role-worship",
      roleLabel: "Worship lead",
      isTeamLead: true,
      notes: "Worship membership note",
    },
    av: {
      teamId: "av",
      roleId: "role-av",
      roleLabel: "AV operator",
      isTeamLead: false,
      notes: "AV membership note",
    },
    youth: {
      teamId: "youth",
      roleId: "role-youth",
      roleLabel: "Youth leader",
      isTeamLead: true,
      notes: "Youth membership note",
    },
  },
  qualifications: [
    {
      qualificationId: "qualification-worship",
      areaId: "area-worship",
      levelId: "level-worship",
      teamId: "worship",
      status: "completed",
      notes: "Worship qualification note",
      verifiedByUid: "account-verifier",
    },
    {
      qualificationId: "qualification-av",
      areaId: "area-av",
      levelId: "level-av",
      teamId: "av",
      status: "in_training",
      notes: "AV qualification note",
    },
    {
      qualificationId: "qualification-youth",
      areaId: "area-youth",
      levelId: "level-youth",
      teamId: "youth",
      status: "completed",
      notes: "Youth qualification note",
    },
  ],
  blockoutDates: [
    { startDate: "2026-11-01", endDate: "2026-11-02", notes: "Travel" },
  ],
  notes: "Internal roster note",
  profileImageUrl: "https://example.test/profile.png",
  profileImagePublicId: "member-profile",
  archivedAt: null,
  ...overrides,
});

const fullData = () => ({
  members: [
    makeMember("caller"),
    makeMember("shared"),
    makeMember("multi"),
    makeMember("worship-only"),
    makeMember("hidden-only", {
      positionIds: ["position-youth"],
      teamMemberships: { youth: { teamId: "youth", roleId: "role-youth" } },
      qualifications: [],
    }),
    makeMember("archived-member", { archivedAt: "2026-01-01" }),
  ],
  smsEligibilityByMemberId: {
    caller: { eligible: true, status: "eligible", phoneNumber: "+15551234567" },
    shared: { eligible: false, status: "consent_needed" },
  },
  positions: [
    { positionId: "position-worship", teamId: "worship" },
    { positionId: "position-av", teamId: "av" },
    { positionId: "position-youth", teamId: "youth" },
    { positionId: "position-archived", teamId: "archived" },
  ],
  teams: [
    {
      teamId: "worship",
      churchId,
      memberIds: ["caller", "shared", "multi", "worship-only"],
    },
    { teamId: "av", churchId, memberIds: ["caller", "shared", "multi"] },
    { teamId: "youth", churchId, memberIds: ["shared", "hidden-only"] },
    {
      teamId: "archived",
      churchId,
      memberIds: ["archived-member"],
      archivedAt: "2026-01-01",
    },
  ],
  teamRoles: [
    { roleId: "role-worship", teamId: "worship" },
    { roleId: "role-av", teamId: "av" },
    { roleId: "role-youth", teamId: "youth" },
  ],
  qualificationAreas: [
    { areaId: "area-worship", teamId: "worship" },
    { areaId: "area-av", teamId: "av" },
    { areaId: "area-youth", teamId: "youth" },
  ],
  qualificationLevels: [
    { levelId: "level-worship", areaId: "area-worship" },
    { levelId: "level-av", areaId: "area-av" },
    { levelId: "level-youth", areaId: "area-youth" },
    { levelId: "orphan-hidden-level", areaId: "area-not-projected" },
  ],
  schedules: [
    { scheduleId: "schedule-worship", teamId: "worship", assignments: [] },
    { scheduleId: "schedule-av", teamId: "av", assignments: [] },
    { scheduleId: "schedule-youth", teamId: "youth", assignments: [] },
  ],
  intakeForms: [{ formId: "form-1", teamIds: ["worship"] }],
  intakeSubmissions: [{ submissionId: "submission-1", formId: "form-1" }],
  intakeRecipients: [{ recipientId: "recipient-1", formId: "form-1" }],
  scheduleHydrationWindow: { startDate: "2026-09-01", endDate: "2027-03-01" },
  truncated: true,
});

const resolveAccess = ({
  uid = "caller",
  teamScopes = {},
  teams = [],
  members = [],
  globalTeams = "none",
  role = "member",
} = {}) =>
  resolveEffectiveTeamAccess({
    bootstrap: {
      role,
      churchId,
      sessionKind: "human",
      user: { uid },
      permissions: { teams: globalTeams, teamScopes },
    },
    churchId,
    members,
    teams,
  });

const source = fullData();

test("admin and global Teams editor preserve the existing full bootstrap object", () => {
  for (const access of [
    resolveAccess({
      role: "admin",
      teams: source.teams,
      members: source.members,
    }),
    resolveAccess({
      globalTeams: "edit",
      teams: source.teams,
      members: source.members,
    }),
  ]) {
    assert.strictEqual(
      projectTeamsBootstrapForAccess({ data: source, access }),
      source,
    );
  }
});

test("global Teams viewer preserves the existing full bootstrap object", () => {
  const access = resolveAccess({
    globalTeams: "view",
    teams: source.teams,
    members: source.members,
  });
  assert.strictEqual(
    projectTeamsBootstrapForAccess({ data: source, access }),
    source,
  );
});

test("scoped manager receives only the managed team's records and manager fields", () => {
  const managerData = {
    ...source,
    teams: source.teams.map((team) =>
      team.teamId === "av"
        ? {
            ...team,
            memberIds: team.memberIds.filter(
              (memberId) => memberId !== "caller",
            ),
          }
        : team,
    ),
  };
  const access = resolveAccess({
    teamScopes: { worship: "edit" },
    teams: managerData.teams,
    members: managerData.members,
  });
  const projected = projectTeamsBootstrapForAccess({
    data: managerData,
    access,
  });

  assert.deepEqual(
    projected.teams.map(({ teamId }) => teamId),
    ["worship"],
  );
  assert.deepEqual(
    projected.positions.map(({ positionId }) => positionId),
    ["position-worship"],
  );
  assert.deepEqual(
    projected.teamRoles.map(({ roleId }) => roleId),
    ["role-worship"],
  );
  assert.deepEqual(
    projected.qualificationAreas.map(({ areaId }) => areaId),
    ["area-worship"],
  );
  assert.deepEqual(
    projected.qualificationLevels.map(({ levelId }) => levelId),
    ["level-worship"],
  );
  assert.deepEqual(
    projected.schedules.map(({ scheduleId }) => scheduleId),
    ["schedule-worship"],
  );
  assert.deepEqual(projected.schedules[0], managerData.schedules[0]);
  assert.deepEqual(
    projected.members.map(({ memberId }) => memberId),
    ["caller", "shared", "multi", "worship-only"],
  );
  assert.deepEqual(projected.members[0].positionIds, ["position-worship"]);
  assert.equal(projected.members[0].email, "caller@example.test");
  assert.deepEqual(
    projected.members[0].qualifications.map(
      ({ qualificationId }) => qualificationId,
    ),
    ["qualification-worship"],
  );
  assert.equal(projected.members[0].qualifications[0].verifiedByUid, undefined);
  assert.deepEqual(Object.keys(projected.members[0].teamMemberships), [
    "worship",
  ]);
  assert.equal(projected.members[0].userId, undefined);
  assert.equal(projected.members[0].invitedAt, undefined);
  assert.equal(projected.members[0].serviceAvailability, undefined);
  assert.equal(projected.smsEligibilityByMemberId, undefined);
  assert.equal(projected.intakeForms, undefined);
  assert.equal(projected.intakeSubmissions, undefined);
  assert.equal(projected.intakeRecipients, undefined);
  assert.deepEqual(
    projected.scheduleHydrationWindow,
    source.scheduleHydrationWindow,
  );
  assert.equal(projected.truncated, true);
});
test("membership-only reader receives only safe roster fields for their team", () => {
  const access = resolveAccess({
    uid: "worship-only",
    teams: source.teams,
    members: source.members,
  });
  const projected = projectTeamsBootstrapForAccess({ data: source, access });

  assert.deepEqual(
    projected.teams.map(({ teamId }) => teamId),
    ["worship"],
  );
  const caller = projected.members.find(
    ({ memberId }) => memberId === "worship-only",
  );
  assert.deepEqual(Object.keys(caller).sort(), [
    "churchId",
    "firstName",
    "lastName",
    "memberId",
    "positionIds",
    "profileImageUrl",
    "title",
  ]);
  assert.deepEqual(caller.positionIds, ["position-worship"]);
  for (const field of [
    "email",
    "phoneNumber",
    "birthDate",
    "blockoutDates",
    "notes",
    "userId",
    "teamMemberships",
    "qualifications",
  ]) {
    assert.equal(caller[field], undefined, field + " must be omitted");
  }
  assert.equal(projected.smsEligibilityByMemberId, undefined);
  assert.equal(projected.intakeForms, undefined);
});
test("multi-team roster member sees every canonical active team and no archived team", () => {
  const access = resolveAccess({
    uid: "multi",
    teams: source.teams,
    members: source.members,
  });
  const projected = projectTeamsBootstrapForAccess({ data: source, access });
  assert.deepEqual([...access.memberTeamIds], ["worship", "av"]);
  assert.deepEqual(
    projected.teams.map(({ teamId }) => teamId),
    ["worship", "av"],
  );
  assert.equal(
    projected.teams.some(({ teamId }) => teamId === "youth"),
    false,
  );
  assert.equal(
    projected.teams.some(({ teamId }) => teamId === "archived"),
    false,
  );
});
test("mixed manager and member access uses editable-team details and safe view-only data", () => {
  const mixedData = {
    ...source,
    teams: source.teams.map((team) =>
      team.teamId === "worship"
        ? { ...team, memberIds: ["shared", "multi", "worship-only"] }
        : team,
    ),
    members: source.members.map((member) =>
      member.memberId === "caller"
        ? { ...member, positionIds: ["position-av"] }
        : member,
    ),
  };
  const access = resolveAccess({
    teamScopes: { worship: "edit" },
    teams: mixedData.teams,
    members: mixedData.members,
  });
  const projected = projectTeamsBootstrapForAccess({ data: mixedData, access });
  const caller = projected.members.find(
    ({ memberId }) => memberId === "caller",
  );
  const shared = projected.members.find(
    ({ memberId }) => memberId === "shared",
  );

  assert.deepEqual(
    projected.teams.map(({ teamId }) => teamId),
    ["worship", "av"],
  );
  assert.deepEqual(caller.positionIds, ["position-av"]);
  assert.equal(caller.email, undefined);
  assert.equal(caller.teamMemberships, undefined);
  assert.equal(caller.qualifications, undefined);
  assert.equal(shared.email, "shared@example.test");
  assert.deepEqual(shared.positionIds, ["position-worship", "position-av"]);
  assert.deepEqual(Object.keys(shared.teamMemberships).sort(), [
    "av",
    "worship",
  ]);
  assert.equal(shared.teamMemberships.av.notes, undefined);
  assert.equal(shared.teamMemberships.worship.notes, "Worship membership note");
  assert.deepEqual(
    shared.qualifications.map(({ qualificationId }) => qualificationId),
    ["qualification-worship"],
  );
  assert.equal(shared.teamMemberships.youth, undefined);
  assert.equal(
    shared.qualifications.some(({ teamId }) => teamId === "youth"),
    false,
  );
});
test("shared roster member reveals no hidden-team positions, qualifications, roles, or membership", () => {
  const projected = projectTeamsBootstrapForAccess({
    data: source,
    access: {
      viewAll: false,
      viewTeamIds: new Set(["worship"]),
      editTeamIds: new Set(["worship"]),
    },
  });
  const shared = projected.members.find(
    ({ memberId }) => memberId === "shared",
  );

  assert.deepEqual(shared.positionIds, ["position-worship"]);
  assert.deepEqual(shared.desiredPositionIds, ["position-worship"]);
  assert.deepEqual(Object.keys(shared.teamMemberships), ["worship"]);
  assert.deepEqual(
    shared.qualifications.map(({ teamId }) => teamId),
    ["worship"],
  );
  assert.equal(
    projected.teamRoles.some(({ teamId }) => teamId === "youth"),
    false,
  );
});

test("hidden-only and archived roster members do not appear in a scoped projection", () => {
  const projected = projectTeamsBootstrapForAccess({
    data: source,
    access: {
      viewAll: false,
      viewTeamIds: new Set(["worship"]),
      editTeamIds: new Set(),
    },
  });
  assert.deepEqual(
    projected.members.map(({ memberId }) => memberId),
    ["caller", "shared", "multi", "worship-only"],
  );
});

test("read-only and scoped-manager projections omit intake and SMS data", () => {
  for (const access of [
    {
      viewAll: false,
      viewTeamIds: new Set(["worship"]),
      editTeamIds: new Set(),
    },
    {
      viewAll: false,
      viewTeamIds: new Set(["worship"]),
      editTeamIds: new Set(["worship"]),
    },
  ]) {
    const projected = projectTeamsBootstrapForAccess({ data: source, access });
    for (const key of [
      "smsEligibilityByMemberId",
      "intakeForms",
      "intakeSubmissions",
      "intakeRecipients",
    ]) {
      assert.equal(
        Object.hasOwn(projected, key),
        false,
        key + " must be omitted",
      );
    }
  }
});

test("archived teams stay hidden even if a stale scope contains their ID", () => {
  const projected = projectTeamsBootstrapForAccess({
    data: source,
    access: {
      viewAll: false,
      viewTeamIds: new Set(["archived"]),
      editTeamIds: new Set(["archived"]),
    },
  });
  assert.deepEqual(projected.teams, []);
  assert.deepEqual(projected.positions, []);
  assert.deepEqual(projected.schedules, []);
  assert.deepEqual(projected.members, []);
});

test("summary schedules and safe metadata survive only within projected team scope", () => {
  const data = {
    ...source,
    schedules: [
      { scheduleId: "summary-worship", teamId: "worship", summary: true },
      { scheduleId: "summary-youth", teamId: "youth", summary: true },
    ],
  };
  const projected = projectTeamsBootstrapForAccess({
    data,
    access: {
      viewAll: false,
      viewTeamIds: new Set(["worship"]),
      editTeamIds: new Set(),
    },
  });
  assert.deepEqual(projected.schedules, [data.schedules[0]]);
  assert.deepEqual(
    projected.scheduleHydrationWindow,
    data.scheduleHydrationWindow,
  );
  assert.equal(projected.truncated, true);
});
