import type { TeamRosterMember } from "../../api/authTypes";
import type { TeamRosterMemberPayload } from "../../api/auth";
import {
  describeMemberSaveChanges,
  formatEntitySaveToast,
  formatMemberSaveToast,
  formatTeamSaveToast,
  type MemberSaveChangeContext,
} from "./teamsSaveToasts";

const context: MemberSaveChangeContext = {
  positionNameById: new Map([
    ["p1", "Camera"],
    ["p2", "Sound"],
    ["p3", "Drums"],
  ]),
  teamNameById: new Map([["t1", "Worship Team"]]),
  roleNameById: new Map([
    ["r1", "Team Lead"],
    ["r2", "Member"],
  ]),
};

const member = (
  overrides: Partial<TeamRosterMember> = {},
): TeamRosterMember => ({
  memberId: "m1",
  churchId: "c1",
  firstName: "Jane",
  lastName: "Doe",
  positionIds: ["p1"],
  desiredPositionIds: [],
  teamMemberships: {
    t1: { teamId: "t1", roleId: "r2" },
  },
  qualifications: [],
  blockoutDates: [],
  notes: "",
  ...overrides,
});

const payload = (
  overrides: Partial<TeamRosterMemberPayload> = {},
): TeamRosterMemberPayload => ({
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "",
  positionIds: ["p1"],
  desiredPositionIds: [],
  teamMemberships: {
    t1: { teamId: "t1", roleId: "r2" },
  },
  qualifications: [],
  blockoutDates: [],
  notes: "",
  ...overrides,
});

describe("formatEntitySaveToast", () => {
  it("formats create, unchanged, and updated messages", () => {
    expect(formatEntitySaveToast("Camera", true, [], "Position")).toBe(
      "Added Camera.",
    );
    expect(formatEntitySaveToast("Camera", false, [], "Position")).toBe(
      "Saved Camera.",
    );
    expect(
      formatEntitySaveToast("Camera", false, ["Description"], "Position"),
    ).toBe("Updated Camera: Description.");
  });
});

describe("formatTeamSaveToast", () => {
  it("reports member roster changes", () => {
    expect(
      formatTeamSaveToast(
        {
          teamId: "t1",
          churchId: "c1",
          name: "Worship Team",
          memberIds: ["m1"],
        },
        {
          name: "Worship Team",
          description: "",
          icon: "",
          memberIds: ["m1", "m2"],
        },
        {
          memberNameById: new Map([
            ["m1", "Jane Doe"],
            ["m2", "John Smith"],
          ]),
        },
      ),
    ).toBe("Updated Worship Team: Members: added John Smith.");
  });
});

describe("describeMemberSaveChanges", () => {
  it("reports scalar and collection changes", () => {
    const changes = describeMemberSaveChanges(
      member(),
      payload({
        firstName: "Janet",
        positionIds: ["p1", "p2"],
        notes: "Updated notes",
        teamMemberships: {
          t1: { teamId: "t1", roleId: "r1" },
        },
      }),
      context,
    );

    expect(changes).toEqual([
      "Name",
      "Notes",
      "Positions: added Sound",
      "Worship Team role: Member → Team Lead",
    ]);
  });

  it("reports removed positions and desired positions", () => {
    const changes = describeMemberSaveChanges(
      member({ desiredPositionIds: ["p3"] }),
      payload({
        positionIds: [],
        desiredPositionIds: [],
      }),
      context,
    );

    expect(changes).toEqual([
      "Positions: removed Camera",
      "Desired positions: removed Drums",
    ]);
  });
});

describe("formatMemberSaveToast", () => {
  it("describes a new member", () => {
    expect(formatMemberSaveToast(null, payload(), context)).toBe(
      "Added Jane Doe.",
    );
  });

  it("describes updated fields", () => {
    expect(
      formatMemberSaveToast(
        member(),
        payload({ notes: "Call before scheduling." }),
        context,
      ),
    ).toBe("Updated Jane Doe: Notes.");
  });
});
