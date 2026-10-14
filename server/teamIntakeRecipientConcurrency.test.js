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
  seedActiveHumanBearerForServerTests,
  setDoc,
  setServerFirestoreForTests,
} = await import("../authService.js");

const snapshotFor = (id, value, ref) => ({
  id,
  exists: Boolean(value),
  data: () => value ? structuredClone(value) : undefined,
  ref,
});

const createFirestoreMock = () => {
  const stores = new Map();
  const documentVersions = new Map();
  const collectionVersions = new Map();
  let beforeCommit = null;
  let beforeDirectSet = null;
  const versionKey = (collectionName, id) => `${collectionName}/${id}`;
  const getStore = (collectionName) => {
    if (!stores.has(collectionName)) stores.set(collectionName, new Map());
    return stores.get(collectionName);
  };
  const bumpVersion = (collectionName, id) => {
    const key = versionKey(collectionName, id);
    documentVersions.set(key, (documentVersions.get(key) || 0) + 1);
    collectionVersions.set(
      collectionName,
      (collectionVersions.get(collectionName) || 0) + 1,
    );
  };
  const collection = (collectionName) => {
    const store = getStore(collectionName);
    const doc = (id) => {
      const ref = {
        kind: "document",
        collectionName,
        id,
        async get() {
          return snapshotFor(id, store.get(id) || null, ref);
        },
        async set(data, options = {}) {
          await beforeDirectSet?.(ref, data, options);
          const current = store.get(id) || {};
          store.set(id, options.merge ? { ...current, ...structuredClone(data) } : structuredClone(data));
          bumpVersion(collectionName, id);
        },
        async update(data) {
          store.set(id, { ...(store.get(id) || {}), ...structuredClone(data) });
          bumpVersion(collectionName, id);
        },
        async delete() {
          store.delete(id);
          bumpVersion(collectionName, id);
        },
      };
      return ref;
    };
    const makeQuery = (filters = [], limit = Infinity) => ({
      kind: "query",
      collectionName,
      filters,
      limitValue: limit,
      where(field, operator, value) {
        return makeQuery([...filters, { field, operator, value }], limit);
      },
      limit(count) {
        return makeQuery(filters, count);
      },
      async get() {
        const docs = [...store.entries()]
          .filter(([, value]) => filters.every(({ field, operator, value: expected }) => {
            if (operator === "==") return value[field] === expected;
            if (operator === "in") return Array.isArray(expected) && expected.includes(value[field]);
            if (operator === ">") return value[field] > expected;
            return false;
          }))
          .slice(0, limit)
          .map(([id, value]) => ({
            id,
            ref: doc(id),
            data: () => structuredClone(value),
          }));
        return { docs };
      },
    });
    return {
      doc,
      where(field, operator, value) {
        return makeQuery([{ field, operator, value }]);
      },
      async get() {
        return makeQuery().get();
      },
    };
  };

  const applyWrites = (writes) => {
    for (const { ref, data, options = {}, type = "set" } of writes) {
      const store = getStore(ref.collectionName);
      if (type === "delete") store.delete(ref.id);
      else if (type === "update") {
        store.set(ref.id, { ...(store.get(ref.id) || {}), ...structuredClone(data) });
      } else {
        const current = store.get(ref.id) || {};
        store.set(ref.id, options.merge ? { ...current, ...structuredClone(data) } : structuredClone(data));
      }
      bumpVersion(ref.collectionName, ref.id);
    }
  };
  const readsAreCurrent = (reads) => reads.every((read) => {
    if (read.kind === "query") {
      return (collectionVersions.get(read.collectionName) || 0) === read.version;
    }
    return (documentVersions.get(versionKey(read.collectionName, read.id)) || 0) === read.version;
  });

  return {
    collection,
    batch() {
      const writes = [];
      return {
        set(ref, data, options = {}) { writes.push({ ref, data, options }); },
        async commit() {
          await beforeCommit?.(writes);
          applyWrites(writes);
        },
      };
    },
    setBeforeCommit(callback) { beforeCommit = callback; },
    setBeforeDirectSet(callback) { beforeDirectSet = callback; },
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const reads = [];
        const writes = [];
        let hasWritten = false;
        const transaction = {
          async get(target) {
            if (hasWritten) throw new Error("Firestore transactions must read before writing.");
            if (target.kind === "query") {
              const snapshot = await target.get();
              reads.push({
                kind: "query",
                collectionName: target.collectionName,
                version: collectionVersions.get(target.collectionName) || 0,
              });
              return snapshot;
            }
            const value = getStore(target.collectionName).get(target.id) || null;
            reads.push({
              kind: "document",
              collectionName: target.collectionName,
              id: target.id,
              version: documentVersions.get(versionKey(target.collectionName, target.id)) || 0,
            });
            return snapshotFor(target.id, value, target);
          },
          set(ref, data, options = {}) {
            hasWritten = true;
            writes.push({ ref, data, options, type: "set" });
          },
          update(ref, data) {
            hasWritten = true;
            writes.push({ ref, data, type: "update" });
          },
          delete(ref) {
            hasWritten = true;
            writes.push({ ref, type: "delete" });
          },
        };
        let result;
        try {
          result = await callback(transaction);
        } catch (error) {
          if (readsAreCurrent(reads)) throw error;
          continue;
        }
        await beforeCommit?.(writes);
        if (!readsAreCurrent(reads)) continue;
        if (writes.length > 500) throw new Error("Firestore transaction write limit exceeded.");
        applyWrites(writes);
        return result;
      }
      throw new Error("Transaction exceeded its retry limit.");
    },
  };
};

const createSession = () => ({ destroy(callback) { callback?.(); } });
const createReq = ({ params = {}, headers = {}, session = createSession(), body = {}, query = {} } = {}) => ({
  params,
  headers,
  session,
  body,
  query,
});
const createRes = () => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
});

const dateFromToday = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const formPayload = (teamIds, name = "Concurrency form") => {
  const serviceDate = dateFromToday(14);
  return {
    name,
    startDate: dateFromToday(0),
    endDate: serviceDate,
    responseDeadline: serviceDate,
    availabilityServices: [{ serviceId: "sunday", name: "Sunday" }],
    availabilityOccurrences: [{
      occurrenceId: `sunday@${serviceDate}T10:00:00.000Z`,
      serviceId: "sunday",
      name: "Sunday",
      serviceDate,
      startsAt: `${serviceDate}T10:00:00.000Z`,
    }],
    teamIds,
    purpose: "team_availability",
    enabledFields: ["availability"],
    active: true,
  };
};

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const createAdminContext = async (churchId, suffix) => {
  const session = createSession();
  const actor = await seedActiveHumanBearerForServerTests({
    req: createReq({ session }),
    userId: `concurrency_test_admin_${suffix}`,
    email: `concurrency-${suffix}@example.com`,
    churchId,
    role: "admin",
  });
  const authMe = createRes();
  await authHandlers.getAuthMe(createReq({
    session,
    headers: { authorization: `Bearer ${actor.humanApiToken}` },
  }), authMe);
  return {
    churchId,
    headers: {
      authorization: `Bearer ${actor.humanApiToken}`,
      "x-csrf-token": String(authMe.payload?.csrfToken || ""),
    },
    session,
  };
};

const createFixture = async (db, suffix = "one") => {
  setServerFirestoreForTests(db);
  const churchId = `concurrency_test_church_${suffix}`;
  const formId = `concurrency_test_form_${suffix}`;
  const worshipTeamId = `concurrency_test_worship_${suffix}`;
  const avTeamId = `concurrency_test_av_${suffix}`;
  const memberId = `concurrency_test_member_${suffix}`;
  const context = await createAdminContext(churchId, suffix);
  await db.collection(COLLECTIONS.churches).doc(churchId).set({ churchId, name: "Concurrency Church" });
  await db.collection(COLLECTIONS.teams).doc(worshipTeamId).set({
    teamId: worshipTeamId,
    churchId,
    name: "Worship",
    memberIds: [memberId],
  });
  await db.collection(COLLECTIONS.teams).doc(avTeamId).set({
    teamId: avTeamId,
    churchId,
    name: "AV",
    memberIds: [],
  });
  await db.collection(COLLECTIONS.teamRosterMembers).doc(memberId).set({
    memberId,
    churchId,
    firstName: "Avery",
    lastName: "Morgan",
    positionIds: [],
    teamMemberships: { [worshipTeamId]: { teamId: worshipTeamId } },
  });
  await db.collection(COLLECTIONS.teamIntakeForms).doc(formId).set({
    formId,
    churchId,
    ...formPayload([worshipTeamId]),
  });
  return { context, formId, memberId, worshipTeamId, avTeamId };
};

const addWorshipMember = async (db, fixture, memberId) => {
  await db.collection(COLLECTIONS.teamRosterMembers).doc(memberId).set({
    memberId,
    churchId: fixture.context.churchId,
    firstName: memberId,
    lastName: "Morgan",
    positionIds: [],
    teamMemberships: { [fixture.worshipTeamId]: { teamId: fixture.worshipTeamId } },
  });
  await db.collection(COLLECTIONS.teams).doc(fixture.worshipTeamId).update({
    memberIds: [fixture.memberId, memberId],
  });
};

const installRecipientCommitBarrier = (db) => {
  const entered = deferred();
  const release = deferred();
  db.setBeforeCommit(async (writes) => {
    if (writes.some(({ ref }) => ref.collectionName === COLLECTIONS.teamIntakeRecipients)) {
      db.setBeforeCommit(null);
      entered.resolve();
      await release.promise;
    }
  });
  return { entered: entered.promise, release: release.resolve };
};

const callHandler = async (handler, { context, params = {}, body = {} }) => {
  const response = createRes();
  await handler(createReq({
    params: { churchId: context.churchId, ...params },
    headers: context.headers,
    session: context.session,
    body,
  }), response);
  return response;
};

test("scope change that commits before first recipient issuance cannot use the stale form snapshot", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "scope-first");
  t.after(() => setServerFirestoreForTests(null));
  const barrier = installRecipientCommitBarrier(db);

  const issuance = callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [fixture.memberId] },
  });
  await barrier.entered;
  const scopeChange = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: formPayload([fixture.avTeamId]),
  });
  barrier.release();
  const recipientIssue = await issuance;

  const storedForm = await getDoc(COLLECTIONS.teamIntakeForms, fixture.formId);
  const storedRecipients = await queryDocs(
    COLLECTIONS.teamIntakeRecipients,
    [{ field: "formId", value: fixture.formId }],
    { limit: 0 },
  );
  assert.ok(
    scopeChange.statusCode !== 200 || recipientIssue.statusCode !== 200,
    `Both operations succeeded: scope=${scopeChange.statusCode}, recipient=${recipientIssue.statusCode}; the form now scopes to ${storedForm.teamIds.join(",")}.`,
  );
  if (scopeChange.statusCode !== 200 || recipientIssue.statusCode !== 200) {
    assert.deepEqual(storedRecipients, []);
  }
});

test("first recipient issuance commits before a scope change and permanently locks the form", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "issue-first");
  t.after(() => setServerFirestoreForTests(null));
  const barrier = installRecipientCommitBarrier(db);
  const issuance = callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [fixture.memberId] },
  });
  await barrier.entered;
  barrier.release();
  const issued = await issuance;
  assert.equal(issued.statusCode, 200, JSON.stringify(issued.payload));
  const scopeChange = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: formPayload([fixture.avTeamId]),
  });
  assert.equal(scopeChange.statusCode, 409, JSON.stringify(scopeChange.payload));
  const storedForm = await getDoc(COLLECTIONS.teamIntakeForms, fixture.formId);
  assert.equal(storedForm.teamAvailabilityScopeLocked, true);
  assert.deepEqual(storedForm.teamIds, [fixture.worshipTeamId]);
  assert.equal(
    (await queryDocs(COLLECTIONS.teamIntakeRecipients, [
      { field: "formId", value: fixture.formId },
    ], { limit: 0 })).length,
    1,
  );
});

test("simultaneous first issuance and scope update serialize on the form document", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "simultaneous");
  t.after(() => setServerFirestoreForTests(null));
  const issuanceEntered = deferred();
  const scopeEntered = deferred();
  const releaseIssuance = deferred();
  const releaseScope = deferred();
  db.setBeforeCommit(async (writes) => {
    if (writes.some(({ ref }) => ref.collectionName === COLLECTIONS.teamIntakeRecipients)) {
      issuanceEntered.resolve();
      await releaseIssuance.promise;
    } else if (writes.some(({ ref }) => ref.collectionName === COLLECTIONS.teamIntakeForms)) {
      scopeEntered.resolve();
      await releaseScope.promise;
    }
  });
  const issuance = callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [fixture.memberId] },
  });
  const scopeChange = callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: formPayload([fixture.avTeamId]),
  });
  await Promise.all([issuanceEntered.promise, scopeEntered.promise]);
  db.setBeforeCommit(null);
  releaseScope.resolve();
  const changed = await scopeChange;
  releaseIssuance.resolve();
  const issued = await issuance;
  assert.equal(changed.statusCode, 200, JSON.stringify(changed.payload));
  assert.equal(issued.statusCode, 409, JSON.stringify(issued.payload));
  assert.deepEqual(
    await queryDocs(COLLECTIONS.teamIntakeRecipients, [
      { field: "formId", value: fixture.formId },
    ], { limit: 0 }),
    [],
  );
});

test("a delayed metadata save cannot restore its stale Team scope after issuance", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "stale-metadata-save");
  t.after(() => setServerFirestoreForTests(null));
  const avMemberId = "concurrency_test_av_member_stale_metadata";
  await db.collection(COLLECTIONS.teams).doc(fixture.avTeamId).update({
    memberIds: [avMemberId],
  });
  await db.collection(COLLECTIONS.teamRosterMembers).doc(avMemberId).set({
    memberId: avMemberId,
    churchId: fixture.context.churchId,
    firstName: "Alex",
    lastName: "Volunteer",
    positionIds: [],
    teamMemberships: { [fixture.avTeamId]: { teamId: fixture.avTeamId } },
  });

  const saveEntered = deferred();
  const releaseSave = deferred();
  db.setBeforeDirectSet(async (ref, data) => {
    if (
      ref.collectionName === COLLECTIONS.teamIntakeForms &&
      ref.id === fixture.formId
    ) {
      db.setBeforeDirectSet(null);
      saveEntered.resolve(structuredClone(data));
      await releaseSave.promise;
    }
  });
  const staleMetadataSave = callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: formPayload([fixture.worshipTeamId], "Name edited by Editor A"),
  });
  const delayedWrite = await saveEntered.promise;

  const scopeChange = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: formPayload([fixture.avTeamId], "AV availability"),
  });
  const issuance = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [avMemberId] },
  });

  releaseSave.resolve();
  const saved = await staleMetadataSave;
  assert.equal(delayedWrite.teamIds, undefined);
  assert.equal(scopeChange.statusCode, 200, JSON.stringify(scopeChange.payload));
  assert.equal(issuance.statusCode, 200, JSON.stringify(issuance.payload));
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.payload));
  const storedForm = await getDoc(COLLECTIONS.teamIntakeForms, fixture.formId);
  assert.deepEqual(
    storedForm.teamIds,
    [fixture.avTeamId],
    `Delayed metadata write included stale Team IDs: ${JSON.stringify(delayedWrite.teamIds)}`,
  );
  assert.equal(storedForm.teamAvailabilityScopeLocked, true);
  assert.deepEqual(saved.payload.form.teamIds, [fixture.avTeamId]);
});

test("two operators can issue separate recipients concurrently after the first form lock", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "two-operators");
  const secondMemberId = "concurrency_test_second_member";
  await addWorshipMember(db, fixture, secondMemberId);
  const secondOperator = await createAdminContext(fixture.context.churchId, "operator-two");
  t.after(() => setServerFirestoreForTests(null));
  const bothAtCommit = deferred();
  const release = deferred();
  let arrivals = 0;
  db.setBeforeCommit(async (writes) => {
    if (writes.some(({ ref }) => ref.collectionName === COLLECTIONS.teamIntakeRecipients) && arrivals < 2) {
      arrivals += 1;
      if (arrivals === 2) bothAtCommit.resolve();
      await release.promise;
    }
  });
  const first = callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [fixture.memberId] },
  });
  const second = callHandler(authHandlers.createTeamIntakeRecipients, {
    context: secondOperator,
    params: { formId: fixture.formId },
    body: { memberIds: [secondMemberId] },
  });
  await bothAtCommit.promise;
  db.setBeforeCommit(null);
  release.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.statusCode, 200, JSON.stringify(firstResult.payload));
  assert.equal(secondResult.statusCode, 200, JSON.stringify(secondResult.payload));
  const storedRecipients = await queryDocs(COLLECTIONS.teamIntakeRecipients, [
    { field: "formId", value: fixture.formId },
  ], { limit: 0 });
  assert.deepEqual(new Set(storedRecipients.map((item) => item.memberId)), new Set([fixture.memberId, secondMemberId]));
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, fixture.formId)).teamAvailabilityScopeLocked,
    true,
  );
});

test("multi-member issuance leaves no partial recipients when the scope update wins", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "atomic-batch");
  const secondMemberId = "concurrency_test_atomic_second_member";
  await addWorshipMember(db, fixture, secondMemberId);
  t.after(() => setServerFirestoreForTests(null));
  const barrier = installRecipientCommitBarrier(db);
  const issuance = callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [fixture.memberId, secondMemberId] },
  });
  await barrier.entered;
  const changed = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: formPayload([fixture.avTeamId]),
  });
  barrier.release();
  const issued = await issuance;
  assert.equal(changed.statusCode, 200, JSON.stringify(changed.payload));
  assert.equal(issued.statusCode, 409, JSON.stringify(issued.payload));
  assert.deepEqual(
    await queryDocs(COLLECTIONS.teamIntakeRecipients, [
      { field: "formId", value: fixture.formId },
    ], { limit: 0 }),
    [],
  );
});

test("SMS availability preparation shares the form lock and leaves no recipient when scope wins", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "sms-preparation");
  t.after(() => setServerFirestoreForTests(null));
  const barrier = installRecipientCommitBarrier(db);
  const preparation = authHandlers.prepareAvailabilityNotificationRecipients({
    churchId: fixture.context.churchId,
    formId: fixture.formId,
    memberIds: [fixture.memberId],
    purpose: "availability_request",
    actorUid: "sms-operator",
  });
  await barrier.entered;
  const changed = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: formPayload([fixture.avTeamId]),
  });
  barrier.release();
  await assert.rejects(preparation, (error) => error.statusCode === 409);
  assert.equal(changed.statusCode, 200, JSON.stringify(changed.payload));
  assert.deepEqual(
    await queryDocs(COLLECTIONS.teamIntakeRecipients, [
      { field: "formId", value: fixture.formId },
    ], { limit: 0 }),
    [],
  );
  assert.deepEqual(
    await queryDocs(COLLECTIONS.notificationIntents, [
      { field: "formId", value: fixture.formId },
    ], { limit: 0 }),
    [],
  );
});

test("existing recipient reuse preserves the personalized token and issuance lock", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "reuse");
  t.after(() => setServerFirestoreForTests(null));
  const first = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [fixture.memberId] },
  });
  assert.equal(first.statusCode, 200, JSON.stringify(first.payload));
  const recipientId = first.payload.recipients[0].recipientId;
  const getLink = () => callHandler(authHandlers.getTeamIntakeRecipientLink, {
    context: fixture.context,
    params: { recipientId },
  });
  const firstLink = await getLink();
  const repeat = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [fixture.memberId] },
  });
  const reusedLink = await getLink();
  assert.equal(repeat.statusCode, 200, JSON.stringify(repeat.payload));
  assert.equal(firstLink.payload.publicUrl, reusedLink.payload.publicUrl);
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, fixture.formId)).teamAvailabilityScopeLocked,
    true,
  );
  assert.equal(
    (await queryDocs(COLLECTIONS.teamIntakeRecipients, [
      { field: "formId", value: fixture.formId },
    ], { limit: 0 })).length,
    1,
  );
});

test("reminder preparation reuses a legacy recipient and restores its form lock", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "reminder-reuse");
  t.after(() => setServerFirestoreForTests(null));
  const issued = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [fixture.memberId] },
  });
  assert.equal(issued.statusCode, 200, JSON.stringify(issued.payload));
  const recipientId = issued.payload.recipients[0].recipientId;
  const originalLink = await callHandler(authHandlers.getTeamIntakeRecipientLink, {
    context: fixture.context,
    params: { recipientId },
  });
  await setDoc(
    COLLECTIONS.teamIntakeForms,
    fixture.formId,
    { teamAvailabilityScopeLocked: false },
    { merge: true },
  );

  const entered = deferred();
  const release = deferred();
  db.setBeforeCommit(async (writes) => {
    if (writes.some(({ ref }) => ref.collectionName === COLLECTIONS.teamIntakeForms)) {
      db.setBeforeCommit(null);
      entered.resolve();
      await release.promise;
    }
  });
  const reminder = authHandlers.prepareAvailabilityNotificationRecipients({
    churchId: fixture.context.churchId,
    formId: fixture.formId,
    memberIds: [fixture.memberId],
    purpose: "availability_reminder",
    actorUid: "reminder-operator",
  });
  await entered.promise;
  const scopeChange = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: formPayload([fixture.avTeamId]),
  });
  release.resolve();
  const prepared = await reminder;

  assert.equal(scopeChange.statusCode, 409, JSON.stringify(scopeChange.payload));
  assert.equal(prepared.results[0].publicUrl, originalLink.payload.publicUrl);
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, fixture.formId)).teamAvailabilityScopeLocked,
    true,
  );
});

test("revocation does not clear the permanent Team-scope lock", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "revoked");
  t.after(() => setServerFirestoreForTests(null));
  const issued = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [fixture.memberId] },
  });
  assert.equal(issued.statusCode, 200, JSON.stringify(issued.payload));
  const recipientId = issued.payload.recipients[0].recipientId;
  const revoked = await callHandler(authHandlers.revokeTeamIntakeRecipient, {
    context: fixture.context,
    params: { recipientId },
  });
  assert.equal(revoked.statusCode, 200, JSON.stringify(revoked.payload));
  const change = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: formPayload([fixture.avTeamId]),
  });
  assert.equal(change.statusCode, 409, JSON.stringify(change.payload));
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, fixture.formId)).teamAvailabilityScopeLocked,
    true,
  );
  assert.ok((await getDoc(COLLECTIONS.teamIntakeRecipients, recipientId)).revokedAt);
});

test("legacy recipient records lock Team scope even when the marker is absent", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "legacy");
  t.after(() => setServerFirestoreForTests(null));
  await db.collection(COLLECTIONS.teamIntakeRecipients).doc("legacy-recipient").set({
    recipientId: "legacy-recipient",
    churchId: fixture.context.churchId,
    formId: fixture.formId,
    memberId: fixture.memberId,
    revokedAt: "2025-01-01T00:00:00.000Z",
  });
  const change = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: formPayload([fixture.avTeamId]),
  });
  assert.equal(change.statusCode, 409, JSON.stringify(change.payload));
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, fixture.formId)).teamAvailabilityScopeLocked,
    undefined,
  );
  assert.deepEqual(
    (await getDoc(COLLECTIONS.teamIntakeRecipients, "legacy-recipient")).revokedAt,
    "2025-01-01T00:00:00.000Z",
  );
});

test("reordering an issued form's identical Team IDs remains valid", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "reorder");
  t.after(() => setServerFirestoreForTests(null));
  await db.collection(COLLECTIONS.teamIntakeForms).doc(fixture.formId).update({
    teamIds: [fixture.worshipTeamId, fixture.avTeamId],
  });
  const issued = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [fixture.memberId] },
  });
  assert.equal(issued.statusCode, 200, JSON.stringify(issued.payload));
  const reordered = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: formPayload([fixture.avTeamId, fixture.worshipTeamId]),
  });
  assert.equal(reordered.statusCode, 200, JSON.stringify(reordered.payload));
  assert.deepEqual(reordered.payload.form.teamIds, [fixture.avTeamId, fixture.worshipTeamId]);
  assert.equal(reordered.payload.form.teamAvailabilityScopeLocked, undefined);
});

test("name and deadline edits preserve the lock and ignore client attempts to clear it", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "form-edits");
  t.after(() => setServerFirestoreForTests(null));
  const issued = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: { memberIds: [fixture.memberId] },
  });
  assert.equal(issued.statusCode, 200, JSON.stringify(issued.payload));
  const responseDeadline = dateFromToday(10);
  const edited = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId: fixture.formId },
    body: {
      ...formPayload([fixture.worshipTeamId], "Updated availability name"),
      responseDeadline,
      teamAvailabilityScopeLocked: false,
    },
  });
  assert.equal(edited.statusCode, 200, JSON.stringify(edited.payload));
  assert.equal(edited.payload.form.name, "Updated availability name");
  assert.equal(edited.payload.form.responseDeadline, responseDeadline);
  assert.equal(edited.payload.form.teamAvailabilityScopeLocked, undefined);
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, fixture.formId)).teamAvailabilityScopeLocked,
    true,
  );
});

test("general intake recipient issuance does not add the availability scope lock", async (t) => {
  const db = createFirestoreMock();
  const fixture = await createFixture(db, "general");
  t.after(() => setServerFirestoreForTests(null));
  const generalPayload = {
    ...formPayload([fixture.worshipTeamId], "General intake"),
    purpose: "general_intake",
    enabledFields: ["firstName"],
  };
  const created = await callHandler(authHandlers.createTeamIntakeForm, {
    context: fixture.context,
    body: generalPayload,
  });
  assert.equal(created.statusCode, 200, JSON.stringify(created.payload));
  const formId = created.payload.form.formId;
  const issued = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: fixture.context,
    params: { formId },
    body: { memberIds: [fixture.memberId] },
  });
  assert.equal(issued.statusCode, 200, JSON.stringify(issued.payload));
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, formId)).teamAvailabilityScopeLocked,
    undefined,
  );
  const changed = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: fixture.context,
    params: { formId },
    body: { ...generalPayload, teamIds: [fixture.avTeamId] },
  });
  assert.equal(changed.statusCode, 200, JSON.stringify(changed.payload));
});

test("non-Firestore fallback preserves sequential single-process behavior only", async (t) => {
  // This exercises the in-memory fallback. Its queue is process-local; the
  // distributed interleavings above specifically exercise Firestore transactions.
  setServerFirestoreForTests(null);
  const churchId = "concurrency_fallback_church";
  const formId = "concurrency_fallback_form";
  const worshipTeamId = "concurrency_fallback_worship";
  const avTeamId = "concurrency_fallback_av";
  const memberId = "concurrency_fallback_member";
  const context = await createAdminContext(churchId, "fallback");
  await setDoc(COLLECTIONS.churches, churchId, { churchId, name: "Fallback Church" });
  await setDoc(COLLECTIONS.teams, worshipTeamId, {
    teamId: worshipTeamId,
    churchId,
    name: "Worship",
    memberIds: [memberId],
  });
  await setDoc(COLLECTIONS.teams, avTeamId, {
    teamId: avTeamId,
    churchId,
    name: "AV",
    memberIds: [],
  });
  await setDoc(COLLECTIONS.teamRosterMembers, memberId, {
    memberId,
    churchId,
    firstName: "Fallback",
    lastName: "Member",
    positionIds: [],
    teamMemberships: { [worshipTeamId]: { teamId: worshipTeamId } },
  });
  await setDoc(COLLECTIONS.teamIntakeForms, formId, {
    formId,
    churchId,
    ...formPayload([worshipTeamId]),
  });
  const issued = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context,
    params: { formId },
    body: { memberIds: [memberId] },
  });
  assert.equal(issued.statusCode, 200, JSON.stringify(issued.payload));
  assert.equal((await getDoc(COLLECTIONS.teamIntakeForms, formId)).teamAvailabilityScopeLocked, true);
  const changed = await callHandler(authHandlers.updateTeamIntakeForm, {
    context,
    params: { formId },
    body: formPayload([avTeamId]),
  });
  assert.equal(changed.statusCode, 409, JSON.stringify(changed.payload));
  t.after(() => setServerFirestoreForTests(null));
});
