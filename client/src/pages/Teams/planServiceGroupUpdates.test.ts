import type { TeamService } from "../../api/authTypes";
import {
  planServiceGroupCleanupOnDelete,
  planServiceGroupUpdates,
} from "./teamsUtils";

const service = (overrides: Partial<TeamService>): TeamService => ({
  id: overrides.serviceId || "service",
  serviceId: overrides.serviceId || "service",
  churchId: "church-1",
  name: "Service",
  timerType: "countdown",
  reccurence: "weekly",
  dayOfWeek: 0,
  time: "10:00",
  ...overrides,
});

describe("planServiceGroupUpdates", () => {
  it("creates a shared group id for newly combined services", () => {
    const services = [
      service({ serviceId: "first" }),
      service({ serviceId: "second" }),
    ];

    const { groupId, partnerUpdates } = planServiceGroupUpdates({
      services,
      serviceId: "first",
      partnerIds: ["second"],
    });

    expect(groupId).toBeTruthy();
    expect(partnerUpdates).toEqual([
      { id: "second", serviceGroupId: groupId },
    ]);
  });

  it("reuses the edited service's existing group id so occurrence ids stay stable", () => {
    const services = [
      service({ serviceId: "first", serviceGroupId: "sunday-am" }),
      service({ serviceId: "second", serviceGroupId: "sunday-am" }),
      service({ serviceId: "third" }),
    ];

    const { groupId, partnerUpdates } = planServiceGroupUpdates({
      services,
      serviceId: "first",
      currentGroupId: "sunday-am",
      partnerIds: ["second", "third"],
    });

    expect(groupId).toBe("sunday-am");
    // "second" already in the group needs no write; "third" joins it.
    expect(partnerUpdates).toEqual([{ id: "third", serviceGroupId: "sunday-am" }]);
  });

  it("clears the group when no partners remain selected", () => {
    const services = [
      service({ serviceId: "first", serviceGroupId: "sunday-am" }),
      service({ serviceId: "second", serviceGroupId: "sunday-am" }),
    ];

    const { groupId, partnerUpdates } = planServiceGroupUpdates({
      services,
      serviceId: "first",
      currentGroupId: "sunday-am",
      partnerIds: [],
    });

    expect(groupId).toBeUndefined();
    // The unchecked former partner leaves the group too.
    expect(partnerUpdates).toEqual([{ id: "second", serviceGroupId: undefined }]);
  });

  it("removes only the unchecked partner when others stay grouped", () => {
    const services = [
      service({ serviceId: "first", serviceGroupId: "sunday-am" }),
      service({ serviceId: "second", serviceGroupId: "sunday-am" }),
      service({ serviceId: "third", serviceGroupId: "sunday-am" }),
    ];

    const { groupId, partnerUpdates } = planServiceGroupUpdates({
      services,
      serviceId: "first",
      currentGroupId: "sunday-am",
      partnerIds: ["second"],
    });

    expect(groupId).toBe("sunday-am");
    expect(partnerUpdates).toEqual([{ id: "third", serviceGroupId: undefined }]);
  });

  it("dissolves a partner's former group when pulling it leaves one member behind", () => {
    // G1 = {A, B}, G2 = {C, D}. Editing C and combining with A pulls A out of G1,
    // which would strand B alone — so B must be cleared too.
    const services = [
      service({ serviceId: "A", serviceGroupId: "G1" }),
      service({ serviceId: "B", serviceGroupId: "G1" }),
      service({ serviceId: "C", serviceGroupId: "G2" }),
      service({ serviceId: "D", serviceGroupId: "G2" }),
    ];

    const { groupId, partnerUpdates } = planServiceGroupUpdates({
      services,
      serviceId: "C",
      currentGroupId: "G2",
      partnerIds: ["A", "D"],
    });

    expect(groupId).toBe("G2");
    expect(partnerUpdates).toContainEqual({ id: "A", serviceGroupId: "G2" });
    expect(partnerUpdates).toContainEqual({ id: "B", serviceGroupId: undefined });
    // D was already in G2 and stays, so it needs no write.
    expect(partnerUpdates).not.toContainEqual(
      expect.objectContaining({ id: "D" }),
    );
  });
});

describe("planServiceGroupCleanupOnDelete", () => {
  it("dissolves a two-member group by clearing the survivor", () => {
    const services = [
      service({ serviceId: "first", serviceGroupId: "sunday-am" }),
      service({ serviceId: "second", serviceGroupId: "sunday-am" }),
    ];

    expect(
      planServiceGroupCleanupOnDelete({ services, serviceId: "first" }),
    ).toEqual({
      partnerUpdates: [{ id: "second", serviceGroupId: undefined }],
    });
  });

  it("keeps the group intact when two or more members remain", () => {
    const services = [
      service({ serviceId: "first", serviceGroupId: "sunday-am" }),
      service({ serviceId: "second", serviceGroupId: "sunday-am" }),
      service({ serviceId: "third", serviceGroupId: "sunday-am" }),
    ];

    expect(
      planServiceGroupCleanupOnDelete({ services, serviceId: "first" }),
    ).toEqual({ partnerUpdates: [] });
  });

  it("does nothing for an ungrouped service", () => {
    const services = [
      service({ serviceId: "first" }),
      service({ serviceId: "second", serviceGroupId: "sunday-am" }),
    ];

    expect(
      planServiceGroupCleanupOnDelete({ services, serviceId: "first" }),
    ).toEqual({ partnerUpdates: [] });
  });
});
