import {
  formatEntitySaveToast,
  formatIntakeFormSaveToast,
  formatMemberSaveToast,
  formatPositionSaveToast,
  formatQualificationAreaSaveToast,
  formatQualificationLevelSaveToast,
  formatScheduleSaveToast,
  formatServiceSaveToast,
  formatTeamSaveToast,
  formatTeamRoleSaveToast,
} from "./teamsSaveToasts";
import type {
  TeamIntakeForm,
  TeamPosition,
  TeamQualificationArea,
  TeamQualificationLevel,
  TeamRecord,
  TeamRole,
  TeamRosterMember,
  TeamSchedule,
  TeamService,
} from "../../api/authTypes";

describe("teamsSaveToasts", () => {
  describe("formatEntitySaveToast", () => {
    it("formats create, empty update, and change list messages", () => {
      expect(formatEntitySaveToast("", true, [], "Fallback")).toBe(
        "Added Fallback.",
      );
      expect(formatEntitySaveToast("Choir", false, [])).toBe("Saved Choir.");
      expect(formatEntitySaveToast("Choir", false, ["Name", "Members"])).toBe(
        "Updated Choir: Name; Members.",
      );
    });
  });

  describe("formatTeamSaveToast", () => {
    const previous: TeamRecord = {
      teamId: "team-1",
      churchId: "church",
      name: "Worship",
      description: "Band",
      icon: "mic",
      memberIds: ["m1"],
    };

    it("reports create and member/name/icon updates", () => {
      expect(
        formatTeamSaveToast(
          null,
          {
            name: "Worship",
            description: "",
            icon: "",
            memberIds: [],
          },
          { memberNameById: new Map() },
        ),
      ).toBe("Added Worship.");

      expect(
        formatTeamSaveToast(
          previous,
          {
            name: "Worship Team",
            description: "Band",
            icon: "guitar",
            memberIds: ["m1", "m2"],
          },
          { memberNameById: new Map([["m2", "Alex"]]) },
        ),
      ).toBe("Updated Worship Team: Name; Icon; Members: added Alex.");
    });
  });

  describe("formatMemberSaveToast", () => {
    it("reports create and field updates", () => {
      const previous = {
        memberId: "m1",
        churchId: "church",
        firstName: "Pat",
        lastName: "Lee",
        dateOfBirth: "",
        isMinor: false,
        servingFrequency: "as_needed",
        positionIds: ["p1"],
        desiredPositionIds: [],
        qualifications: [],
        blockoutDates: [],
      } as TeamRosterMember;

      expect(
        formatMemberSaveToast(
          null,
          {
            firstName: "Pat",
            lastName: "Lee",
            dateOfBirth: "",
            isMinor: false,
            servingFrequency: "weekly",
            positionIds: [],
            desiredPositionIds: [],
            teamMemberships: {},
            qualifications: [],
            blockoutDates: [],
          },
          {
            positionNameById: new Map(),
            teamNameById: new Map(),
            roleNameById: new Map(),
          },
        ),
      ).toBe("Added Pat Lee.");

      expect(
        formatMemberSaveToast(
          previous,
          {
            firstName: "Pat",
            lastName: "Lee",
            dateOfBirth: "",
            isMinor: false,
            servingFrequency: "weekly",
            positionIds: ["p1", "p2"],
            desiredPositionIds: [],
            teamMemberships: {},
            qualifications: [],
            blockoutDates: [],
          },
          {
            positionNameById: new Map([
              ["p1", "Vocals"],
              ["p2", "Keys"],
            ]),
            teamNameById: new Map(),
            roleNameById: new Map(),
          },
        ),
      ).toContain("Updated Pat Lee:");
    });
  });

  describe("formatPositionSaveToast / formatTeamRoleSaveToast", () => {
    it("reports creates and named field changes", () => {
      const position = {
        positionId: "p1",
        churchId: "church",
        name: "Camera",
        description: "",
        icon: "cam",
      } as TeamPosition;
      expect(
        formatPositionSaveToast(null, {
          name: "Camera",
          description: "",
          icon: "",
        }),
      ).toBe("Added Camera.");
      expect(
        formatPositionSaveToast(position, {
          name: "Camera Op",
          description: "Front",
          icon: "cam",
        }),
      ).toBe("Updated Camera Op: Name; Description.");

      const role = {
        roleId: "r1",
        churchId: "church",
        teamId: "t1",
        name: "Leader",
        description: "",
      } as TeamRole;
      expect(
        formatTeamRoleSaveToast(null, {
          teamId: "t1",
          name: "Leader",
          description: "",
        }),
      ).toBe("Added Leader.");
      expect(
        formatTeamRoleSaveToast(role, {
          teamId: "t1",
          name: "Team Leader",
          description: "Runs rehearsal",
        }),
      ).toBe("Updated Team Leader: Name; Description.");
    });
  });

  describe("formatScheduleSaveToast / formatServiceSaveToast", () => {
    it("reports schedule and service updates", () => {
      const schedule = {
        scheduleId: "s1",
        churchId: "church",
        teamId: "t1",
        name: "July",
        description: "",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        serviceIds: ["svc-1"],
        occurrences: [],
        assignments: {},
      } as TeamSchedule;

      expect(
        formatScheduleSaveToast(
          null,
          {
            teamId: "t1",
            name: "July",
            description: "",
            startDate: "2026-07-01",
            endDate: "2026-07-31",
            serviceIds: ["svc-1"],
          },
          { teamNameById: new Map() },
        ),
      ).toBe("Added July.");

      expect(
        formatScheduleSaveToast(
          schedule,
          {
            teamId: "t2",
            name: "August",
            description: "Fall",
            startDate: "2026-08-01",
            endDate: "2026-08-31",
            serviceIds: ["svc-1", "svc-2"],
          },
          {
            teamNameById: new Map([["t2", "Production"]]),
            serviceNameById: new Map([["svc-2", "Evening"]]),
          },
        ),
      ).toContain("Updated August:");

      const service = {
        serviceId: "svc-1",
        name: "Morning",
        dayOfWeek: 0,
        hour: 10,
        minute: 0,
        period: "AM",
        positionRequirements: [{ positionId: "p1", count: 1 }],
      } as TeamService;

      expect(
        formatServiceSaveToast(
          null,
          { ...service, name: "Morning Service" },
          [],
          [],
        ),
      ).toBe("Added Morning Service.");

      expect(
        formatServiceSaveToast(
          service,
          {
            ...service,
            name: "Morning Service",
            hour: 11,
            positionRequirements: [{ positionId: "p1", count: 2 }],
          },
          ["svc-2"],
          [{ ...service, serviceId: "svc-2", name: "Evening" }],
        ),
      ).toContain("Updated Morning Service:");
    });
  });

  describe("qualification and intake toasts", () => {
    it("reports create and update for areas, levels, and intake forms", () => {
      const area = {
        areaId: "a1",
        churchId: "church",
        name: "Music",
        description: "",
      } as TeamQualificationArea;
      expect(
        formatQualificationAreaSaveToast(null, {
          name: "Music",
          description: "",
        }),
      ).toBe("Added Music.");
      expect(
        formatQualificationAreaSaveToast(area, {
          name: "Music Theory",
          description: "Basics",
        }),
      ).toBe("Updated Music Theory: Name; Description.");

      const level = {
        levelId: "l1",
        churchId: "church",
        areaId: "a1",
        name: "Beginner",
        description: "",
        rank: 1,
      } as TeamQualificationLevel;
      expect(
        formatQualificationLevelSaveToast(null, {
          areaId: "a1",
          name: "Beginner",
          description: "",
          rank: 1,
        }),
      ).toBe("Added Beginner.");
      expect(
        formatQualificationLevelSaveToast(level, {
          areaId: "a1",
          name: "Intermediate",
          description: "Next step",
          rank: 2,
        }),
      ).toBe("Updated Intermediate: Name; Description; Rank.");

      const form = {
        formId: "f1",
        churchId: "church",
        name: "Fall Intake",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        availabilityServices: [],
        availabilityOccurrences: [],
        teamIds: ["t1"],
        active: true,
        welcomeMessage: "Hi",
      } as TeamIntakeForm;
      expect(
        formatIntakeFormSaveToast(
          null,
          {
            name: "Fall Intake",
            startDate: "2026-08-01",
            endDate: "2026-08-31",
            availabilityServices: [],
            availabilityOccurrences: [],
            teamIds: ["t1"],
            active: true,
            welcomeMessage: "Hi",
          },
          { teamNameById: new Map() },
        ),
      ).toBe("Added Fall Intake.");
      expect(
        formatIntakeFormSaveToast(
          form,
          {
            name: "Fall Intake 2",
            startDate: "2026-09-01",
            endDate: "2026-09-30",
            availabilityServices: [],
            availabilityOccurrences: [],
            teamIds: ["t1", "t2"],
            active: false,
            welcomeMessage: "Welcome",
          },
          { teamNameById: new Map([["t2", "Production"]]) },
        ),
      ).toContain("Updated Fall Intake 2:");
    });
  });
});
