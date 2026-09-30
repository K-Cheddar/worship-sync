import test from "node:test";
import assert from "node:assert/strict";
import { persistPortableCreate } from "./portableCreatePersister.js";

const createTransactionalStore = () => {
  const collections = new Map();
  let tail = Promise.resolve();
  let failCollection = "";
  const collection = (name) => ({
    doc: (id) => ({ collection: name, id }),
  });
  const db = {
    collection,
    runTransaction: async (callback) => {
      let release;
      const prior = tail;
      tail = new Promise((resolve) => { release = resolve; });
      await prior;
      try {
        const writes = [];
        const transaction = {
          async get(reference) {
            const value = collections.get(reference.collection)?.get(reference.id);
            return { exists: Boolean(value), data: () => value };
          },
          create(reference, value) {
            if (reference.collection === failCollection) throw new Error("simulated write failure");
            writes.push({ reference, value, create: true });
          },
          set(reference, value) {
            writes.push({ reference, value, create: false });
          },
        };
        const result = await callback(transaction);
        for (const { reference, value, create } of writes) {
          const store = collections.get(reference.collection) || new Map();
          if (create && store.has(reference.id)) throw new Error("document already exists");
          store.set(reference.id, value);
          collections.set(reference.collection, store);
        }
        return result;
      } finally {
        release();
      }
    },
  };
  return {
    db,
    collections,
    failWritesTo(collectionName) { failCollection = collectionName; },
    allowWrites() { failCollection = ""; },
  };
};

const createInput = (db, overrides = {}) => ({
  db,
  entityCollection: "teams",
  entityId: "team_deterministic",
  entity: { churchId: "church-a", teamId: "team_deterministic", _portableCreateKey: "key-a", name: "Media" },
  ledgerCollection: "portableImportCreates",
  ledgerId: "claim-a",
  ledger: { churchId: "church-a", kind: "team", createKey: "key-a", entityCollection: "teams", entityId: "team_deterministic" },
  conflict: () => new Error("claim conflict"),
  ...overrides,
});

test("concurrent retries persist one entity and one Firestore claim", async () => {
  const store = createTransactionalStore();
  const [first, second] = await Promise.all([
    persistPortableCreate(createInput(store.db)),
    persistPortableCreate(createInput(store.db)),
  ]);
  assert.equal(first.teamId, "team_deterministic");
  assert.equal(second.teamId, "team_deterministic");
  assert.equal(store.collections.get("teams").size, 1);
  assert.equal(store.collections.get("portableImportCreates").size, 1);
});

test("a failed claim or entity write leaves no half-write and can be retried", async () => {
  for (const failedCollection of ["teams", "portableImportCreates"]) {
    const store = createTransactionalStore();
    store.failWritesTo(failedCollection);
    await assert.rejects(persistPortableCreate(createInput(store.db)), /simulated write failure/);
    assert.equal(store.collections.has("teams"), false);
    assert.equal(store.collections.has("portableImportCreates"), false);

    store.allowWrites();
    await persistPortableCreate(createInput(store.db));
    assert.equal(store.collections.get("teams").size, 1);
    assert.equal(store.collections.get("portableImportCreates").size, 1);
  }
});
