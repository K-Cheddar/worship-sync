import type {
  TeamRecord,
  TeamPosition,
  TeamRosterMember,
  TeamSchedule,
  TeamService,
} from "../../api/authTypes";
import {
  applyTeamEntityDeletionLocally,
  describeDeletionImpacts,
} from "./teamsUtils";
import type { TeamsData } from "./types";

const position = (positionId: string, teamId: string, name = positionId): TeamPosition => ({
  positionId,
  churchId: "c",
  teamId,
  name,
});
const member = (memberId: string, positionIds: string[] = []): TeamRosterMember => ({
  memberId,
  churchId: "c",
  firstName: memberId,
  lastName: "X",
  positionIds,
  blockoutDates: [],
});
const team = (
  teamId: string,
  name: string,
  memberIds: string[] = [],
): TeamRecord => ({ teamId, churchId: "c", name, memberIds });
const service = (
  serviceId: string,
  name: string,
  positionRequirements?: { positionId: string; count: number }[],
): TeamService => ({
  id: serviceId,
  serviceId,
  churchId: "c",
  name,
  timerType: "countdown",
  reccurence: "weekly",
  positionRequirements,
});
const schedule = (
  scheduleId: string,
  name: string,
  teamId: string,
  assignments: TeamSchedule["assignments"],
  extra: Partial<TeamSchedule> = {},
): TeamSchedule => ({
  scheduleId,
  churchId: "c",
  name,
  teamId,
  serviceIds: [],
  assignments,
  ...extra,
});

const buildData = (overrides: Partial<TeamsData>): TeamsData => ({
  members: [],
  positions: [],
  teams: [],
  teamRoles: [],
  qualificationAreas: [],
  qualificationLevels: [],
  services: [],
  schedules: [],
  intakeForms: [],
  intakeSubmissions: [],
  ...overrides,
});

describe("describeDeletionImpacts", () => {
  it("reports a position's members, service requirements, and assignments (incl. slots)", () => {
    const data = buildData({
      positions: [position("camera", "t1", "Camera")],
      teams: [team("t1", "Sunday Team")],
      members: [member("m1", ["camera"]), member("m2", ["camera"])],
      services: [service("s1", "9AM", [{ positionId: "camera", count: 2 }])],
      schedules: [
        schedule("sch1", "July", "t1", {
          occ1: {
            "camera::0": { primaryMemberId: "m1" },
            "camera::1": { primaryMemberId: "m2" },
          },
        }),
      ],
    });
    const impacts = describeDeletionImpacts("position", "camera", data);
    expect(impacts).toEqual([
      "Unassigned from 2 members",
      "Removed from position requirements on 1 service (9AM)",
      "Cleared from 2 schedule assignments",
    ]);
  });

  it("returns no impacts for an unused position", () => {
    const data = buildData({ positions: [position("solo", "t1")] });
    expect(describeDeletionImpacts("position", "solo", data)).toEqual([]);
  });

  it("reports a member's teams and assignments", () => {
    const data = buildData({
      members: [member("m1")],
      teams: [team("t1", "A", ["m1"]), team("t2", "B", ["m1"])],
      schedules: [
        schedule("sch1", "July", "t1", {
          occ1: {
            "camera::0": { primaryMemberId: "m1" },
            "vocal::0": { primaryMemberId: "someoneElse" },
          },
        }),
      ],
    });
    const impacts = describeDeletionImpacts("member", "m1", data);
    expect(impacts).toEqual([
      "Removed from 2 teams (A, B)",
      "Cleared from 1 schedule assignment",
    ]);
  });

  it("reports a team's owned positions, their downstream, and orphaned schedules", () => {
    const data = buildData({
      positions: [position("camera", "t1", "Camera")],
      teams: [team("t1", "Sunday Team")],
      members: [member("m1", ["camera"])],
      services: [service("s1", "9AM", [{ positionId: "camera", count: 1 }])],
      schedules: [schedule("sch1", "July", "t1", { occ1: { "camera::0": { primaryMemberId: "m1" } } })],
    });
    expect(describeDeletionImpacts("team", "t1", data)).toEqual([
      "Deletes 1 position (Camera)",
      "Unassigned from 1 member",
      "Removed from position requirements on 1 service (9AM)",
      "Cleared from 1 schedule assignment",
      "1 schedule will lose this team and stop showing assignments (July)",
    ]);
  });

  it("matches schedules that reference a service by id or occurrence", () => {
    const data = buildData({
      services: [service("svc", "9AM")],
      schedules: [
        schedule("sch1", "July", "t1", {}, { serviceIds: ["svc"] }),
        schedule("sch2", "August", "t1", {}, {
          occurrences: [
            { occurrenceId: "o1", serviceId: "svc", name: "Sun", startsAt: "2026-08-02T10:00:00.000Z" },
          ],
        }),
      ],
    });
    expect(describeDeletionImpacts("service", "svc", data)).toEqual([
      "2 schedules include this service and will lose its dates (July, August)",
    ]);
  });
});

describe("applyTeamEntityDeletionLocally", () => {
  it("removes a deleted member from teams, assignments, shadows, and attendance", () => {
    const data = buildData({
      members: [member("m1"), member("m2")],
      teams: [team("t1", "A", ["m1", "m2"])],
      schedules: [
        schedule(
          "sch1",
          "July",
          "t1",
          {
            occ1: {
              "camera::0": {
                primaryMemberId: "m1",
                shadows: [{ memberId: "m2", kind: "shadow" }],
              },
              "vocal::0": {
                primaryMemberId: "m2",
                shadows: [{ memberId: "m1", kind: "reverse_shadow" }],
              },
            },
          },
          {
            attendance: {
              occ1: {
                m1: { status: "absent" },
                m2: { status: "present" },
              },
            },
          },
        ),
      ],
    });

    const next = applyTeamEntityDeletionLocally(data, "members", "m1");

    expect(next.members.map((item) => item.memberId)).toEqual(["m2"]);
    expect(next.teams[0].memberIds).toEqual(["m2"]);
    expect(next.schedules[0].assignments.occ1).toEqual({
      "camera::0": { shadows: [{ memberId: "m2", kind: "shadow" }] },
      "vocal::0": { primaryMemberId: "m2" },
    });
    expect(next.schedules[0].attendance?.occ1).toEqual({
      m2: { status: "present" },
    });
  });

  it("removes a deleted team and cascades its owned scheduling metadata locally", () => {
    const data = buildData({
      teams: [team("t1", "A"), team("t2", "B")],
      positions: [position("camera", "t1"), position("vocal", "t2")],
      teamRoles: [
        { roleId: "role1", churchId: "c", teamId: "t1", name: "Lead" },
      ],
      qualificationAreas: [
        { areaId: "area1", churchId: "c", teamId: "t1", name: "Camera" },
      ],
      qualificationLevels: [
        { levelId: "level1", churchId: "c", areaId: "area1", name: "One", rank: 1 },
      ],
      members: [
        {
          ...member("m1", ["camera", "vocal"]),
          teamMemberships: { t1: { teamId: "t1", roleId: "role1" } },
          qualifications: [
            {
              qualificationId: "q1",
              areaId: "area1",
              teamId: "t1",
              status: "completed",
            },
          ],
        },
      ],
      schedules: [
        schedule("sch1", "July", "t1", {
          occ1: {
            "camera::0": { primaryMemberId: "m1" },
            "vocal::0": { primaryMemberId: "m1" },
          },
        }),
      ],
    });

    const next = applyTeamEntityDeletionLocally(data, "teams", "t1");

    expect(next.teams.map((item) => item.teamId)).toEqual(["t2"]);
    expect(next.positions.map((item) => item.positionId)).toEqual(["vocal"]);
    expect(next.teamRoles).toEqual([]);
    expect(next.qualificationAreas).toEqual([]);
    expect(next.qualificationLevels).toEqual([]);
    expect(next.members[0].positionIds).toEqual(["vocal"]);
    expect(next.members[0].teamMemberships).toEqual({});
    expect(next.members[0].qualifications).toEqual([]);
    expect(next.schedules[0].assignments.occ1).toEqual({
      "vocal::0": { primaryMemberId: "m1" },
    });
  });
});
