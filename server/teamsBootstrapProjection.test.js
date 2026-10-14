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

const makeWorshipOnlyMember = (memberId = "worship-only") =>
  makeMember(memberId, {
    positionIds: ["position-worship"],
    desiredPositionIds: ["position-worship"],
    teamMemberships: {
      worship: {
        teamId: "worship",
        roleId: "role-worship",
        roleLabel: "Worship lead",
        isTeamLead: true,
        notes: "Worship membership note",
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
      },
    ],
  });

const makeWorshipAvMember = () =>
  makeMember("worship-av", {
    positionIds: ["position-worship", "position-av"],
    teamMemberships: {
      worship: { teamId: "worship", roleLabel: "Worship member" },
      av: { teamId: "av", roleLabel: "AV member" },
    },
    qualifications: [
      {
        qualificationId: "qualification-worship",
        areaId: "area-worship",
        teamId: "worship",
      },
      {
        qualificationId: "qualification-av",
        areaId: "area-av",
        teamId: "av",
      },
    ],
  });

const fullData = () => ({
  members: [
    makeMember("caller"),
    makeMember("shared"),
    makeMember("multi"),
    makeWorshipOnlyMember(),
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
    {
      scheduleId: "schedule-worship",
      teamId: "worship",
      assignments: [],
      responses: { "occurrence-1": { "position-worship::0": "accepted" } },
      guests: [
        {
          guestId: "guest-1",
          name: "Guest One",
          email: "guest@example.test",
          phone: "+15550001111",
          note: "Manager guest note",
        },
      ],
    },
    {
      scheduleId: "schedule-av",
      teamId: "av",
      assignments: [],
      occurrences: [{ occurrenceId: "occurrence-2", startsAt: "2026-10-11" }],
      microphoneAssignments: { "occurrence-2": { "position-av::0": ["mic-1"] } },
      iemAssignments: { "occurrence-2": { "position-av::0": ["iem-1"] } },
      additionalPositionSlots: { "occurrence-2": ["position-av::1"] },
      responses: { "occurrence-2": { "position-av::0": "declined" } },
      guests: [
        {
          guestId: "guest-2",
          name: "AV Guest",
          email: "av-guest@example.test",
          phone: "+15550002222",
          note: "AV guest note",
        },
      ],
      createdByUid: "private-admin-data",
    },
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

test("global Teams viewer receives a safe read-only bootstrap projection", () => {
  const access = resolveAccess({
    globalTeams: "view",
    teams: source.teams,
    members: source.members,
  });
  const projected = projectTeamsBootstrapForAccess({ data: source, access });
  assert.equal(projected.teams.length, 3);
  assert.equal(projected.members[0].email, undefined);
  assert.equal(projected.members[0].phoneNumber, undefined);
  assert.equal(projected.members[0].birthDate, undefined);
  assert.equal(projected.intakeForms, undefined);
  assert.equal(projected.intakeSubmissions, undefined);
  assert.equal(projected.intakeRecipients, undefined);
  assert.equal(projected.smsEligibilityByMemberId, undefined);
  assert.equal(projected.schedules[0].guests[0].email, undefined);
  assert.equal(projected.schedules[0].responses, undefined);
});

test("scoped manager receives only the managed team's records and manager fields", () => {
  const managerData = {
    ...source,
    truncated: false,
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
  const worshipOnly = projected.members.find(
    ({ memberId }) => memberId === "worship-only",
  );
  assert.equal(worshipOnly.email, undefined);
  assert.deepEqual(projected.editableMemberIds, ["worship-only"]);
  assert.equal(worshipOnly.serviceAvailability, undefined);
  assert.deepEqual(
    worshipOnly.qualifications.map(({ qualificationId }) => qualificationId),
    ["qualification-worship"],
  );
  assert.equal(worshipOnly.qualifications[0].verifiedByUid, undefined);
  assert.deepEqual(Object.keys(worshipOnly.teamMemberships), [
    "worship",
  ]);
  assert.equal(worshipOnly.userId, undefined);
  assert.equal(worshipOnly.invitedAt, undefined);
  assert.equal(projected.smsEligibilityByMemberId, undefined);
  assert.equal(projected.intakeForms, undefined);
  assert.deepEqual(projected.schedules[0], managerData.schedules[0]);
  assert.equal(projected.schedules[0].responses["occurrence-1"]["position-worship::0"], "accepted");
  assert.equal(projected.schedules[0].guests[0].email, "guest@example.test");
  assert.equal(projected.intakeSubmissions, undefined);
  assert.equal(projected.intakeRecipients, undefined);
  assert.deepEqual(
    projected.scheduleHydrationWindow,
    source.scheduleHydrationWindow,
  );
  assert.equal(projected.truncated, undefined);
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
  assert.equal(projected.editableMemberIds.includes(caller.memberId), false);
  for (const field of [
    "email",
    "phoneNumber",
    "birthDate",
    "blockoutDates",
    "notes",
    "userId",
    "invitedAt",
    "profileImagePublicId",
    "teamMemberships",
    "qualifications",
    "serviceAvailability",
  ]) {
    assert.equal(caller[field], undefined, field + " must be omitted");
  }
  assert.equal(projected.smsEligibilityByMemberId, undefined);
  assert.equal(projected.intakeForms, undefined);
  assert.deepEqual(projected.schedules[0].guests, [
    { guestId: "guest-1", name: "Guest One" },
  ]);
  assert.equal(projected.schedules[0].guests[0].email, undefined);
  assert.equal(projected.schedules[0].guests[0].phone, undefined);
  assert.equal(projected.schedules[0].guests[0].note, undefined);
  assert.equal(projected.schedules[0].responses, undefined);
  assert.equal(projected.schedules[0].createdByUid, undefined);
  assert.equal(projected.schedules.some(({ teamId }) => teamId === "youth"), false);
  const shared = projected.members.find(({ memberId }) => memberId === "shared");
  assert.equal(shared.email, undefined);
  assert.equal(shared.phoneNumber, undefined);
  assert.equal(shared.birthDate, undefined);
  assert.equal(shared.isMinor, undefined);
  assert.equal(shared.servingFrequency, undefined);
  assert.equal(shared.recurringAvailability, undefined);
  assert.equal(shared.blockoutDates, undefined);
  assert.equal(shared.notes, undefined);
  assert.equal(shared.profileImagePublicId, undefined);
  assert.equal(shared.serviceAvailability, undefined);
  assert.equal(shared.teamMemberships, undefined);
  assert.equal(shared.qualifications, undefined);
  assert.equal(shared.positionIds.includes("position-youth"), false);
  assert.equal(projected.intakeSubmissions, undefined);
  assert.equal(projected.intakeRecipients, undefined);
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
    truncated: false,
    teams: source.teams.map((team) =>
      team.teamId === "worship"
        ? {
            ...team,
            memberIds: ["shared", "multi", "worship-only", "worship-av"],
          }
        : team.teamId === "av"
          ? { ...team, memberIds: [...team.memberIds, "worship-av"] }
        : team,
    ),
    members: [
      ...source.members.map((member) =>
        member.memberId === "caller"
          ? { ...member, positionIds: ["position-av"] }
          : member,
      ),
      makeWorshipAvMember(),
    ],
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
  const worshipAv = projected.members.find(
    ({ memberId }) => memberId === "worship-av",
  );

  assert.deepEqual(
    projected.teams.map(({ teamId }) => teamId),
    ["worship", "av"],
  );
  assert.deepEqual(caller.positionIds, ["position-av"]);
  assert.equal(caller.email, undefined);
  assert.equal(caller.teamMemberships, undefined);
  assert.equal(caller.qualifications, undefined);
  assert.equal(shared.email, undefined);
  assert.equal(shared.phoneNumber, undefined);
  assert.equal(shared.serviceAvailability, undefined);
  assert.deepEqual(shared.positionIds, ["position-worship", "position-av"]);
  assert.equal(shared.teamMemberships, undefined);
  assert.equal(shared.qualifications, undefined);
  assert.equal(shared.desiredPositionIds, undefined);
  assert.equal(projected.editableMemberIds.includes("shared"), false);
  assert.equal(worshipAv.email, undefined);
  assert.deepEqual(worshipAv.positionIds, ["position-worship", "position-av"]);
  assert.equal(worshipAv.teamMemberships, undefined);
  assert.equal(worshipAv.qualifications, undefined);
  assert.equal(projected.editableMemberIds.includes("worship-av"), false);
  assert.deepEqual(projected.schedules.find(({ teamId }) => teamId === "av"), {
    scheduleId: "schedule-av",
    teamId: "av",
    assignments: [],
    occurrences: [{ occurrenceId: "occurrence-2", startsAt: "2026-10-11" }],
    microphoneAssignments: { "occurrence-2": { "position-av::0": ["mic-1"] } },
    iemAssignments: { "occurrence-2": { "position-av::0": ["iem-1"] } },
    additionalPositionSlots: { "occurrence-2": ["position-av::1"] },
    guests: [{ guestId: "guest-2", name: "AV Guest" }],
  });
  assert.deepEqual(
    projected.schedules.find(({ teamId }) => teamId === "worship"),
    mixedData.schedules[0],
  );
  const readOnlySchedule = projected.schedules.find(({ teamId }) => teamId === "av");
  assert.equal(readOnlySchedule.responses, undefined);
  assert.equal(readOnlySchedule.guests[0].email, undefined);
  assert.equal(readOnlySchedule.guests[0].phone, undefined);
  assert.equal(readOnlySchedule.guests[0].note, undefined);
  assert.equal(readOnlySchedule.createdByUid, undefined);
  assert.equal(
    projected.schedules.some(({ teamId }) => teamId === "youth"),
    false,
  );
});
test("shared roster member reveals no hidden-team positions, qualifications, roles, or membership", () => {
  const projected = projectTeamsBootstrapForAccess({
    data: { ...source, truncated: false },
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
  assert.equal(shared.email, undefined);
  assert.equal(shared.desiredPositionIds, undefined);
  assert.equal(shared.teamMemberships, undefined);
  assert.equal(shared.qualifications, undefined);
  assert.equal(projected.editableMemberIds.includes("shared"), false);
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

test("truncated ownership sources fail closed for rich member projection", () => {
  const projected = projectTeamsBootstrapForAccess({
    data: source,
    access: {
      viewAll: false,
      viewTeamIds: new Set(["worship"]),
      editTeamIds: new Set(["worship"]),
    },
  });

  assert.deepEqual(projected.editableMemberIds, []);
  assert.equal(projected.truncated, true);
  for (const member of projected.members) {
    assert.equal(member.email, undefined);
    assert.equal(member.serviceAvailability, undefined);
  }
});

test("known archived ownership metadata does not block editability from the only active Team", () => {
  const member = makeWorshipOnlyMember("archived-stale-member");
  member.positionIds = ["position-worship", "position-archived"];
  member.teamMemberships.archived = { teamId: "archived" };
  member.qualifications = [{
    qualificationId: "old-qualification", areaId: "area-archived", teamId: "archived",
  }];
  const data = {
    ...source,
    truncated: false,
    members: [member],
    teams: source.teams.map((team) => team.teamId === "worship"
      ? { ...team, memberIds: [member.memberId] }
      : team),
    qualificationAreas: [
      ...source.qualificationAreas,
      { areaId: "area-archived", teamId: "archived" },
    ],
  };
  const projected = projectTeamsBootstrapForAccess({
    data,
    access: {
      viewAll: false,
      viewTeamIds: new Set(["worship"]),
      editTeamIds: new Set(["worship"]),
    },
  });
  const [projectedMember] = projected.members;
  assert.ok(projected.editableMemberIds.includes(member.memberId));
  assert.equal(projectedMember.email, undefined);
  assert.deepEqual(projectedMember.positionIds, ["position-worship"]);
  assert.deepEqual(projectedMember.qualifications, []);
});

test("unknown Team ownership metadata fails closed for rich member projection", () => {
  const member = makeWorshipOnlyMember("unknown-owner-member");
  member.teamMemberships["unknown-team"] = { teamId: "unknown-team" };
  const projected = projectTeamsBootstrapForAccess({
    data: {
      ...source,
      truncated: false,
      members: [member],
      teams: source.teams.map((team) => team.teamId === "worship"
        ? { ...team, memberIds: [member.memberId] }
        : team),
    },
    access: {
      viewAll: false,
      viewTeamIds: new Set(["worship"]),
      editTeamIds: new Set(["worship"]),
    },
  });
  const [projectedMember] = projected.members;
  assert.equal(projectedMember.email, undefined);
  assert.equal(projected.editableMemberIds.includes(member.memberId), false);
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
      {
        scheduleId: "summary-worship",
        teamId: "worship",
        assignmentsOmitted: true,
        hasScheduleData: true,
        assignmentCounts: { byMemberId: { member: 2 }, byPositionId: {} },
        guests: [
          {
            guestId: "guest-summary",
            name: "Summary Guest",
            email: "summary@example.test",
            phone: "+15550003333",
            note: "Summary note",
          },
        ],
        responses: { hidden: true },
      },
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
  assert.deepEqual(projected.schedules, [
    {
      scheduleId: "summary-worship",
      teamId: "worship",
      assignmentsOmitted: true,
      hasScheduleData: true,
      assignmentCounts: { byMemberId: { member: 2 }, byPositionId: {} },
      guests: [{ guestId: "guest-summary", name: "Summary Guest" }],
    },
  ]);
  assert.deepEqual(
    projected.scheduleHydrationWindow,
    data.scheduleHydrationWindow,
  );
  assert.equal(projected.truncated, true);
});

test("hidden ownership metadata without canonical roster links blocks rich member projection", () => {
  const hiddenOwnershipCases = [
    {
      name: "team membership metadata",
      overrides: {
        teamMemberships: {
          worship: { teamId: "worship" },
          youth: { teamId: "youth", roleId: "role-youth" },
        },
        positionIds: ["position-worship"],
        qualifications: [],
      },
    },
    {
      name: "position ownership",
      overrides: {
        teamMemberships: { worship: { teamId: "worship" } },
        positionIds: ["position-worship", "position-youth"],
        qualifications: [],
      },
    },
    {
      name: "desired Position ownership",
      overrides: {
        teamMemberships: { worship: { teamId: "worship" } },
        positionIds: ["position-worship"],
        desiredPositionIds: ["position-av"],
        qualifications: [],
      },
    },
    {
      name: "qualification area ownership",
      overrides: {
        teamMemberships: { worship: { teamId: "worship" } },
        positionIds: ["position-worship"],
        qualifications: [{ qualificationId: "hidden", areaId: "area-youth" }],
      },
    },
  ];

  for (const ownershipCase of hiddenOwnershipCases) {
    const member = makeMember("metadata-shared", ownershipCase.overrides);
    const data = {
      ...source,
      truncated: false,
      members: [member],
      teams: source.teams.map((team) =>
        team.teamId === "worship"
          ? { ...team, memberIds: [member.memberId] }
          : team.teamId === "youth"
            ? { ...team, memberIds: [] }
            : team,
      ),
    };
    const projected = projectTeamsBootstrapForAccess({
      data,
      access: {
        viewAll: false,
        viewTeamIds: new Set(["worship"]),
        editTeamIds: new Set(["worship"]),
      },
    });
    const [projectedMember] = projected.members;

    assert.equal(projectedMember.email, undefined, ownershipCase.name);
    assert.equal(projectedMember.teamMemberships, undefined, ownershipCase.name);
    assert.equal(projectedMember.qualifications, undefined, ownershipCase.name);
    assert.equal(
      projected.editableMemberIds.includes(member.memberId),
      false,
      ownershipCase.name,
    );
    assert.equal(
      JSON.stringify(projectedMember).includes("youth"),
      false,
      ownershipCase.name,
    );
  }
});

test("desired Positions require their Team edit scope and stay hidden from read-only members", () => {
  const member = makeMember("worship-av-interest", {
    positionIds: ["position-worship"],
    desiredPositionIds: ["position-av"],
    teamMemberships: { worship: { teamId: "worship" } },
    qualifications: [],
    notes: "private member note",
  });
  const data = {
    ...fullData(),
    truncated: false,
    members: [member],
    teams: fullData().teams.map((team) =>
      team.teamId === "worship"
        ? { ...team, memberIds: [member.memberId] }
        : team.teamId === "av"
          ? { ...team, memberIds: [] }
          : team,
    ),
  };
  const worshipOnly = projectTeamsBootstrapForAccess({
    data,
    access: {
      viewAll: false,
      viewTeamIds: new Set(["worship"]),
      editTeamIds: new Set(["worship"]),
    },
  });
  const [safeMember] = worshipOnly.members;
  assert.equal(safeMember.email, undefined);
  assert.equal(safeMember.phoneNumber, undefined);
  assert.equal(safeMember.notes, undefined);
  assert.equal(safeMember.desiredPositionIds, undefined);
  assert.deepEqual(safeMember.positionIds, ["position-worship"]);
  assert.equal(worshipOnly.editableMemberIds.includes(member.memberId), false);

  const bothTeams = projectTeamsBootstrapForAccess({
    data,
    access: {
      viewAll: false,
      viewTeamIds: new Set(["worship", "av"]),
      editTeamIds: new Set(["worship", "av"]),
    },
  });
  const [richMember] = bothTeams.members;
  assert.ok(bothTeams.editableMemberIds.includes(member.memberId));
  assert.deepEqual(richMember.desiredPositionIds, ["position-av"]);
  assert.equal(richMember.email, undefined);
});

test("malformed ownership containers and membership entries block rich projection", () => {
  const malformedCases = [
    { name: "positionIds", overrides: { positionIds: "bad" } },
    { name: "desiredPositionIds", overrides: { desiredPositionIds: {} } },
    { name: "qualifications", overrides: { qualifications: "bad" } },
    { name: "teamMemberships array", overrides: { teamMemberships: [] } },
    { name: "membership entry array", overrides: { teamMemberships: { worship: [] } } },
    { name: "membership entry string", overrides: { teamMemberships: { worship: "bad" } } },
  ];

  for (const malformedCase of malformedCases) {
    const member = makeWorshipOnlyMember(`malformed-${malformedCase.name}`);
    Object.assign(member, malformedCase.overrides);
    const projected = projectTeamsBootstrapForAccess({
      data: {
        ...source,
        truncated: false,
        members: [member],
        teams: source.teams.map((team) =>
          team.teamId === "worship"
            ? { ...team, memberIds: [member.memberId] }
            : team.teamId === "youth"
              ? { ...team, memberIds: [] }
              : team,
        ),
      },
      access: {
        viewAll: false,
        viewTeamIds: new Set(["worship"]),
        editTeamIds: new Set(["worship"]),
      },
    });
    const [safeMember] = projected.members;
    assert.equal(safeMember.email, undefined, malformedCase.name);
    assert.equal(projected.editableMemberIds.includes(member.memberId), false, malformedCase.name);
  }
});

test("foreign Position or Team records block rich member projection", () => {
  for (const foreignOwner of ["position", "team"]) {
    const member = makeWorshipOnlyMember(`foreign-${foreignOwner}`);
    member.desiredPositionIds = ["foreign-position"];
    const foreignTeam = {
      teamId: "foreign-team",
      churchId: "other-church",
      memberIds: [],
    };
    const projected = projectTeamsBootstrapForAccess({
      data: {
        ...source,
        truncated: false,
        members: [member],
        teams: [
          ...source.teams.map((team) =>
            team.teamId === "worship"
              ? { ...team, memberIds: [member.memberId] }
              : team,
          ),
          foreignTeam,
        ],
        positions: [
          ...source.positions,
          {
            positionId: "foreign-position",
            teamId: "foreign-team",
            ...(foreignOwner === "position" ? { churchId: "other-church" } : {}),
          },
        ],
      },
      access: {
        viewAll: false,
        viewTeamIds: new Set(["worship"]),
        editTeamIds: new Set(["worship", "foreign-team"]),
      },
    });
    assert.equal(projected.editableMemberIds.includes(member.memberId), false, foreignOwner);
    assert.equal(projected.members[0].email, undefined, foreignOwner);
  }
});
