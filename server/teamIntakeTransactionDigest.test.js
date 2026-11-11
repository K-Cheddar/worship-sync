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
  queryDocs,
  setServerFirestoreForTests,
} = await import("../authService.js");
const {
  createTeamIntakeRecipientToken,
  hashTeamIntakeRecipientToken,
} = await import("./teamIntakeRecipientToken.js");
const { volunteerContactIndexFields } = await import("./volunteerContactIndex.js");

const snapshotFor = (id, data, ref = null) => ({
  id,
  exists: Boolean(data),
  data: () => (data ? { ...data } : undefined),
  ref,
});

const createFirestoreMock = (seed, { afterTransactionRead } = {}) => {
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
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const writes = [];
        const reads = [];
        let result;
        try {
          result = await callback({
            async get(target) {
              if (typeof target.get !== "function") {
                throw new Error("Unsupported Firestore transaction read");
              }
              if (!target.collection || !target.id) return target.get();
              const store = stores.get(target.collection) || new Map();
              const value = store.get(target.id) || null;
              reads.push({ store, id: target.id, value: value && structuredClone(value) });
              const snapshot = snapshotFor(
                target.id,
                value && structuredClone(value),
                target,
              );
              afterTransactionRead?.({
                collection: target.collection,
                id: target.id,
                store,
              });
              return snapshot;
            },
            set(ref, data, options = {}) {
              writes.push({ type: "set", ref, data, options });
            },
            update(ref, data) {
              writes.push({ type: "update", ref, data });
            },
          });
        } catch (error) {
          const conflicted = reads.some(({ store, id, value }) =>
            JSON.stringify(store.get(id) || null) !== JSON.stringify(value || null),
          );
          if (conflicted) continue;
          throw error;
        }
        const conflicted = reads.some(({ store, id, value }) =>
          JSON.stringify(store.get(id) || null) !== JSON.stringify(value || null),
        );
        if (conflicted) continue;
        for (const { type, ref, data, options } of writes) {
          const store = stores.get(ref.collection);
          if (type === "update") {
            store.set(ref.id, { ...(store.get(ref.id) || {}), ...data });
            continue;
          }
          store.set(
            ref.id,
            options.merge ? { ...(store.get(ref.id) || {}), ...data } : { ...data },
          );
        }
        return result;
      }
      throw new Error("Transaction exceeded its retry limit.");
    },
  };
};

const makeAvailabilityTransactionSeed = () => {
  const churchId = "transactional_availability_church";
  const formId = "transactional_availability_form";
  const memberId = "transactional_availability_member";
  const teamId = "transactional_availability_team";
  const recipientId = "transactional_availability_recipient";
  const token = createTeamIntakeRecipientToken();
  const today = new Date();
  const addDays = (days) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const occurrenceId = `service@${addDays(7)}T10:00:00.000Z`;
  return {
    churchId,
    formId,
    memberId,
    teamId,
    recipientId,
    token,
    occurrenceId,
    stores: {
      [COLLECTIONS.churches]: {
        [churchId]: { churchId, name: "Availability Church" },
      },
      [COLLECTIONS.teamIntakeForms]: {
        [formId]: {
          formId,
          churchId,
          name: "Availability request",
          purpose: "team_availability",
          teamIds: [teamId],
          active: true,
          startDate: addDays(0),
          endDate: addDays(14),
          responseDeadline: addDays(14),
          enabledFields: ["availability"],
          availabilityServices: [{ serviceId: "service", name: "Sunday" }],
          availabilityOccurrences: [{
            occurrenceId,
            serviceId: "service",
            name: "Sunday",
            serviceDate: addDays(7),
            startsAt: `${addDays(7)}T10:00:00.000Z`,
          }],
        },
      },
      [COLLECTIONS.teamRosterMembers]: {
        [memberId]: {
          memberId,
          churchId,
          firstName: "Avery",
          lastName: "Morgan",
          email: "avery@example.com",
          notes: "Keep this note",
          positionIds: [],
          serviceAvailability: { "older-occurrence": "unavailable" },
        },
      },
      [COLLECTIONS.teams]: {
        [teamId]: { teamId, churchId, memberIds: [memberId] },
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
    },
  };
};

const submitAvailabilityToken = async (token, occurrenceId, body) => {
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
      body: body ?? {
        firstName: "",
        lastName: "",
        title: "",
        email: "",
        birthDate: null,
        occurrenceAvailability: { [occurrenceId]: "available" },
      },
    },
    response,
  );
  return response;
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
  const storedForm = await getDoc(COLLECTIONS.teamIntakeForms, formId);
  const storedSubmission = await getDoc(
    COLLECTIONS.teamIntakeSubmissions,
    response.payload.submissionId,
  );
  assert.ok(storedForm.pendingDigestSince);
  assert.equal(
    storedSubmission.digestBatchId,
    storedForm.pendingDigestBatchId,
  );
});

for (const purpose of ["general_intake", "team_availability"]) {
  for (const enabledFields of [[], ["positions", "availability", "blockoutDates", "recurringAvailability", "schedulingFrequency"]]) {
    test(`${purpose} transaction preserves disabled or omitted member response fields (${enabledFields.length})`, async (t) => {
      const fixture = makeAvailabilityTransactionSeed();
      Object.assign(fixture.stores[COLLECTIONS.teamIntakeForms][fixture.formId], { purpose, enabledFields });
      const existing = {
        desiredPositionIds: ["saved-position"],
        serviceAvailability: { [fixture.occurrenceId]: "unavailable", outside: "available" },
        blockoutDates: [{ startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), notes: "Saved" }],
        servingFrequency: "weekly",
        recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: true },
      };
      Object.assign(fixture.stores[COLLECTIONS.teamRosterMembers][fixture.memberId], existing);
      setServerFirestoreForTests(createFirestoreMock(fixture.stores));
      t.after(() => setServerFirestoreForTests(null));
      const response = await submitAvailabilityToken(fixture.token, fixture.occurrenceId, {});
      assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
      const member = await getDoc(COLLECTIONS.teamRosterMembers, fixture.memberId);
      for (const [field, value] of Object.entries(existing)) assert.deepEqual(member[field], value, field);
    });
  }
}

test("availability transaction preserves concurrent outside dates and does not reapply an acknowledged response", async (t) => {
  const fixture = makeAvailabilityTransactionSeed();
  let changed = false;
  const db = createFirestoreMock(fixture.stores, {
    afterTransactionRead: ({ collection, id, store }) => {
      if (!changed && collection === COLLECTIONS.teamRosterMembers && id === fixture.memberId) {
        changed = true;
        const member = store.get(id);
        store.set(id, { ...member, notes: "New admin note", serviceAvailability: { ...member.serviceAvailability, concurrent: "unavailable" } });
      }
    },
  });
  setServerFirestoreForTests(db);
  t.after(() => setServerFirestoreForTests(null));
  const first = await submitAvailabilityToken(fixture.token, fixture.occurrenceId);
  assert.equal(first.statusCode, 200, JSON.stringify(first.payload));
  let member = await getDoc(COLLECTIONS.teamRosterMembers, fixture.memberId);
  assert.equal(member.serviceAvailability.concurrent, "unavailable");
  assert.equal(member.notes, "New admin note");
  await db.collection(COLLECTIONS.teamRosterMembers).doc(fixture.memberId).set({
    serviceAvailability: { ...member.serviceAvailability, [fixture.occurrenceId]: "unavailable" },
  }, { merge: true });
  const repeated = await submitAvailabilityToken(fixture.token, fixture.occurrenceId);
  assert.equal(repeated.statusCode, 200, JSON.stringify(repeated.payload));
  assert.equal(repeated.payload.submissionId, first.payload.submissionId);
  member = await getDoc(COLLECTIONS.teamRosterMembers, fixture.memberId);
  assert.equal(member.serviceAvailability[fixture.occurrenceId], "unavailable");
  assert.equal((await queryDocs(COLLECTIONS.teamIntakeSubmissions, [{ field: "formId", value: fixture.formId }])).length, 1);
});

for (const purpose of ["general_intake", "team_availability"]) {
  test(`${purpose} transaction applies explicit selections and clearing while retaining omitted response data`, async (t) => {
    const fixture = makeAvailabilityTransactionSeed();
    const form = fixture.stores[COLLECTIONS.teamIntakeForms][fixture.formId];
    Object.assign(form, { purpose, enabledFields: ["positions", "availability", "blockoutDates", "notes"] });
    form.availabilityOccurrences.push({ occurrenceId: "second-in-scope" });
    fixture.stores[COLLECTIONS.teamPositions] = {
      selected: { positionId: "selected", churchId: fixture.churchId, teamId: fixture.teamId },
    };
    Object.assign(fixture.stores[COLLECTIONS.teamRosterMembers][fixture.memberId], {
      desiredPositionIds: ["old"],
      serviceAvailability: { "second-in-scope": "unavailable", outside: "available" },
    });
    setServerFirestoreForTests(createFirestoreMock(fixture.stores));
    t.after(() => setServerFirestoreForTests(null));
    const first = await submitAvailabilityToken(fixture.token, fixture.occurrenceId, {
      positionIds: ["selected"], occurrenceAvailability: { [fixture.occurrenceId]: "unavailable", outside: "unavailable" },
    });
    assert.equal(first.statusCode, 200, JSON.stringify(first.payload));
    let member = await getDoc(COLLECTIONS.teamRosterMembers, fixture.memberId);
    assert.deepEqual(member.desiredPositionIds, purpose === "general_intake" ? ["selected"] : ["old"]);
    assert.deepEqual(member.serviceAvailability, { [fixture.occurrenceId]: "unavailable", outside: "available" });
    const partial = await submitAvailabilityToken(fixture.token, fixture.occurrenceId, { notes: "Only notes" });
    assert.equal(partial.statusCode, 200, JSON.stringify(partial.payload));
    assert.equal(partial.payload.submissionId, first.payload.submissionId);
    member = await getDoc(COLLECTIONS.teamRosterMembers, fixture.memberId);
    assert.equal(member.serviceAvailability[fixture.occurrenceId], "unavailable");
    const submission = await getDoc(COLLECTIONS.teamIntakeSubmissions, first.payload.submissionId);
    assert.deepEqual(submission.occurrenceAvailability, { [fixture.occurrenceId]: "unavailable" });
    const cleared = await submitAvailabilityToken(fixture.token, fixture.occurrenceId, { positionIds: [], occurrenceAvailability: {} });
    assert.equal(cleared.statusCode, 200, JSON.stringify(cleared.payload));
    member = await getDoc(COLLECTIONS.teamRosterMembers, fixture.memberId);
    assert.deepEqual(member.desiredPositionIds, purpose === "general_intake" ? [] : ["old"]);
    assert.deepEqual(member.serviceAvailability, { outside: "available" });
  });
}

test("personalized intake transaction keeps a profile field filled concurrently after preview", async (t) => {
  const previousContactSecret = process.env.AUTH_VOLUNTEER_PORTAL_SECRET;
  const contactSecret = "team-intake-transaction-profile-secret";
  process.env.AUTH_VOLUNTEER_PORTAL_SECRET = contactSecret;
  t.after(() => {
    if (previousContactSecret === undefined) {
      delete process.env.AUTH_VOLUNTEER_PORTAL_SECRET;
    } else {
      process.env.AUTH_VOLUNTEER_PORTAL_SECRET = previousContactSecret;
    }
  });

  const churchId = "transactional_profile_church";
  const formId = "transactional_profile_form";
  const memberId = "transactional_profile_member";
  const recipientId = "transactional_profile_recipient";
  const token = createTeamIntakeRecipientToken();
  const startDate = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  let filledDuringTransaction = false;
  const stores = {
    [COLLECTIONS.teamIntakeForms]: {
      [formId]: {
        formId,
        churchId,
        active: true,
        name: "Complete your profile",
        purpose: "general_intake",
        teamIds: [],
        startDate,
        endDate,
        responseDeadline: endDate,
        enabledFields: ["firstName", "lastName", "email"],
        availabilityOccurrences: [],
      },
    },
    [COLLECTIONS.teamRosterMembers]: {
      [memberId]: {
        memberId,
        churchId,
        firstName: "Avery",
        lastName: "Morgan",
        email: "",
        serviceAvailability: { "older-occurrence": "unavailable" },
      },
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
  const db = createFirestoreMock(stores, {
    afterTransactionRead: ({ collection, id, store }) => {
      if (
        !filledDuringTransaction &&
        collection === COLLECTIONS.teamRosterMembers &&
        id === memberId
      ) {
        filledDuringTransaction = true;
        store.set(id, { ...store.get(id), email: "latest@example.org" });
      }
    },
  });
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
      body: {
        firstName: "Changed",
        lastName: "Changed",
        email: "stale@example.net",
        occurrenceAvailability: {},
      },
    },
    response,
  );

  assert.equal(filledDuringTransaction, true);
  assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
  const member = await getDoc(COLLECTIONS.teamRosterMembers, memberId);
  assert.equal(member.firstName, "Avery");
  assert.equal(member.lastName, "Morgan");
  assert.equal(member.email, "latest@example.org");
  assert.deepEqual(
    member.volunteerContactKeys,
    volunteerContactIndexFields(member, contactSecret).volunteerContactKeys,
  );
  const submission = await getDoc(
    COLLECTIONS.teamIntakeSubmissions,
    response.payload.submissionId,
  );
  assert.equal(submission.submittedMemberDetails, undefined);
});

test("availability recipient submission uses the current Team roster inside its Firestore transaction", async (t) => {
  const fixture = makeAvailabilityTransactionSeed();
  const db = createFirestoreMock(fixture.stores);
  setServerFirestoreForTests(db);
  t.after(() => setServerFirestoreForTests(null));

  const response = await submitAvailabilityToken(fixture.token, fixture.occurrenceId);

  assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
  const member = await getDoc(COLLECTIONS.teamRosterMembers, fixture.memberId);
  assert.equal(member.serviceAvailability[fixture.occurrenceId], "available");
  assert.equal(member.serviceAvailability["older-occurrence"], "unavailable");
  assert.equal(member.email, "avery@example.com");
  assert.equal(member.notes, "Keep this note");
  const recipient = await getDoc(COLLECTIONS.teamIntakeRecipients, fixture.recipientId);
  assert.ok(recipient.respondedAt);
  const submission = await getDoc(
    COLLECTIONS.teamIntakeSubmissions,
    response.payload.submissionId,
  );
  assert.equal(submission.status, "applied");
  assert.equal(submission.occurrenceAvailability[fixture.occurrenceId], "available");
});

test("a Team membership removal during an availability response transaction prevents the commit", async (t) => {
  const fixture = makeAvailabilityTransactionSeed();
  let removedMembershipDuringTransaction = false;
  const db = createFirestoreMock(fixture.stores, {
    afterTransactionRead: ({ collection, id, store }) => {
      if (
        !removedMembershipDuringTransaction &&
        collection === COLLECTIONS.teams &&
        id === fixture.teamId
      ) {
        removedMembershipDuringTransaction = true;
        store.set(id, { ...store.get(id), memberIds: [] });
      }
    },
  });
  setServerFirestoreForTests(db);
  t.after(() => setServerFirestoreForTests(null));

  const response = await submitAvailabilityToken(fixture.token, fixture.occurrenceId);

  assert.equal(removedMembershipDuringTransaction, true);
  assert.equal(response.statusCode, 404, JSON.stringify(response.payload));
  assert.match(JSON.stringify(response.payload), /no longer available/i);
  const member = await getDoc(COLLECTIONS.teamRosterMembers, fixture.memberId);
  assert.deepEqual(member.serviceAvailability, { "older-occurrence": "unavailable" });
  assert.equal(member.email, "avery@example.com");
  assert.equal(member.notes, "Keep this note");
  assert.deepEqual(
    (await getDoc(COLLECTIONS.teams, fixture.teamId)).memberIds,
    [],
  );
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeRecipients, fixture.recipientId)).respondedAt,
    undefined,
  );
  assert.deepEqual(await queryDocs(COLLECTIONS.teamIntakeSubmissions, [
    { field: "formId", value: fixture.formId },
  ]), []);
});

test("Firestore emulator intake replaces only explicit form-scoped availability", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async (t) => {
  const { initializeApp, deleteApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({ projectId: "demo-worshipsync-intake" }, `intake-integrity-${process.pid}`);
  const db = getFirestore(app);
  const fixture = makeAvailabilityTransactionSeed();
  const secondId = `${fixture.occurrenceId}-second`;
  fixture.stores[COLLECTIONS.teamIntakeForms][fixture.formId].availabilityOccurrences.push({ occurrenceId: secondId });
  fixture.stores[COLLECTIONS.teamRosterMembers][fixture.memberId].serviceAvailability = {
    [fixture.occurrenceId]: "unavailable", [secondId]: "unavailable", outside: "available",
  };
  for (const [collection, docs] of Object.entries(fixture.stores)) {
    for (const [id, value] of Object.entries(docs)) await db.collection(collection).doc(id).set(value);
  }
  setServerFirestoreForTests(db);
  t.after(async () => {
    setServerFirestoreForTests(null);
    for (const name of [COLLECTIONS.teamIntakeSubmissions, ...Object.keys(fixture.stores)]) {
      const snapshot = await db.collection(name).where("churchId", "==", fixture.churchId).get();
      await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
    }
    await db.collection(COLLECTIONS.churches).doc(fixture.churchId).delete();
    await deleteApp(app);
  });
  let response = await submitAvailabilityToken(fixture.token, fixture.occurrenceId);
  assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
  let member = await getDoc(COLLECTIONS.teamRosterMembers, fixture.memberId);
  assert.deepEqual(member.serviceAvailability, { [fixture.occurrenceId]: "available", outside: "available" });
  response = await submitAvailabilityToken(fixture.token, fixture.occurrenceId, { notes: "Omitted availability" });
  assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
  member = await getDoc(COLLECTIONS.teamRosterMembers, fixture.memberId);
  assert.deepEqual(member.serviceAvailability, { [fixture.occurrenceId]: "available", outside: "available" });
  response = await submitAvailabilityToken(fixture.token, fixture.occurrenceId, { occurrenceAvailability: {} });
  assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
  member = await getDoc(COLLECTIONS.teamRosterMembers, fixture.memberId);
  assert.deepEqual(member.serviceAvailability, { outside: "available" });
});
