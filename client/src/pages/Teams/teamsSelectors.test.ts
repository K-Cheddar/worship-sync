import type {
  TeamIntakeSubmission,
  TeamRecord,
  TeamRosterMember,
} from "../../api/authTypes";
import {
  emptyMemberListFilters,
  intakeSubmissionNeedsAction,
  isMemberOnTeam,
  memberMatchesListFilters,
  submissionMatchesStatusFilter,
} from "./teamsSelectors";

const STATUSES: TeamIntakeSubmission["status"][] = [
  "new",
  "applied",
  "dismissed",
];

describe("intake submission status filtering", () => {
  it("treats new as needing action, applied and dismissed as done", () => {
    expect(intakeSubmissionNeedsAction({ status: "new" })).toBe(true);
    expect(intakeSubmissionNeedsAction({ status: "applied" })).toBe(false);
    expect(intakeSubmissionNeedsAction({ status: "dismissed" })).toBe(false);
  });

  it("the needs_action filter keeps only open submissions", () => {
    const kept = STATUSES.filter((status) =>
      submissionMatchesStatusFilter(status, "needs_action"),
    );
    expect(kept).toEqual(["new"]);
  });

  it("the processed filter keeps only resolved submissions", () => {
    const kept = STATUSES.filter((status) =>
      submissionMatchesStatusFilter(status, "processed"),
    );
    expect(kept).toEqual(["applied", "dismissed"]);
  });

  it("the all filter keeps every submission", () => {
    const kept = STATUSES.filter((status) =>
      submissionMatchesStatusFilter(status, "all"),
    );
    expect(kept).toEqual(STATUSES);
  });
});

const team = (teamId: string, memberIds: string[] = []): TeamRecord => ({
  teamId,
  churchId: "church-1",
  name: teamId,
  memberIds,
});

const member = (
  memberId: string,
  overrides: Partial<TeamRosterMember> = {},
): TeamRosterMember => ({
  memberId,
  churchId: "church-1",
  firstName: memberId,
  lastName: "Test",
  positionIds: [],
  blockoutDates: [],
  ...overrides,
});

describe("member list filtering", () => {
  const teamsById = new Map([
    ["team-a", team("team-a", ["member-1"])],
    ["team-b", team("team-b", ["member-2"])],
  ]);

  it("returns all members when no filters are active", () => {
    const roster = [
      member("member-1"),
      member("member-2", { positionIds: ["position-b"] }),
    ];
    const filters = emptyMemberListFilters();
    expect(
      roster.filter((item) =>
        memberMatchesListFilters(item, filters, teamsById),
      ),
    ).toEqual(roster);
  });

  it("filters members by team roster membership", () => {
    const roster = [member("member-1"), member("member-2")];
    const filters = { ...emptyMemberListFilters(), teamIds: ["team-a"] };
    expect(
      roster
        .filter((item) => memberMatchesListFilters(item, filters, teamsById))
        .map((item) => item.memberId),
    ).toEqual(["member-1"]);
  });

  it("treats teamMemberships as team membership for filtering", () => {
    const roster = [
      member("member-3", {
        teamMemberships: { "team-a": { teamId: "team-a", roleId: "role-a" } },
      }),
    ];
    const filters = { ...emptyMemberListFilters(), teamIds: ["team-a"] };
    expect(isMemberOnTeam(roster[0], "team-a", teamsById)).toBe(true);
    expect(memberMatchesListFilters(roster[0], filters, teamsById)).toBe(true);
  });

  it("filters members by position, role, and qualification attributes", () => {
    const rosterMember = member("member-1", {
      positionIds: ["position-a"],
      teamMemberships: { "team-a": { teamId: "team-a", roleId: "role-a" } },
      qualifications: [
        {
          qualificationId: "qual-1",
          areaId: "area-a",
          levelId: "level-a",
          teamId: "team-a",
          status: "completed",
        },
      ],
    });
    expect(
      memberMatchesListFilters(
        rosterMember,
        { ...emptyMemberListFilters(), positionIds: ["position-a"] },
        teamsById,
      ),
    ).toBe(true);
    expect(
      memberMatchesListFilters(
        rosterMember,
        { ...emptyMemberListFilters(), roleIds: ["role-a"] },
        teamsById,
      ),
    ).toBe(true);
    expect(
      memberMatchesListFilters(
        rosterMember,
        { ...emptyMemberListFilters(), qualificationAreaIds: ["area-a"] },
        teamsById,
      ),
    ).toBe(true);
    expect(
      memberMatchesListFilters(
        rosterMember,
        { ...emptyMemberListFilters(), qualificationLevelIds: ["level-a"] },
        teamsById,
      ),
    ).toBe(true);
    expect(
      memberMatchesListFilters(
        rosterMember,
        { ...emptyMemberListFilters(), qualificationStatuses: ["completed"] },
        teamsById,
      ),
    ).toBe(true);
    expect(
      memberMatchesListFilters(
        rosterMember,
        { ...emptyMemberListFilters(), positionIds: ["position-b"] },
        teamsById,
      ),
    ).toBe(false);
  });

  it("requires qualification area, level, and status on the same record", () => {
    const multiQualMember = member("member-1", {
      qualifications: [
        {
          qualificationId: "qual-safety",
          areaId: "area-safety",
          levelId: "level-safety-1",
          teamId: "team-a",
          status: "completed",
        },
        {
          qualificationId: "qual-greeter",
          areaId: "area-greeter",
          levelId: "level-greeter-1",
          teamId: "team-a",
          status: "in_training",
        },
      ],
    });

    expect(
      memberMatchesListFilters(
        multiQualMember,
        {
          ...emptyMemberListFilters(),
          qualificationAreaIds: ["area-safety"],
          qualificationStatuses: ["in_training"],
        },
        teamsById,
      ),
    ).toBe(false);

    expect(
      memberMatchesListFilters(
        multiQualMember,
        {
          ...emptyMemberListFilters(),
          qualificationAreaIds: ["area-safety"],
          qualificationStatuses: ["completed"],
        },
        teamsById,
      ),
    ).toBe(true);

    expect(
      memberMatchesListFilters(
        multiQualMember,
        {
          ...emptyMemberListFilters(),
          qualificationAreaIds: ["area-safety"],
          qualificationLevelIds: ["level-greeter-1"],
        },
        teamsById,
      ),
    ).toBe(false);

    expect(
      memberMatchesListFilters(
        multiQualMember,
        {
          ...emptyMemberListFilters(),
          qualificationAreaIds: ["area-safety"],
          qualificationLevelIds: ["level-safety-1"],
          qualificationStatuses: ["completed"],
        },
        teamsById,
      ),
    ).toBe(true);
  });
});
