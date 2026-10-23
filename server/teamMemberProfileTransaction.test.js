import test from "node:test";
import assert from "node:assert/strict";
import { createTeamsAuthHandlers } from "./teamsAuthHandlers.js";

test("team profile transaction retries compare the baseline again before committing any section", async () => {
  const COLLECTIONS = Object.fromEntries([
    "teams", "teamRosterMembers", "teamRoles", "teamPositions", "teamQualificationAreas",
  ].map((name) => [name, name]));
  const records = new Map([
    ["teams/team", { teamId: "team", churchId: "church", memberIds: ["member"] }],
    ["teamRosterMembers/member", {
      memberId: "member", churchId: "church", positionIds: ["position"],
      teamMemberships: { team: { roleId: "old-role", isTeamLead: false } },
    }],
    ["teamPositions/position", { positionId: "position", teamId: "team", churchId: "church" }],
    ...["old-role", "new-role"].map((roleId) => [`teamRoles/${roleId}`, {
      roleId, churchId: "church", teamId: "team", name: roleId,
    }]),
  ]);
  const read = (collection, id) => structuredClone(records.get(`${collection}/${id}`) || null);
  let attempts = 0;
  let commits = 0;
  const db = {
    collection: (name) => ({ doc: (id) => ({ name, id }) }),
    async runTransaction(callback) {
      for (;;) {
        attempts += 1;
        const writes = [];
        const transaction = {
          async get({ name, id }) {
            assert.equal(writes.length, 0, "Firestore requires reads before writes");
            const record = read(name, id);
            return { exists: Boolean(record), id, data: () => record };
          },
          update(ref, patch) { writes.push({ ref, patch }); },
        };
        const result = await callback(transaction);
        if (attempts === 1) {
          // A competing full member edit commits after the snapshot was checked.
          // Firestore discards this attempt and retries with a fresh snapshot.
          const member = records.get("teamRosterMembers/member");
          member.teamMemberships.team.roleId = "new-role";
          continue;
        }
        for (const { ref, patch } of writes) {
          records.set(`${ref.name}/${ref.id}`, { ...read(ref.name, ref.id), ...patch });
        }
        commits += 1;
        return result;
      }
    },
  };
  const handlers = createTeamsAuthHandlers({
    COLLECTIONS,
    getDoc: async (collection, id) => read(collection, id),
    requireFirestore: () => db,
    assertCsrf: async () => {},
    requireHumanSession: async () => ({}),
    requireTeamsEditForTeamSession: async () => ({ user: { uid: "manager" } }),
    nowIso: () => "2026-10-23T12:00:00.000Z",
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    updateDocFields: async (collection, id, patch, { transaction }) => {
      assert.ok(transaction, "the comparison and write must share the transaction");
      transaction.update(db.collection(collection).doc(id), patch);
    },
  });
  const response = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
  };
  await handlers.updateTeamRosterMemberProfile({
    params: { churchId: "church", teamId: "team", memberId: "member" },
    body: {
      membership: { roleId: null }, positionIds: [],
      baseProfile: { membership: { roleId: "old-role" }, positionIds: ["position"] },
    },
  }, response);
  assert.equal(response.statusCode, 409, JSON.stringify(response.payload));
  assert.equal(attempts, 2);
  assert.equal(commits, 0);
  const member = read("teamRosterMembers", "member");
  assert.equal(member.teamMemberships.team.roleId, "new-role");
  assert.deepEqual(member.positionIds, ["position"]);
});
