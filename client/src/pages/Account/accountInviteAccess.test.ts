import {
  buildPermissionsFromAccessDraft,
  getInviteAccessSummaryLabel,
  inviteAccessOptions,
  inviteAccessDraftFromInvite,
  resolveInviteAccessPayload,
  scopedTeamsHelperText,
} from "./accountInviteAccess";

describe("accountInviteAccess", () => {
  it("builds scoped team permissions for invite drafts", () => {
    expect(
      buildPermissionsFromAccessDraft({
        role: "member",
        teamsAccess: "none",
        servicesAccess: "none",
        teamScopeIds: ["team-a", "team-b"],
      }),
    ).toEqual({
      teams: "none",
      services: "none",
      teamScopes: {
        "team-a": "edit",
        "team-b": "edit",
      },
    });
  });

  it("clears team scopes when global Teams edit is selected", () => {
    expect(
      buildPermissionsFromAccessDraft({
        role: "member",
        teamsAccess: "edit",
        servicesAccess: "none",
        teamScopeIds: ["team-a"],
      }),
    ).toEqual({
      teams: "edit",
      services: "none",
      teamScopes: {},
    });
  });

  it("keeps Team scopes and Services permissions independent with no Controller access", () => {
    expect(
      buildPermissionsFromAccessDraft({
        role: "member",
        teamsAccess: "none",
        servicesAccess: "view",
        teamScopeIds: ["worship"],
      }),
    ).toEqual({
      teams: "none",
      services: "view",
      teamScopes: { worship: "edit" },
    });
  });

  it("serializes Controller None with scoped Teams and Services access", () => {
    const payload = resolveInviteAccessPayload({
      role: "member",
      controllerAccess: "none",
      teamsAccess: "none",
      servicesAccess: "view",
      teamScopeIds: ["worship"],
    });
    expect(payload).toEqual({
      role: "member",
      controllerAccess: "none",
      appAccess: "member",
      permissions: {
        teams: "none",
        services: "view",
        teamScopes: { worship: "edit" },
      },
    });
  });

  it("summarizes independent capabilities compactly", () => {
    expect(
      getInviteAccessSummaryLabel({
        role: "member",
        controllerAccess: "none",
        teamsAccess: "none",
        servicesAccess: "view",
        teamScopeIds: ["worship"],
      }),
    ).toBe("No controller access · Selected team manager · View services");
  });

  it("offers Controller None without a Member access option", () => {
    expect(inviteAccessOptions.map((option) => option.value)).toEqual(["none", "view", "music", "full"]);
    expect(inviteAccessOptions.map((option) => option.label)).not.toContain("Member access");
  });

  it("resolves invite payloads with admin Teams access", () => {
    expect(
      resolveInviteAccessPayload({
        role: "admin",
        controllerAccess: "full",
        teamsAccess: "none",
        servicesAccess: "none",
        teamScopeIds: [],
      }),
    ).toEqual({
      role: "admin",
      controllerAccess: "full",
      appAccess: "full",
      permissions: {
        teams: "edit",
        services: "edit",
        teamScopes: {},
      },
    });
  });

  it("hydrates invite drafts from pending invite records", () => {
    expect(
      inviteAccessDraftFromInvite({
        role: "member",
        controllerAccess: "none",
        appAccess: "full",
        permissions: {
          teams: "none",
          teamScopes: { "team-main": "edit" },
        },
      }),
    ).toEqual({
      role: "member",
      controllerAccess: "none",
      teamsAccess: "none",
      servicesAccess: "none",
      teamScopeIds: ["team-main"],
    });
  });

  it("identifies standalone service editing in the invite summary", () => {
    expect(
      getInviteAccessSummaryLabel({
        role: "member",
        controllerAccess: "full",
        teamsAccess: "none",
        servicesAccess: "edit",
        teamScopeIds: [],
      }),
    ).toBe("Full controller · Edit services");
  });

  it("explains roster read access and independent team management", () => {
    expect(scopedTeamsHelperText("none", false)).toBe(
      "Team membership gives read-only access automatically. Select teams here to let this person manage them. They don't need to be on a team's roster.",
    );
  });
});
