import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInviteAcceptedAccessLines,
  listEditableTeamScopeIds,
} from "./inviteAcceptedAccessSummary.js";

test("buildInviteAcceptedAccessLines labels admin access", () => {
  assert.deepEqual(
    buildInviteAcceptedAccessLines({
      role: "admin",
      appAccess: "full",
      permissions: { teams: "none", teamScopes: { "team-1": "edit" } },
    }),
    [
      "Role: Admin",
      "Teams: Edit all teams",
      "Services: Edit services and plans",
    ],
  );
});

test("buildInviteAcceptedAccessLines labels member app and teams access", () => {
  assert.deepEqual(
    buildInviteAcceptedAccessLines({
      role: "member",
      appAccess: "music",
      permissions: { teams: "view", teamScopes: {} },
    }),
    [
      "Controller: Music access",
      "Teams: View all teams",
      "Services: No service access",
    ],
  );
});

test("Teams Edit is not summarized as Services Edit", () => {
  assert.deepEqual(
    buildInviteAcceptedAccessLines({
      role: "member",
      appAccess: "full",
      permissions: { teams: "edit", services: "none", teamScopes: {} },
    }),
    [
      "Controller: Full access",
      "Teams: Edit all teams",
      "Services: No service access",
    ],
  );
});

test("buildInviteAcceptedAccessLines includes named per-team edit scopes", () => {
  assert.deepEqual(
    buildInviteAcceptedAccessLines({
      role: "member",
      appAccess: "full",
      permissions: {
        teams: "none",
        teamScopes: { "team-a": "edit", "team-b": "edit" },
      },
      scopedTeamNames: ["Choir", "Worship Team"],
    }),
    [
      "Controller: Full access",
      "Teams: Can edit Choir, Worship Team only",
      "Services: No service access",
    ],
  );
});

test("legacy appAccess member summarizes as Controller None and keeps Services view", () => {
  assert.deepEqual(
    buildInviteAcceptedAccessLines({
      role: "member",
      appAccess: "member",
      permissions: {
        teams: "none",
        services: "view",
        teamScopes: { worship: "edit" },
      },
    }),
    [
      "Controller: None",
      "Teams: Per-team edit only",
      "Services: View services",
    ],
  );
});

test("buildInviteAcceptedAccessLines falls back when scoped names are missing", () => {
  assert.deepEqual(
    buildInviteAcceptedAccessLines({
      role: "member",
      appAccess: "view",
      permissions: {
        teams: "view",
        teamScopes: { "team-a": "edit" },
      },
    }),
    [
      "Controller: View access",
      "Teams: View all teams + per-team edit",
      "Services: No service access",
    ],
  );
});

test("listEditableTeamScopeIds returns sorted edit scopes", () => {
  assert.deepEqual(
    listEditableTeamScopeIds({
      teams: "none",
      teamScopes: {
        "team-b": "edit",
        "team-a": "view",
        "team-c": "edit",
      },
    }),
    ["team-b", "team-c"].sort(),
  );
});
