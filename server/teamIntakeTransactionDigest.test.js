process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";

const {
  authHandlers,
  COLLECTIONS,
  getDoc,
  setServerFirestoreForTests,
} = await import("../authService.js");
const {
  createTeamIntakeRecipientToken,
  hashTeamIntakeRecipientToken,
} = await import("./teamIntakeRecipientToken.js");

const snapshotFor = (id, data, ref = null) => ({
  id,
  exists: Boolean(data),
  data: () => (data ? { ...data } : undefined),
  ref,
});

const createFirestoreMock = (seed) => {
  const stores = new Map(
    Object.entries(seed).map(([collection, docs]) => [
      collection,
      new Map(Object.entries(docs)),
    ]),
  );
  const collection = (name) => {
    const store = stores.get(name) || new Map();
    stores.set(name, store);
    const doc = (id) => {
      const ref = {
        id,
        collection: name,
        async get() {
          return snapshotFor(id, store.get(id) || null, ref);
        },
        async set(data, options = {}) {
          store.set(id, options.merge ? { ...(store.get(id) || {}), ...data } : { ...data });
        },
      };
      return ref;
    };
    return {
      doc,
      where(field, operator, value) {
        const filters = [{ field, operator, value }];
        let limit = Infinity;
        const query = {
          where(nextField, nextOperator, nextValue) {
            filters.push({ field: nextField, operator: nextOperator, value: nextValue });
            return query;
          },
          limit(count) {
            limit = count;
            return query;
          },
          async get() {
            const docs = [...store.entries()]
              .filter(([, value]) => filters.every((filter) =>
                filter.operator === "==" && value[filter.field] === filter.value,
              ))
              .slice(0, limit)
              .map(([id, value]) => ({
                id,
                ref: doc(id),
                data: () => ({ ...value }),
              }));
            return { docs };
          },
        };
        return query;
      },
    };
  };

  return {
    collection,
    async runTransaction(callback) {
      const writes = [];
      const result = await callback({
        async get(target) {
          if (typeof target.get === "function") {
            if (target.collection && target.id) return target.get();
            return target.get();
          }
          throw new Error("Unsupported Firestore query in test transaction");
        },
        set(ref, data, options = {}) {
          writes.push({ ref, data, options });
        },
      });
      for (const { ref, data, options } of writes) {
        const store = stores.get(ref.collection);
        store.set(
          ref.id,
          options.merge ? { ...(store.get(ref.id) || {}), ...data } : { ...data },
        );
      }
      return result;
    },
  };
};

test("individual recipient Firestore transaction schedules the digest after commit", async (t) => {
  const formId = "transactional_intake_form";
  const churchId = "transactional_intake_church";
  const memberId = "transactional_intake_member";
  const recipientId = "transactional_intake_recipient";
  const token = createTeamIntakeRecipientToken();
  const stores = {
    [COLLECTIONS.teamIntakeForms]: {
      [formId]: {
        formId,
        churchId,
        active: true,
        name: "Transactional form",
        teamIds: [],
        enabledFields: [],
        availabilityOccurrences: [],
      },
    },
    [COLLECTIONS.teamRosterMembers]: {
      [memberId]: { memberId, churchId, firstName: "Avery", teamMemberships: {} },
    },
    [COLLECTIONS.teamIntakeRecipients]: {
      [recipientId]: {
        recipientId,
        formId,
        churchId,
        memberId,
        recipientTokenHash: hashTeamIntakeRecipientToken(token),
      },
    },
  };
  const db = createFirestoreMock(stores);
  setServerFirestoreForTests(db);
  t.after(() => setServerFirestoreForTests(null));

  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await authHandlers.submitTeamIntake(
    {
      params: {},
      headers: {},
      session: {},
      query: { token, recipientOnly: "true" },
      body: {},
    },
    response,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
  assert.deepEqual(Object.keys(response.payload).sort(), ["submissionId", "success"]);
  assert.ok(
    (await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince,
  );
});
