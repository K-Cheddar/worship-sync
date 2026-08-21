import type {
  TeamPosition,
  TeamQualificationLevel,
  TeamRosterMember,
} from "../../../api/authTypes";
import {
  buildScheduleMemberPickerMembers,
  computeLevelBalanceBoost,
  getManualScheduleAssignmentIssue,
  getLowestLevelRank,
  getMemberQualificationLevelRank,
  isSelectableScheduleMember,
  shouldOfferCreateMember,
  shouldShowScheduleMemberEligibilityGroupDivider,
  shouldShowScheduleMemberPositionGroupDivider,
  splitTypedMemberName,
} from "./scheduleMemberPickerUtils";

const members: TeamRosterMember[] = [
  {
    memberId: "m1",
    churchId: "c1",
    firstName: "Avery",
    lastName: "Lee",
    positionIds: ["position-vocal"],
    blockoutDates: [],
  },
  {
    memberId: "m2",
    churchId: "c1",
    firstName: "Morgan",
    lastName: "Kay",
    positionIds: ["position-vocal"],
    blockoutDates: [],
  },
  {
    memberId: "m3",
    churchId: "c1",
    firstName: "Jordan",
    lastName: "Ray",
    positionIds: ["position-drums"],
    blockoutDates: [],
  },
];

const duplicateFirstNames = new Set<string>();

describe("scheduleMemberPickerUtils", () => {
  it("keeps blockouts selectable only in the manual scheduling flow", () => {
    expect(getManualScheduleAssignmentIssue("Blocked out")).toBe("");
    expect(
      getManualScheduleAssignmentIssue("Unavailable this week of the month"),
    ).toBe("");
    expect(getManualScheduleAssignmentIssue("Already assigned in this service")).toBe(
      "Already assigned in this service",
    );
  });

  it("splits typed names into first and last", () => {
    expect(splitTypedMemberName("Jordan Van Buren")).toEqual({
      firstName: "Jordan",
      lastName: "Van Buren",
    });
  });

  it("sorts members by the displayed schedule name", () => {
    const rows = buildScheduleMemberPickerMembers({
      members: [
        {
          memberId: "kevin",
          churchId: "c1",
          firstName: "Kevin",
          lastName: "Miller",
          positionIds: ["position-vocal"],
          blockoutDates: [],
        },
        {
          memberId: "oshay",
          churchId: "c1",
          firstName: "Oshay",
          lastName: "Patel",
          positionIds: ["position-vocal"],
          blockoutDates: [],
        },
        {
          memberId: "enya",
          churchId: "c1",
          firstName: "Enya-Kaye",
          lastName: "Lee",
          positionIds: ["position-vocal"],
          blockoutDates: [],
        },
        {
          memberId: "alrae",
          churchId: "c1",
          firstName: "Alrae",
          lastName: "Wilson",
          positionIds: ["position-vocal"],
          blockoutDates: [],
        },
      ],
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: () => "",
    });

    expect(rows.map((row) => row.member.firstName)).toEqual([
      "Alrae",
      "Enya-Kaye",
      "Kevin",
      "Oshay",
    ]);
  });

  it("floats members who desire the position above equal peers and flags them", () => {
    const rows = buildScheduleMemberPickerMembers({
      members: [
        {
          memberId: "anna",
          churchId: "c1",
          firstName: "Anna",
          lastName: "Aaron",
          positionIds: ["position-vocal"],
          blockoutDates: [],
        },
        {
          memberId: "zane",
          churchId: "c1",
          firstName: "Zane",
          lastName: "Zimmer",
          positionIds: ["position-vocal"],
          desiredPositionIds: ["position-vocal"],
          blockoutDates: [],
        },
      ],
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: () => "",
    });

    // Zane sorts after Anna by name, but desiring the position floats him up.
    expect(rows.map((row) => row.member.memberId)).toEqual(["zane", "anna"]);
    expect(rows.map((row) => row.desiresPosition)).toEqual([true, false]);
  });

  it("ranks eligible members with fewer schedule assignments first", () => {
    const rows = buildScheduleMemberPickerMembers({
      members: [
        {
          memberId: "busy",
          churchId: "c1",
          firstName: "Avery",
          lastName: "Lee",
          positionIds: ["position-vocal"],
          desiredPositionIds: ["position-vocal"],
          blockoutDates: [],
        },
        {
          memberId: "rested",
          churchId: "c1",
          firstName: "Morgan",
          lastName: "Kay",
          positionIds: ["position-vocal"],
          blockoutDates: [],
        },
      ],
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: () => "",
      recommendationStats: new Map([
        ["busy", { assignmentCount: 3, nearestAssignmentDistance: null }],
        ["rested", { assignmentCount: 0, nearestAssignmentDistance: 1 }],
      ]),
    });

    expect(rows.map((row) => row.member.memberId)).toEqual(["rested", "busy"]);
  });

  it("prefers members who have not reached their serving preference", () => {
    const rows = buildScheduleMemberPickerMembers({
      members: [
        {
          memberId: "reached",
          churchId: "c1",
          firstName: "Avery",
          lastName: "Lee",
          positionIds: ["position-vocal"],
          servingFrequency: "monthly",
          blockoutDates: [],
        },
        {
          memberId: "available",
          churchId: "c1",
          firstName: "Morgan",
          lastName: "Kay",
          positionIds: ["position-vocal"],
          servingFrequency: "monthly",
          blockoutDates: [],
        },
      ],
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: () => "",
      recommendationStats: new Map([
        [
          "reached",
          {
            assignmentCount: 0,
            nearestAssignmentDistance: null,
            servingFrequencyTargetReached: true,
          },
        ],
        [
          "available",
          {
            assignmentCount: 3,
            nearestAssignmentDistance: 1,
            servingFrequencyTargetReached: false,
          },
        ],
      ]),
    });

    expect(rows.map((row) => row.member.memberId)).toEqual([
      "available",
      "reached",
    ]);
  });

  it("prefers members spaced farther from their nearest assignment", () => {
    const rows = buildScheduleMemberPickerMembers({
      members: [
        {
          memberId: "nearby",
          churchId: "c1",
          firstName: "Avery",
          lastName: "Lee",
          positionIds: ["position-vocal"],
          blockoutDates: [],
        },
        {
          memberId: "spaced",
          churchId: "c1",
          firstName: "Morgan",
          lastName: "Kay",
          positionIds: ["position-vocal"],
          blockoutDates: [],
        },
        {
          memberId: "unused",
          churchId: "c1",
          firstName: "Jordan",
          lastName: "Ray",
          positionIds: ["position-vocal"],
          blockoutDates: [],
        },
      ],
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: () => "",
      recommendationStats: new Map([
        ["nearby", { assignmentCount: 1, nearestAssignmentDistance: 1 }],
        ["spaced", { assignmentCount: 1, nearestAssignmentDistance: 3 }],
        ["unused", { assignmentCount: 1, nearestAssignmentDistance: null }],
      ]),
    });

    expect(rows.map((row) => row.member.memberId)).toEqual([
      "unused",
      "spaced",
      "nearby",
    ]);
  });

  it("attaches a non-blocking warning without making the member ineligible", () => {
    const rows = buildScheduleMemberPickerMembers({
      members,
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: () => "",
      getWarning: (memberId) =>
        memberId === "m1" ? "Marked this service unavailable on intake" : "",
    });

    const avery = rows.find((row) => row.member.memberId === "m1");
    expect(avery?.eligible).toBe(true);
    expect(avery?.warning).toBe("Marked this service unavailable on intake");
    const morgan = rows.find((row) => row.member.memberId === "m2");
    expect(morgan?.warning).toBe("");
  });

  it("lists fully available members before those marked unavailable on intake", () => {
    const rows = buildScheduleMemberPickerMembers({
      members,
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: () => "",
      getWarning: (memberId) =>
        memberId === "m1" ? "Marked this service unavailable on intake" : "",
    });

    expect(rows.map((row) => row.member.memberId)).toEqual(["m2", "m1"]);
  });

  it("filters members by position and query", () => {
    const rows = buildScheduleMemberPickerMembers({
      members,
      positionId: "position-vocal",
      assignmentQuery: "mor",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: () => "",
    });

    expect(rows.map((row) => row.member.memberId)).toEqual(["m2"]);
  });

  it("marks ineligible members with issue text", () => {
    const rows = buildScheduleMemberPickerMembers({
      members,
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: (memberId) => (memberId === "m2" ? "Blocked out" : ""),
    });

    const morgan = rows.find((row) => row.member.memberId === "m2");
    expect(morgan?.eligible).toBe(false);
    expect(morgan?.issue).toBe("Blocked out");
  });

  it("lists available members before unavailable ones for the same position", () => {
    const rows = buildScheduleMemberPickerMembers({
      members,
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: (memberId) => (memberId === "m2" ? "Blocked out" : ""),
    });

    expect(rows.map((row) => row.member.memberId)).toEqual(["m1", "m2"]);
    expect(shouldShowScheduleMemberEligibilityGroupDivider(rows, 0)).toBe(
      false,
    );
    expect(shouldShowScheduleMemberEligibilityGroupDivider(rows, 1)).toBe(true);
  });

  it("lists available shadow candidates before position-qualified members who are blocked out", () => {
    const rows = buildScheduleMemberPickerMembers({
      members: [
        {
          memberId: "blocked",
          churchId: "c1",
          firstName: "Kevin",
          lastName: "Miller",
          positionIds: ["position-vocal"],
          blockoutDates: [],
        },
        {
          memberId: "shadow",
          churchId: "c1",
          firstName: "Enya-Kaye",
          lastName: "Lee",
          positionIds: ["position-drums"],
          blockoutDates: [],
        },
      ],
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "m1",
      hasPrimaryAssignee: true,
      duplicateFirstNames,
      getIssue: (memberId) => (memberId === "blocked" ? "Blocked out" : ""),
      getAssignmentActionIssues: (memberId) =>
        memberId === "blocked"
          ? {
              replace: "Blocked out",
              shadow: "Blocked out",
              reverseShadow: "Blocked out",
            }
          : {
              replace: "Not eligible for this position",
              shadow: "",
              reverseShadow: "Not eligible for this position",
            },
    });

    expect(rows.map((row) => row.member.memberId)).toEqual([
      "shadow",
      "blocked",
    ]);
    expect(shouldShowScheduleMemberEligibilityGroupDivider(rows, 1)).toBe(true);
  });

  it("excludes the current primary assignee from the list", () => {
    const rows = buildScheduleMemberPickerMembers({
      members,
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "m1",
      hasPrimaryAssignee: true,
      duplicateFirstNames,
      getIssue: () => "",
    });

    expect(rows.map((row) => row.member.memberId)).toEqual(["m2"]);
  });

  it("offers members outside the position as shadow candidates when occupied", () => {
    const rows = buildScheduleMemberPickerMembers({
      members,
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "m1",
      hasPrimaryAssignee: true,
      duplicateFirstNames,
      getIssue: () => "",
      // m3 only plays drums: it cannot replace or reverse-shadow a vocal slot,
      // but it can still be a plain shadow.
      getAssignmentActionIssues: (memberId) =>
        memberId === "m3"
          ? {
              replace: "Not eligible for this position",
              shadow: "",
              reverseShadow: "Not eligible for this position",
            }
          : { replace: "", shadow: "", reverseShadow: "" },
    });

    const drummer = rows.find((row) => row.member.memberId === "m3");
    expect(drummer?.eligible).toBe(true);
    expect(drummer?.usesSubmenu).toBe(true);
  });

  it("reports the shadow blocker, not 'not eligible', when a member is fully blocked", () => {
    const rows = buildScheduleMemberPickerMembers({
      members,
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "m1",
      hasPrimaryAssignee: true,
      duplicateFirstNames,
      getIssue: () => "",
      // m3 can't be primary/reverse-shadow (not eligible) AND can't even plain
      // shadow (blocked out). The real reason is the blockout, not eligibility.
      getAssignmentActionIssues: (memberId) =>
        memberId === "m3"
          ? {
              replace: "Not eligible for this position",
              shadow: "Blocked out",
              reverseShadow: "Not eligible for this position",
            }
          : { replace: "", shadow: "", reverseShadow: "" },
    });

    const drummer = rows.find((row) => row.member.memberId === "m3");
    expect(drummer?.eligible).toBe(false);
    expect(drummer?.issue).toBe("Blocked out");
  });

  it("lists position-qualified members before other shadow candidates when occupied", () => {
    const rows = buildScheduleMemberPickerMembers({
      members,
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "m1",
      hasPrimaryAssignee: true,
      duplicateFirstNames,
      getIssue: () => "",
      getAssignmentActionIssues: (memberId) =>
        memberId === "m3"
          ? {
              replace: "Not eligible for this position",
              shadow: "",
              reverseShadow: "Not eligible for this position",
            }
          : { replace: "", shadow: "", reverseShadow: "" },
    });

    expect(rows.map((row) => row.member.memberId)).toEqual(["m2", "m3"]);
  });

  it("shows a divider between position-qualified and other members", () => {
    const rows = buildScheduleMemberPickerMembers({
      members,
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "m1",
      hasPrimaryAssignee: true,
      duplicateFirstNames,
      getIssue: () => "",
      getAssignmentActionIssues: () => ({
        replace: "",
        shadow: "",
        reverseShadow: "",
      }),
    });

    expect(
      shouldShowScheduleMemberPositionGroupDivider(rows, 0, "position-vocal"),
    ).toBe(false);
    expect(
      shouldShowScheduleMemberPositionGroupDivider(rows, 1, "position-vocal"),
    ).toBe(true);
  });

  it("keeps the position filter when picking a primary", () => {
    const rows = buildScheduleMemberPickerMembers({
      members,
      positionId: "position-vocal",
      assignmentQuery: "",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: () => "",
    });

    expect(rows.map((row) => row.member.memberId)).toEqual(["m1", "m2"]);
  });

  it("detects submenu eligibility when slot is occupied", () => {
    const eligible = isSelectableScheduleMember({
      memberId: "m2",
      currentPrimaryMemberId: "m1",
      hasPrimaryAssignee: true,
      getIssue: () => "",
      getAssignmentActionIssues: () => ({
        replace: "",
        shadow: "",
        reverseShadow: "Already assigned",
      }),
    });

    expect(eligible).toBe(true);
  });

  it("prefers a member who fixes a lowest-level pairing on a multi-slot position", () => {
    const cameraPosition: TeamPosition = {
      positionId: "position-camera",
      churchId: "c1",
      teamId: "t1",
      name: "Camera",
      qualificationAreaId: "area-camera",
    };
    const levels: TeamQualificationLevel[] = [
      { levelId: "level-1", churchId: "c1", areaId: "area-camera", name: "Level 1", rank: 1 },
      { levelId: "level-2", churchId: "c1", areaId: "area-camera", name: "Level 2", rank: 2 },
      { levelId: "level-3", churchId: "c1", areaId: "area-camera", name: "Level 3", rank: 3 },
    ];
    const rookie: TeamRosterMember = {
      memberId: "rookie2",
      churchId: "c1",
      firstName: "Rory",
      lastName: "Rookie",
      positionIds: ["position-camera"],
      blockoutDates: [],
      qualifications: [
        { qualificationId: "q1", areaId: "area-camera", levelId: "level-1", status: "completed" },
      ],
    };
    const veteran: TeamRosterMember = {
      memberId: "veteran",
      churchId: "c1",
      firstName: "Val",
      lastName: "Veteran",
      positionIds: ["position-camera"],
      blockoutDates: [],
      qualifications: [
        { qualificationId: "q2", areaId: "area-camera", levelId: "level-2", status: "completed" },
      ],
    };

    expect(getMemberQualificationLevelRank(rookie, "area-camera", levels)).toBe(1);
    expect(getLowestLevelRank("area-camera", levels)).toBe(1);

    // A sibling camera slot is already filled by a level-1 person, so filling
    // the second slot should boost the level-2 candidate over another rookie.
    const boosts = computeLevelBalanceBoost({
      position: cameraPosition,
      requiredCountForOccurrence: 2,
      siblingAssignedMemberIds: ["rookie1"],
      members: [rookie, veteran],
      qualificationLevels: levels,
    });
    expect(boosts.get("veteran")).toBe(true);
    expect(boosts.get("rookie2")).toBe(false);

    const rows = buildScheduleMemberPickerMembers({
      members: [rookie, veteran],
      positionId: "position-camera",
      assignmentQuery: "",
      currentPrimaryMemberId: "",
      hasPrimaryAssignee: false,
      duplicateFirstNames,
      getIssue: () => "",
      recommendationStats: new Map([
        ["rookie2", { assignmentCount: 0, nearestAssignmentDistance: null, levelBalanceBoost: false }],
        ["veteran", { assignmentCount: 0, nearestAssignmentDistance: null, levelBalanceBoost: true }],
      ]),
    });

    expect(rows.map((row) => row.member.memberId)).toEqual(["veteran", "rookie2"]);
  });

  it("does not boost when no sibling is at the position's lowest level", () => {
    const cameraPosition: TeamPosition = {
      positionId: "position-camera",
      churchId: "c1",
      teamId: "t1",
      name: "Camera",
      qualificationAreaId: "area-camera",
    };
    const levels: TeamQualificationLevel[] = [
      { levelId: "level-1", churchId: "c1", areaId: "area-camera", name: "Level 1", rank: 1 },
      { levelId: "level-2", churchId: "c1", areaId: "area-camera", name: "Level 2", rank: 2 },
    ];
    const boosts = computeLevelBalanceBoost({
      position: cameraPosition,
      requiredCountForOccurrence: 2,
      siblingAssignedMemberIds: ["already-level-2"],
      members: [
        {
          memberId: "already-level-2",
          churchId: "c1",
          firstName: "Val",
          lastName: "Veteran",
          positionIds: ["position-camera"],
          blockoutDates: [],
          qualifications: [
            { qualificationId: "q1", areaId: "area-camera", levelId: "level-2", status: "completed" },
          ],
        },
      ],
      qualificationLevels: levels,
    });
    expect(boosts.size).toBe(0);
  });

  it("offers create member when typed name matches nobody", () => {
    expect(
      shouldOfferCreateMember({
        members,
        assignmentQuery: "New Person",
        duplicateFirstNames,
        canCreate: true,
      }),
    ).toBe(true);

    expect(
      shouldOfferCreateMember({
        members,
        assignmentQuery: "Avery",
        duplicateFirstNames,
        canCreate: true,
      }),
    ).toBe(false);
  });
});
