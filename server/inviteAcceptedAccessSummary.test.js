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
      "Access: Admin",
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
      "Access: Music access",
      "Teams: View all teams",
      "Services: No service editing",
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
      "Access: Full access",
      "Teams: Can edit Choir, Worship Team only",
      "Services: No service editing",
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
      "Access: View access",
      "Teams: View all teams + per-team edit",
      "Services: No service editing",
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
