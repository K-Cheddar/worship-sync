import test from "node:test";
import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

test("Firestore emulator preserves nested-map delete and replacement semantics", async (t) => {
  if (!emulatorHost) {
    t.skip("set FIRESTORE_EMULATOR_HOST to run the Firestore integration case");
    return;
  }

  const app = initializeApp(
    { projectId: `worshipsync-map-test-${process.pid}` },
    `nested-map-${process.pid}`,
  );
  const db = getFirestore(app);
  const [host, port] = emulatorHost.split(":");
  db.settings({ host, port: Number(port), ssl: false });
  const ref = db.collection("teamRosterMembers").doc("nested-map-semantics");

  try {
    await ref.set({
      memberId: "nested-map-semantics",
      teamMemberships: {
        teamA: { teamId: "teamA", roleId: "roleA", roleLabel: "A", isTeamLead: true },
        teamB: { teamId: "teamB", roleId: "roleB", roleLabel: "B" },
      },
      email: "keep@example.test",
    });

    // This is the exact Firestore merge behavior that made the former
    // read/delete/set(merge:true) implementation fail.
    await ref.set({ teamMemberships: { teamB: { teamId: "teamB" } } }, { merge: true });
    let snapshot = await ref.get();
    assert.equal(snapshot.get("teamMemberships.teamA.roleId"), "roleA");

    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      assert.equal(current.get("teamMemberships.teamA.roleId"), "roleA");
      transaction.update(
        ref,
        new FieldPath("teamMemberships", "teamA"),
        FieldValue.delete(),
      );
    });
    snapshot = await ref.get();
    assert.equal(snapshot.get("teamMemberships.teamA"), undefined);
    assert.deepEqual(snapshot.get("teamMemberships.teamB"), { teamId: "teamB" });
    assert.equal(snapshot.get("email"), "keep@example.test");

    await ref.update(
      new FieldPath("teamMemberships", "teamB", "roleId"),
      FieldValue.delete(),
      new FieldPath("teamMemberships", "teamB", "roleLabel"),
      FieldValue.delete(),
    );
    snapshot = await ref.get();
    assert.deepEqual(snapshot.get("teamMemberships.teamB"), { teamId: "teamB" });

    await ref.update({
      teamMemberships: { teamB: { teamId: "teamB", isTeamLead: true } },
    });
    snapshot = await ref.get();
    assert.deepEqual(snapshot.get("teamMemberships"), {
      teamB: { teamId: "teamB", isTeamLead: true },
    });
    assert.equal(snapshot.get("email"), "keep@example.test");

    await ref.set({
      teamMemberships: {
        teamA: { teamId: "teamA", roleId: "roleA" },
        teamB: { teamId: "teamB", roleId: "roleB" },
      },
    }, { merge: true });
    await Promise.all([
      db.runTransaction(async (transaction) => {
        await transaction.get(ref);
        transaction.update(
          ref,
          new FieldPath("teamMemberships", "teamA"),
          FieldValue.delete(),
        );
      }),
      db.runTransaction(async (transaction) => {
        await transaction.get(ref);
        transaction.update(
          ref,
          new FieldPath("teamMemberships", "teamB", "roleLabel"),
          "Updated B",
        );
      }),
    ]);
    snapshot = await ref.get();
    assert.equal(snapshot.get("teamMemberships.teamA"), undefined);
    assert.equal(snapshot.get("teamMemberships.teamB.roleId"), "roleB");
    assert.equal(snapshot.get("teamMemberships.teamB.roleLabel"), "Updated B");
  } finally {
    await ref.delete();
    await deleteApp(app);
  }
});
