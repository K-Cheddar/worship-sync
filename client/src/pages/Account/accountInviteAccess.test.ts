import {
  buildPermissionsFromAccessDraft,
  inviteAccessDraftFromInvite,
  resolveInviteAccessPayload,
} from "./accountInviteAccess";

describe("accountInviteAccess", () => {
  it("builds scoped team permissions for invite drafts", () => {
    expect(
      buildPermissionsFromAccessDraft({
        access: "full",
        teamsAccess: "none",
        teamScopeIds: ["team-a", "team-b"],
      }),
    ).toEqual({
      teams: "none",
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
        teamScopeIds: ["team-a"],
      }),
    ).toEqual({
      teams: "edit",
      teamScopes: {},
    });
  });

  it("resolves invite payloads with admin Teams access", () => {
    expect(
      resolveInviteAccessPayload({
        access: "admin",
        teamsAccess: "none",
        teamScopeIds: [],
      }),
    ).toEqual({
      role: "admin",
      appAccess: "full",
      permissions: {
        teams: "edit",
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
      teamScopeIds: ["team-main"],
    });
  });
});
