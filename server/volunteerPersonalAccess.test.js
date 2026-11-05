import test from "node:test";
import assert from "node:assert/strict";
import { createVolunteerPersonalAccess } from "./volunteerPersonalAccess.js";

test("retries a closed legacy-query transaction before issuing a credential", async () => {
  const memberCollection = "members";
  const collections = { access: "access", credentials: "credentials", sessions: "sessions" };
  const identity = { churchId: "church-a", memberId: "member-a" };
  let attempts = 0;

  const reference = (collection, id) => ({ collection, id });
  const query = () => ({
    kind: "query",
    where() { return this; },
    limit() { return this; },
    get: async () => ({ size: 0, empty: true, docs: [] }),
  });
  const db = {
    collection(name) {
      return {
        doc: (id) => reference(name, id),
        where: () => query(),
      };
    },
    async runTransaction(update) {
      while (true) {
        attempts += 1;
        const currentAttempt = attempts;
        const transaction = {
          async get(ref) {
            if (ref.kind === "query") {
              if (currentAttempt === 1) {
                throw Object.assign(new Error("3 INVALID_ARGUMENT: Transaction is invalid or closed."), {
                  code: 3,
                  details: "Transaction is invalid or closed.",
                });
              }
              return { size: 0, empty: true, docs: [] };
            }
            if (ref.collection === memberCollection) {
              return { exists: true, data: () => ({ ...identity, archivedAt: null }) };
            }
            return { exists: false, data: () => undefined };
          },
          create() {},
          set() {},
          update() {},
        };

        try {
          return await update(transaction);
        } catch (error) {
          // Match the Firestore transaction runner's INVALID_ARGUMENT expiry retry.
          if (attempts >= 5 || error?.code !== 3 || !/transaction has expired/.test(error.message)) throw error;
        }
      }
    },
  };

  const access = createVolunteerPersonalAccess({
    db,
    memberCollection,
    collections,
    secret: "synthetic-test-secret-for-volunteer-personal-access-only",
  });
  const prepared = await access.prepare(identity);

  assert.equal(attempts, 2);
  assert.equal(prepared.generation, 1);
  assert.equal(prepared.reused, false);
  assert.match(prepared.token, /^v_[A-Za-z0-9_-]{32}$/);
});
