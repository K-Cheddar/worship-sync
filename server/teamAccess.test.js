import test from "node:test";
import assert from "node:assert/strict";
import {
  canEditTeam,
  canViewTeam,
  resolveEffectiveTeamAccess,
} from "./teamAccess.js";

const bootstrap = ({
  role = "member",
  teams = "none",
  teamScopes = {},
  services = "none",
  uid = "user-1",
  sessionKind = "human",
} = {}) => ({
  role,
  sessionKind,
  churchId: "church-1",
  user: { uid },
  permissions: { teams, services, teamScopes },
});

const records = ({
  members = [],
  teams = [
    { teamId: "worship", churchId: "church-1", memberIds: [] },
    { teamId: "av", churchId: "church-1", memberIds: [] },
    { teamId: "youth", churchId: "church-1", memberIds: [] },
  ],
} = {}) => ({ members, teams });

const resolve = (user, data = records(), churchId = "church-1") =>
  resolveEffectiveTeamAccess({ bootstrap: user, churchId, ...data });

const assertTeamAccess = (access, teamId, { view, edit }) => {
  assert.equal(canViewTeam(access, teamId), view, `${teamId} view`);
  assert.equal(canEditTeam(access, teamId), edit, `${teamId} edit`);
};

test("admin has global view and edit regardless of stored team permissions", () => {
  const access = resolve(bootstrap({ role: "admin" }));
  assert.equal(access.viewAll, true);
  assert.equal(access.editAll, true);
  assertTeamAccess(access, "unknown", { view: true, edit: true });
});

test("global Teams editor has global view and edit", () => {
  const access = resolve(bootstrap({ teams: "edit" }));
  assert.equal(access.viewAll, true);
  assert.equal(access.editAll, true);
});

test("global Teams viewer has global view while explicit scoped edit remains", () => {
  const access = resolve(bootstrap({
    teams: "view",
    teamScopes: { worship: "edit" },
  }));
  assert.equal(access.viewAll, true);
  assert.equal(access.editAll, false);
  assertTeamAccess(access, "worship", { view: true, edit: true });
  assertTeamAccess(access, "av", { view: true, edit: false });
});

test("scoped manager can view and edit only the explicitly managed team", () => {
  const access = resolve(bootstrap({ teamScopes: { worship: "edit" } }));
  assertTeamAccess(access, "worship", { view: true, edit: true });
  assertTeamAccess(access, "av", { view: false, edit: false });
  assert.deepEqual(access.explicitlyEditableTeamIds, new Set(["worship"]));
});

test("scoped view remains readable without edit", () => {
  const access = resolve(bootstrap({ teamScopes: { worship: "view" } }));
  assertTeamAccess(access, "worship", { view: true, edit: false });
});

test("linked roster member gets read access to one active team", () => {
  const access = resolve(
    bootstrap(),
    records({
      members: [{ memberId: "member-1", churchId: "church-1", userId: "user-1" }],
      teams: [
        { teamId: "worship", churchId: "church-1", memberIds: ["member-1"] },
        { teamId: "av", churchId: "church-1", memberIds: [] },
      ],
    }),
  );
  assert.deepEqual(access.memberTeamIds, new Set(["worship"]));
  assertTeamAccess(access, "worship", { view: true, edit: false });
  assertTeamAccess(access, "av", { view: false, edit: false });
});

test("linked roster member gets read access to each active team membership", () => {
  const access = resolve(
    bootstrap(),
    records({
      members: [{ memberId: "member-1", churchId: "church-1", userId: "user-1" }],
      teams: [
        { teamId: "worship", churchId: "church-1", memberIds: ["member-1"] },
        { teamId: "av", churchId: "church-1", memberIds: ["member-1"] },
        { teamId: "youth", churchId: "church-1", memberIds: [] },
      ],
    }),
  );
  assert.deepEqual(access.memberTeamIds, new Set(["worship", "av"]));
  assertTeamAccess(access, "worship", { view: true, edit: false });
  assertTeamAccess(access, "av", { view: true, edit: false });
  assertTeamAccess(access, "youth", { view: false, edit: false });
});

test("membership and explicit management combine without broadening other teams", () => {
  const access = resolve(
    bootstrap({ teamScopes: { worship: "edit" } }),
    records({
      members: [{ memberId: "member-1", churchId: "church-1", userId: "user-1" }],
      teams: [
        { teamId: "worship", churchId: "church-1", memberIds: ["member-1"] },
        { teamId: "av", churchId: "church-1", memberIds: ["member-1"] },
      ],
    }),
  );
  assertTeamAccess(access, "worship", { view: true, edit: true });
  assertTeamAccess(access, "av", { view: true, edit: false });
});

test("manager may manage a team they do not belong to", () => {
  const access = resolve(
    bootstrap({ teamScopes: { worship: "edit" } }),
    records({
      members: [{ memberId: "member-1", churchId: "church-1", userId: "user-1" }],
      teams: [
        { teamId: "worship", churchId: "church-1", memberIds: [] },
        { teamId: "av", churchId: "church-1", memberIds: ["member-1"] },
      ],
    }),
  );
  assertTeamAccess(access, "worship", { view: true, edit: true });
  assertTeamAccess(access, "av", { view: true, edit: false });
});

test("unlinked account has no effective Teams access", () => {
  const access = resolve(bootstrap());
  assert.equal(access.viewAll, false);
  assert.equal(access.editAll, false);
  assert.deepEqual(access.viewTeamIds, new Set());
  assert.deepEqual(access.editTeamIds, new Set());
  assert.deepEqual(access.memberTeamIds, new Set());
});

test("archived roster members and teams do not create automatic access", () => {
  const access = resolve(
    bootstrap(),
    records({
      members: [
        { memberId: "archived-member", churchId: "church-1", userId: "user-1", archivedAt: "2026-01-01" },
        { memberId: "active-member", churchId: "church-1", userId: "user-1" },
      ],
      teams: [
        { teamId: "archived-team", churchId: "church-1", memberIds: ["active-member"] , archivedAt: "2026-01-01" },
        { teamId: "active-team", churchId: "church-1", memberIds: ["archived-member"] },
      ],
    }),
  );
  assert.deepEqual(access.memberTeamIds, new Set());
  assertTeamAccess(access, "archived-team", { view: false, edit: false });
  assertTeamAccess(access, "active-team", { view: false, edit: false });
});

test("roster and team records from another church never create access", () => {
  const access = resolve(
    bootstrap(),
    records({
      members: [{ memberId: "member-1", churchId: "church-2", userId: "user-1" }],
      teams: [{ teamId: "foreign-team", churchId: "church-2", memberIds: ["member-1"] }],
    }),
  );
  assert.deepEqual(access.memberTeamIds, new Set());
  assertTeamAccess(access, "foreign-team", { view: false, edit: false });
});

test("bootstrap permissions cannot be applied to a different church", () => {
  const access = resolve(
    bootstrap({ role: "admin", teams: "edit", teamScopes: { worship: "edit" } }),
    records(),
    "church-2",
  );
  assert.equal(access.viewAll, false);
  assert.equal(access.editAll, false);
  assert.deepEqual(access.viewTeamIds, new Set());
  assert.deepEqual(access.editTeamIds, new Set());
});

test("Services permissions do not change the Teams access model", () => {
  const access = resolve(bootstrap({ services: "edit" }));
  assert.equal(access.viewAll, false);
  assert.equal(access.editAll, false);
  assert.deepEqual(access.viewTeamIds, new Set());
});

test("non-human sessions do not receive roster-derived access", () => {
  const access = resolve(
    bootstrap({ sessionKind: "workstation" }),
    records({
      members: [{ memberId: "member-1", churchId: "church-1", userId: "user-1" }],
      teams: [{ teamId: "worship", churchId: "church-1", memberIds: ["member-1"] }],
    }),
  );
  assert.deepEqual(access.memberTeamIds, new Set());
  assertTeamAccess(access, "worship", { view: false, edit: false });
});
