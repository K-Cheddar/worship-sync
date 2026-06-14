import type { TeamRosterMember } from "../../../api/authTypes";
import {
  buildScheduleMemberPickerMembers,
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
    expect(
      shouldShowScheduleMemberEligibilityGroupDivider(
        rows,
        0,
        "position-vocal",
      ),
    ).toBe(false);
    expect(
      shouldShowScheduleMemberEligibilityGroupDivider(
        rows,
        1,
        "position-vocal",
      ),
    ).toBe(true);
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
