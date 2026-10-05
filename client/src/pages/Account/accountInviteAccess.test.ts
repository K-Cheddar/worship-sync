import {
  buildPermissionsFromAccessDraft,
  getInviteAccessSummaryLabel,
  inviteAccessDraftFromInvite,
  resolveInviteAccessPayload,
  scopedTeamsHelperText,
} from "./accountInviteAccess";

describe("accountInviteAccess", () => {
  it("builds scoped team permissions for invite drafts", () => {
    expect(
      buildPermissionsFromAccessDraft({
        access: "full",
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
        access: "full",
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

  it("resolves invite payloads with admin Teams access", () => {
    expect(
      resolveInviteAccessPayload({
        access: "admin",
        teamsAccess: "none",
        servicesAccess: "none",
        teamScopeIds: [],
      }),
    ).toEqual({
      role: "admin",
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
        appAccess: "full",
        permissions: {
          teams: "none",
          teamScopes: { "team-main": "edit" },
        },
      }),
    ).toEqual({
      access: "full",
      teamsAccess: "none",
      servicesAccess: "none",
      teamScopeIds: ["team-main"],
    });
  });

  it("identifies standalone service editing in the invite summary", () => {
    expect(
      getInviteAccessSummaryLabel({
        access: "full",
        teamsAccess: "none",
        servicesAccess: "edit",
        teamScopeIds: [],
      }),
    ).toBe("Full access · No Teams access · Edit services and plans");
  });

  it("explains roster read access and independent team management", () => {
    expect(scopedTeamsHelperText("none", false)).toBe(
      "Team membership gives read-only access automatically. Select teams here to let this person manage them. They don't need to be on a team's roster.",
    );
  });
});
