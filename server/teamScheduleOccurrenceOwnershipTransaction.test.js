process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createTeamsAuthHandlers } from "./teamsAuthHandlers.js";

const {
  authHandlers,
  COLLECTIONS,
  deleteDoc,
  getDoc,
  queryDocs,
  seedActiveHumanBearerForServerTests,
  seedChurchServiceTimesForServerTests,
  setDoc,
  setServerFirestoreForTests,
} = await import("../authService.js");

const clone = (value) => structuredClone(value);
const mergeFirestore = (current, update) => {
  const result = { ...(current || {}) };
  for (const [key, value] of Object.entries(update)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeFirestore(result[key], value)
      : clone(value);
  }
  return result;
};

const createTransactionalFirestore = () => {
  const stores = new Map();
  const documentVersions = new Map();
  const collectionVersions = new Map();
  const stats = {
    attempts: 0,
    commits: 0,
    retries: 0,
    readAfterWriteAttempts: 0,
  };
  const getStore = (collectionName) => {
    if (!stores.has(collectionName)) stores.set(collectionName, new Map());
    return stores.get(collectionName);
  };
  const docKey = (collectionName, id) => `${collectionName}/${id}`;
  const documentVersion = (collectionName, id) =>
    documentVersions.get(docKey(collectionName, id)) || 0;
  const collectionVersion = (collectionName) => collectionVersions.get(collectionName) || 0;
  const bumpVersion = (collectionName, id) => {
    const key = docKey(collectionName, id);
    documentVersions.set(key, documentVersion(collectionName, id) + 1);
    collectionVersions.set(collectionName, collectionVersion(collectionName) + 1);
  };
  const snapshotFor = (id, value, ref) => ({
    id,
    ref,
    exists: value !== undefined,
    data: () => (value === undefined ? undefined : clone(value)),
  });
  const matchesQuery = (id, value, filters) => filters.every(({ field, operator, expected }) => {
    const actual = field === "__name__" ? id : value[field];
    if (operator === "==") return actual === expected;
    if (operator === "in") return Array.isArray(expected) && expected.includes(actual);
    if (operator === ">") return actual > expected;
    if (operator === "array-contains") return Array.isArray(actual) && actual.includes(expected);
    return false;
  });
  const collection = (collectionName) => {
    const store = getStore(collectionName);
    const doc = (id) => {
      const ref = { kind: "document", collectionName, id: String(id) };
      ref.get = async () => snapshotFor(ref.id, store.get(ref.id), ref);
      ref.set = async (value, options = {}) => {
        const next = options.merge
          ? mergeFirestore(store.get(ref.id), value)
          : clone(value);
        store.set(ref.id, next);
        bumpVersion(collectionName, ref.id);
      };
      ref.update = async (value) => {
        if (!store.has(ref.id)) throw new Error("document does not exist");
        store.set(ref.id, { ...store.get(ref.id), ...clone(value) });
        bumpVersion(collectionName, ref.id);
      };
      ref.delete = async () => {
        store.delete(ref.id);
        bumpVersion(collectionName, ref.id);
      };
      return ref;
    };
    const makeQuery = (filters = [], limit = Infinity) => {
      const query = {
        kind: "query",
        collectionName,
        filters,
        limitValue: limit,
        where(field, operator, expected) {
          return makeQuery([...filters, { field, operator, expected }], limit);
        },
        limit(count) {
          return makeQuery(filters, count);
        },
        async get() {
          const docs = [...store.entries()]
            .filter(([id, value]) => matchesQuery(id, value, filters))
            .slice(0, limit)
            .map(([id, value]) => ({
              id,
              ref: doc(id),
              data: () => clone(value),
            }));
          return { docs };
        },
      };
      return query;
    };
    return {
      doc,
      where(field, operator, expected) {
        return makeQuery([{ field, operator, expected }]);
      },
      async get() {
        return makeQuery().get();
      },
    };
  };
  const applyWrite = ({ type, ref, data, options = {} }) => {
    const store = getStore(ref.collectionName);
    if (type === "delete") store.delete(ref.id);
    else if (type === "create") {
      if (store.has(ref.id)) throw new Error("document already exists");
      store.set(ref.id, clone(data));
    } else if (type === "update") {
      if (!store.has(ref.id)) throw new Error("document does not exist");
      store.set(ref.id, { ...store.get(ref.id), ...clone(data) });
    } else {
      store.set(ref.id, options.merge
        ? mergeFirestore(store.get(ref.id), data)
        : clone(data));
    }
    bumpVersion(ref.collectionName, ref.id);
  };

  const database = {
    collection,
    stats,
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        stats.attempts += 1;
        const reads = new Map();
        const writes = [];
        let writeStarted = false;
        const transaction = {
          async get(target) {
            if (writeStarted) {
              stats.readAfterWriteAttempts += 1;
              throw new Error("Firestore transaction attempted a read after a write");
            }
            if (target.kind === "query") {
              const key = `query:${target.collectionName}`;
              if (!reads.has(key)) reads.set(key, {
                kind: "query",
                collectionName: target.collectionName,
                version: collectionVersion(target.collectionName),
              });
              return target.get();
            }
            if (target.kind !== "document") throw new Error("Unsupported transaction read");
            const key = `document:${docKey(target.collectionName, target.id)}`;
            if (!reads.has(key)) reads.set(key, {
              kind: "document",
              collectionName: target.collectionName,
              id: target.id,
              version: documentVersion(target.collectionName, target.id),
            });
            const value = getStore(target.collectionName).get(target.id);
            return snapshotFor(target.id, value, target);
          },
          set(ref, data, options = {}) {
            writeStarted = true;
            writes.push({ type: "set", ref, data: clone(data), options });
          },
          create(ref, data) {
            writeStarted = true;
            writes.push({ type: "create", ref, data: clone(data) });
          },
          update(ref, data) {
            writeStarted = true;
            writes.push({ type: "update", ref, data: clone(data) });
          },
          delete(ref) {
            writeStarted = true;
            writes.push({ type: "delete", ref });
          },
        };
        const result = await callback(transaction);
        const staleRead = [...reads.values()].some((read) => read.kind === "query"
          ? collectionVersion(read.collectionName) !== read.version
          : documentVersion(read.collectionName, read.id) !== read.version);
        if (staleRead) {
          stats.retries += 1;
          await new Promise((resolve) => setImmediate(resolve));
          continue;
        }
        for (const write of writes) {
          if (write.type === "create" && getStore(write.ref.collectionName).has(write.ref.id)) {
            throw new Error("document already exists");
          }
        }
        writes.forEach(applyWrite);
        stats.commits += 1;
        return result;
      }
      throw new Error("Firestore transaction retry limit exceeded");
    },
  };
  return database;
};

const createSession = () => ({ destroy(callback) { callback?.(); } });
const createReq = ({ params = {}, headers = {}, session = createSession(), body = {} } = {}) => ({
  params,
  headers,
  session,
  body,
});
const createRes = () => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
  send(payload) { this.body = payload; return this; },
  set() { return this; },
  clearCookie() { return this; },
});

const createAdminContext = async (suffix) => {
  const session = createSession();
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req: createReq({ session }),
    userId: `schedule_ownership_admin_${suffix}`,
    email: `schedule-ownership-${suffix}@example.test`,
    churchId: `schedule_ownership_church_${suffix}`,
    role: "admin",
  });
  await setDoc(COLLECTIONS.churches, `schedule_ownership_church_${suffix}`, {
    serviceTimeZone: "UTC",
  }, { merge: true });
  const meRes = createRes();
  await authHandlers.getAuthMe(createReq({
    session,
    headers: { authorization: `Bearer ${humanApiToken}` },
  }), meRes);
  return {
    churchId: `schedule_ownership_church_${suffix}`,
    headers: {
      authorization: `Bearer ${humanApiToken}`,
      "x-csrf-token": String(meRes.payload?.csrfToken || ""),
    },
    session,
  };
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

const createFixture = async (suffix, services, firestore = true) => {
  const db = firestore ? createTransactionalFirestore() : null;
  setServerFirestoreForTests(db);
  const context = await createAdminContext(suffix);
  const teamId = `schedule_ownership_team_${suffix}`;
  await setDoc(COLLECTIONS.teams, teamId, {
    teamId,
    churchId: context.churchId,
    name: "Media",
    memberIds: [],
    archivedAt: null,
  });
  seedChurchServiceTimesForServerTests({ churchId: context.churchId, services });
  return { db, context, teamId };
};

const occurrence = (serviceId, startsAt) => ({
  occurrenceId: `${serviceId}@${startsAt}`,
  serviceId,
  name: serviceId,
  startsAt,
  positionRequirements: [],
});
const service = (serviceId, startsAt) => ({
  id: serviceId,
  serviceId,
  name: serviceId,
  reccurence: "one_time",
  dateTimeISO: startsAt,
});
const periodBody = (teamId, startDate, endDate, occurrences) => ({
  name: "October",
  teamId,
  startDate,
  endDate,
  timeZone: "UTC",
  serviceIds: [...new Set(occurrences.map((item) => item.serviceId))],
  occurrences,
});

for (const firestore of [false, true]) {
  test(`${firestore ? "Firestore" : "in-memory"} delete overlapping ensure cannot leave dangling or erase regenerated claims`, async (t) => {
    const first = occurrence("first", "2026-10-10T12:00:00.000Z");
    const second = occurrence("second", "2026-10-17T12:00:00.000Z");
    const services = [service("first", first.startsAt), service("second", second.startsAt)];
    const { db, context, teamId } = await createFixture(`delete_race_${firestore}`, services, firestore);
    t.after(() => setServerFirestoreForTests(null));
    let resume;
    let entered;
    const gate = new Promise((resolve) => { resume = resolve; });
    const paused = new Promise((resolve) => { entered = resolve; });
    let didPause = false;
    const pause = async () => { if (!didPause) { didPause = true; entered(); await gate; } };
    const operator = { user: { uid: "race-operator" } };
    const handlers = createTeamsAuthHandlers({
      COLLECTIONS, getDoc, setDoc, deleteDoc,
      queryDocs: async (collection, filters) => {
        const result = await queryDocs(collection, filters);
        if (collection === COLLECTIONS.teamScheduleOccurrenceOwners && filters.some((filter) => filter.field === "scheduleId")) await pause();
        return result;
      },
      requireFirestore: () => db,
      assertCsrf: async () => {}, requireAdminSession: async () => operator,
      requireTeamsEditForTeamSession: async () => operator,
      readChurchServiceTimes: async () => services,
      normalizeEmail: (value) => String(value || "").toLowerCase(),
      nowIso: () => new Date().toISOString(), createId: (prefix) => `${prefix}_${randomUUID()}`,
      httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
      addSecurityEvent: async () => {},
    });
    const body = periodBody(teamId, "2026-10-01", "2026-10-31", [first]);
    const created = await callHandler(handlers.ensureTeamScheduleForPeriod, { context, body });
    assert.equal(created.statusCode, 200, JSON.stringify(created.payload));
    assert.equal(created.payload.schedule.published, false, "the first edit must persist a private Draft");
    const scheduleId = created.payload.schedule.scheduleId;
    if (db) {
      const original = db.runTransaction.bind(db);
      db.runTransaction = (callback) => original((transaction) => callback({ ...transaction, get: async (target) => {
        const snapshot = await transaction.get(target);
        if (target.kind === "query" && target.collectionName === COLLECTIONS.teamScheduleOccurrenceOwners) await pause();
        return snapshot;
      } }));
    }
    const deletion = callHandler(handlers.deleteTeamSchedule, { context, params: { scheduleId } });
    await Promise.race([paused, deletion.then((result) => { throw new Error(`Delete did not reach claim read: ${JSON.stringify(result.payload)}`); })]);
    const expanded = periodBody(teamId, "2026-10-01", "2026-10-31", [first, second]);
    const ensure = callHandler(handlers.ensureTeamScheduleForPeriod, { context, body: expanded });
    const create = callHandler(handlers.createTeamSchedule, { context, body: expanded });
    await new Promise((resolve) => setImmediate(resolve));
    resume();
    const results = await Promise.all([deletion, ensure, create]);
    assert.ok(results.every((result) => [200, 409].includes(result.statusCode)), JSON.stringify(results));
    const final = await callHandler(handlers.ensureTeamScheduleForPeriod, { context, body: expanded });
    assert.equal(final.statusCode, 200, JSON.stringify(final.payload));
    const claims = await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [{ field: "churchId", value: context.churchId }]);
    assert.equal(claims.length, 2);
    assert.ok(claims.every((claim) => claim.scheduleId === final.payload.schedule.scheduleId));
    const stored = await getDoc(COLLECTIONS.teamSchedules, final.payload.schedule.scheduleId);
    assert.equal(stored.occurrences.length, 2);
    if (db) assert.equal(db.stats.readAfterWriteAttempts, 0);
  });

  test(`${firestore ? "Firestore" : "in-memory"} deletion releases only exact owned claims and permits repeated regeneration`, async (t) => {
    const event = occurrence("sunday", "2026-10-10T12:00:00.000Z");
    const { db, context, teamId } = await createFixture(`delete_${firestore}`, [service("sunday", event.startsAt)], firestore);
    t.after(() => setServerFirestoreForTests(null));
    const body = periodBody(teamId, "2026-10-01", "2026-10-31", [event]);
    const created = await callHandler(authHandlers.ensureTeamScheduleForPeriod, { context, body });
    assert.equal(created.statusCode, 200, JSON.stringify(created.payload));
    const scheduleId = created.payload.schedule.scheduleId;
    const [claim] = await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [{ field: "churchId", value: context.churchId }]);
    const foreignClaims = [
      { ...claim, id: "foreign-team", teamId: "other-team" },
      { ...claim, id: "foreign-church", churchId: "other-church" },
      { ...claim, id: "foreign-owner", scheduleId: "other-schedule" },
    ];
    // Also release a claim left over from an earlier occurrence list.
    const { id: claimId, ...claimData } = claim;
    await setDoc(COLLECTIONS.teamScheduleOccurrenceOwners, "old-occurrence", { ...claimData, logicalOccurrenceId: "old@2026-10-03" });
    for (let index = 0; index < 125; index++) await setDoc(COLLECTIONS.teamScheduleOccurrenceOwners, `old-${index}`, { ...claimData, logicalOccurrenceId: `old-${index}` });
    for (const { id, ...data } of foreignClaims) await setDoc(COLLECTIONS.teamScheduleOccurrenceOwners, id, data);
    const foreignBefore = await Promise.all(foreignClaims.map(({ id }) => getDoc(COLLECTIONS.teamScheduleOccurrenceOwners, id)));
    for (let run = 0; run < 2; run++) {
      const deleted = await callHandler(authHandlers.deleteTeamSchedule, { context, params: { scheduleId } });
      assert.equal(deleted.statusCode, 200, JSON.stringify(deleted.payload));
      assert.equal(await getDoc(COLLECTIONS.teamSchedules, scheduleId), null);
      assert.equal(await getDoc(COLLECTIONS.teamScheduleOccurrenceOwners, claim.id), null);
      assert.equal(await getDoc(COLLECTIONS.teamScheduleOccurrenceOwners, "old-occurrence"), null);
      for (let index = 0; index < 125; index++) assert.equal(await getDoc(COLLECTIONS.teamScheduleOccurrenceOwners, `old-${index}`), null);
      for (const [index, { id }] of foreignClaims.entries()) assert.deepEqual(await getDoc(COLLECTIONS.teamScheduleOccurrenceOwners, id), foreignBefore[index]);
      const regenerated = await callHandler(authHandlers.ensureTeamScheduleForPeriod, { context, body });
      assert.equal(regenerated.statusCode, 200, JSON.stringify(regenerated.payload));
      assert.equal(regenerated.payload.schedule.scheduleId, scheduleId);
      assert.equal(regenerated.payload.created, true);
      assert.equal((await getDoc(COLLECTIONS.teamScheduleOccurrenceOwners, claim.id)).scheduleId, scheduleId);
    }
    if (db) assert.equal(db.stats.readAfterWriteAttempts, 0);
  });

  test(`${firestore ? "Firestore" : "in-memory"} deleting a former owner preserves a replacement owner's claim`, async (t) => {
    const event = occurrence("sunday", "2026-10-10T12:00:00.000Z");
    const { context, teamId } = await createFixture(`delete_replaced_${firestore}`, [service("sunday", event.startsAt)], firestore);
    t.after(() => setServerFirestoreForTests(null));
    const body = periodBody(teamId, "2026-10-01", "2026-10-31", [event]);
    const first = await callHandler(authHandlers.createTeamSchedule, { context, body });
    assert.equal(first.statusCode, 200);
    const scheduleId = first.payload.schedule.scheduleId;
    await setDoc(COLLECTIONS.teamSchedules, scheduleId, { occurrences: [] }, { merge: true });
    const replacement = await callHandler(authHandlers.createTeamSchedule, { context, body });
    assert.equal(replacement.statusCode, 200, JSON.stringify(replacement.payload));
    const claims = await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [{ field: "churchId", value: context.churchId }]);
    const deleted = await callHandler(authHandlers.deleteTeamSchedule, { context, params: { scheduleId } });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [{ field: "churchId", value: context.churchId }]), claims);
    assert.ok(await getDoc(COLLECTIONS.teamSchedules, replacement.payload.schedule.scheduleId));
  });
}

test("Firestore occurrence ownership transactions serialize overlapping creates and reject the loser", async (t) => {
  const startsAt = "2026-10-10T12:00:00.000Z";
  const fixture = await createFixture("overlap", [service("combined", startsAt)]);
  t.after(() => setServerFirestoreForTests(null));
  const event = occurrence("combined", startsAt);
  const firstBody = periodBody(fixture.teamId, "2026-10-01", "2026-10-15", [event]);
  const secondBody = periodBody(fixture.teamId, "2026-10-10", "2026-10-31", [event]);

  const results = await Promise.all([
    callHandler(authHandlers.ensureTeamScheduleForPeriod, { context: fixture.context, body: firstBody }),
    callHandler(authHandlers.ensureTeamScheduleForPeriod, { context: fixture.context, body: secondBody }),
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.ok(fixture.db.stats.retries >= 1, "the stale concurrent transaction retries against the committed claim");

  const schedules = await queryDocs(COLLECTIONS.teamSchedules, [
    { field: "churchId", value: fixture.context.churchId },
  ]);
  const claims = await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [
    { field: "churchId", value: fixture.context.churchId },
  ]);
  assert.equal(schedules.length, 1);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].scheduleId, schedules[0].scheduleId);
  assert.equal(claims[0].logicalOccurrenceId, `combined@2026-10-10`);

  const beforeSchedule = await getDoc(COLLECTIONS.teamSchedules, schedules[0].scheduleId);
  const beforeClaim = await getDoc(COLLECTIONS.teamScheduleOccurrenceOwners, claims[0].id);
  const rejected = await callHandler(authHandlers.createTeamSchedule, {
    context: fixture.context,
    body: { ...firstBody, name: "Duplicate ownership" },
  });
  assert.equal(rejected.statusCode, 409);
  assert.match(rejected.payload.errorMessage, /already owned/i);
  assert.deepEqual(await getDoc(COLLECTIONS.teamSchedules, schedules[0].scheduleId), beforeSchedule);
  assert.deepEqual(await getDoc(COLLECTIONS.teamScheduleOccurrenceOwners, claims[0].id), beforeClaim);
  assert.equal(fixture.db.stats.readAfterWriteAttempts, 0);
});

test("Firestore ensures preserve legacy schedules, remain idempotent, and atomically release and replace claims", async (t) => {
  const firstStartsAt = "2026-10-10T12:00:00.000Z";
  const secondStartsAt = "2026-10-17T12:00:00.000Z";
  const firstOccurrence = occurrence("service-a", firstStartsAt);
  const secondOccurrence = occurrence("service-b", secondStartsAt);
  const fixture = await createFixture("legacy", [
    service("service-a", firstStartsAt),
    service("service-b", secondStartsAt),
  ]);
  t.after(() => setServerFirestoreForTests(null));
  const legacySchedule = {
    scheduleId: "legacy-october",
    churchId: fixture.context.churchId,
    name: "Legacy October",
    teamId: fixture.teamId,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    serviceIds: ["service-a"],
    occurrences: [firstOccurrence],
    assignments: { [firstOccurrence.occurrenceId]: { "camera::0": { primaryMemberId: "member-preserved" } } },
    microphoneAssignments: { [firstOccurrence.occurrenceId]: { "camera::0": ["mic-preserved"] } },
    publicLinkToken: "legacy-public-token",
  };
  await fixture.db.collection(COLLECTIONS.teamSchedules).doc(legacySchedule.scheduleId).set(legacySchedule);
  const legacyBeforeDuplicate = await getDoc(COLLECTIONS.teamSchedules, legacySchedule.scheduleId);

  const duplicate = await callHandler(authHandlers.createTeamSchedule, {
    context: fixture.context,
    body: { ...periodBody(fixture.teamId, "2026-10-01", "2026-10-31", [firstOccurrence]), name: "Duplicate" },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.match(duplicate.payload.errorMessage, /already owned/i);
  assert.deepEqual(await getDoc(COLLECTIONS.teamSchedules, legacySchedule.scheduleId), legacyBeforeDuplicate);
  assert.deepEqual(await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [
    { field: "churchId", value: fixture.context.churchId },
  ]), []);

  const body = periodBody(fixture.teamId, "2026-10-01", "2026-10-31", [firstOccurrence, secondOccurrence]);
  const ensured = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context: fixture.context,
    body,
  });
  assert.equal(ensured.statusCode, 200, JSON.stringify(ensured.payload));
  assert.equal(ensured.payload.schedule.scheduleId, legacySchedule.scheduleId);
  assert.equal(ensured.payload.created, false);
  assert.deepEqual(ensured.payload.schedule.assignments, legacySchedule.assignments);
  assert.deepEqual(ensured.payload.schedule.microphoneAssignments, legacySchedule.microphoneAssignments);
  assert.equal(ensured.payload.schedule.publicLinkToken, legacySchedule.publicLinkToken);
  assert.ok(!ensured.payload.schedule.archivedAt, "the legacy schedule remains active");
  assert.equal((await queryDocs(COLLECTIONS.teamSchedules, [
    { field: "churchId", value: fixture.context.churchId },
  ])).length, 1);
  let claims = await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [
    { field: "churchId", value: fixture.context.churchId },
  ]);
  assert.equal(claims.length, 2);
  assert.ok(claims.every((claim) => claim.scheduleId === legacySchedule.scheduleId));

  const afterEnsure = await getDoc(COLLECTIONS.teamSchedules, legacySchedule.scheduleId);
  const repeated = await callHandler(authHandlers.ensureTeamScheduleForPeriod, {
    context: fixture.context,
    body,
  });
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.payload.created, false);
  assert.deepEqual(await getDoc(COLLECTIONS.teamSchedules, legacySchedule.scheduleId), afterEnsure);
  assert.deepEqual(await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [
    { field: "churchId", value: fixture.context.churchId },
  ]), claims);

  const updateBody = {
    ...repeated.payload.schedule,
    name: "Legacy October updated",
    serviceIds: ["service-b"],
    occurrences: [secondOccurrence],
    assignments: {},
  };
  const updated = await callHandler(authHandlers.updateTeamSchedule, {
    context: fixture.context,
    params: { scheduleId: legacySchedule.scheduleId },
    body: updateBody,
  });
  assert.equal(updated.statusCode, 200, JSON.stringify(updated.payload));
  assert.deepEqual(updated.payload.schedule.occurrences.map((item) => item.occurrenceId), [secondOccurrence.occurrenceId]);
  claims = await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [
    { field: "churchId", value: fixture.context.churchId },
  ]);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].scheduleId, legacySchedule.scheduleId);
  assert.equal(claims[0].occurrenceId, secondOccurrence.occurrenceId);
  assert.equal(fixture.db.stats.readAfterWriteAttempts, 0);
});

for (const firestore of [false, true]) {
  const store = firestore ? "Firestore" : "in-memory";
  test(`${store} name-only schedule edits preserve operational metadata through persistence and detail reads`, async (t) => {
    const event = occurrence("sunday", "2026-10-10T12:00:00.000Z");
    const { context, teamId } = await createFixture(`metadata_${store}`, [service("sunday", event.startsAt)], firestore);
    t.after(() => setServerFirestoreForTests(null));
    const body = periodBody(teamId, "2026-10-01", "2026-10-31", [event]);
    body.assignments = { [event.occurrenceId]: { "camera::0": { primaryMemberId: "volunteer", shadows: [] } } };
    const created = await callHandler(authHandlers.createTeamSchedule, { context, body });
    assert.equal(created.statusCode, 200, JSON.stringify(created.payload));
    const scheduleId = created.payload.schedule.scheduleId;
    const metadata = {
      responses: { [event.occurrenceId]: { "camera::0": { memberId: "volunteer", response: "accepted", respondedAt: "2026-10-01T00:00:00.000Z" } } },
      publicLinkToken: "public-link-preserved", publicToken: "legacy-public-token",
      publicationStatus: "published", publishedAt: "2026-10-01T01:00:00.000Z",
      sentAt: "2026-10-02T00:00:00.000Z", sentByUid: "sender",
      publicationHistory: [{ actor: "publisher" }], notificationHistory: [{ status: "sent" }],
      deliveryState: { queued: true, attempt: 2 }, futureOperationalField: { keep: "all fields" },
    };
    await setDoc(COLLECTIONS.teamSchedules, scheduleId, metadata, { merge: true });
    const before = await getDoc(COLLECTIONS.teamSchedules, scheduleId);
    const edited = await callHandler(authHandlers.updateTeamSchedule, {
      context, params: { scheduleId }, body: { ...body, name: "Renamed only", publicLinkToken: "untrusted-replacement", createdAt: "untrusted" },
    });
    assert.equal(edited.statusCode, 200, JSON.stringify(edited.payload));
    const persisted = await getDoc(COLLECTIONS.teamSchedules, scheduleId);
    for (const [key, value] of Object.entries(metadata)) {
      assert.deepEqual(persisted[key], value, key);
      assert.deepEqual(edited.payload.schedule[key], value, `response ${key}`);
    }
    assert.deepEqual(persisted.assignments, before.assignments);
    assert.equal(persisted.scheduleId, scheduleId);
    assert.equal(persisted.createdAt, before.createdAt);
    assert.equal(persisted.createdByUid, before.createdByUid);
    assert.equal(persisted.name, "Renamed only");
    assert.ok(persisted.updatedAt >= before.updatedAt);
    const detail = await callHandler(authHandlers.getTeamScheduleDetail, { context, params: { scheduleId } });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(detail.payload.schedule.responses, metadata.responses);
    assert.deepEqual(detail.payload.schedule.assignments, before.assignments);
  });

  for (const groupId of [undefined, null, "genuine-conflicting-group"]) {
    test(`${store} standalone ownership normalizes ${String(groupId)} without accepting group conflicts`, async (t) => {
      const event = occurrence("sunday", "2026-10-10T12:00:00.000Z");
      const { context, teamId } = await createFixture(`claim_${store}_${String(groupId)}`, [service("sunday", event.startsAt)], firestore);
      t.after(() => setServerFirestoreForTests(null));
      const created = await callHandler(authHandlers.createTeamSchedule, { context, body: periodBody(teamId, "2026-10-01", "2026-10-31", [event]) });
      assert.equal(created.statusCode, 200, JSON.stringify(created.payload));
      const schedule = created.payload.schedule;
      const [claim] = await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [{ field: "churchId", value: context.churchId }]);
      const { id, ...claimData } = claim;
      if (groupId === undefined) delete claimData.groupId;
      else claimData.groupId = groupId;
      // The active former owner no longer contains this occurrence.
      await setDoc(COLLECTIONS.teamSchedules, schedule.scheduleId, { occurrences: [], assignments: { untouched: { "camera::0": "preserved" } } }, { merge: true });
      await setDoc(COLLECTIONS.teamScheduleOccurrenceOwners, id, claimData, { merge: false });
      const replacement = await callHandler(authHandlers.createTeamSchedule, { context, body: periodBody(teamId, "2026-10-01", "2026-10-31", [event]) });
      assert.equal(replacement.statusCode, groupId ? 409 : 200, JSON.stringify(replacement.payload));
      const owner = await getDoc(COLLECTIONS.teamSchedules, schedule.scheduleId);
      assert.deepEqual(owner.assignments, { untouched: { "camera::0": "preserved" } });
      if (!groupId) {
        // Also check legacy missing/null group IDs on a claim for the same schedule.
        const nextSchedule = replacement.payload.schedule;
        const nextClaim = await getDoc(COLLECTIONS.teamScheduleOccurrenceOwners, id);
        delete nextClaim.groupId;
        await setDoc(COLLECTIONS.teamScheduleOccurrenceOwners, id, nextClaim, { merge: false });
        const edited = await callHandler(authHandlers.updateTeamSchedule, { context, params: { scheduleId: nextSchedule.scheduleId }, body: { ...nextSchedule, name: "Legacy claim edit" } });
        assert.equal(edited.statusCode, 200, JSON.stringify(edited.payload));
      }
    });
  }
}

for (const firestore of [false, true]) {
  test(`${firestore ? "Firestore" : "in-memory"} concurrent import and create have one occurrence owner and preserve existing data`, async (t) => {
    const first = occurrence("sunday", "2026-10-10T12:00:00.000Z");
    const second = occurrence("sunday", "2026-10-17T12:00:00.000Z");
    const services = [service("sunday", first.startsAt)];
    const { db, context, teamId } = await createFixture(`import_race_${firestore}`, services, firestore);
    t.after(() => setServerFirestoreForTests(null));
    const created = await callHandler(authHandlers.createTeamSchedule, { context, body: periodBody(teamId, "2026-10-01", "2026-10-31", [first]) });
    assert.equal(created.statusCode, 200);
    const scheduleId = created.payload.schedule.scheduleId;
    const assignments = { [first.occurrenceId]: { "camera::0": { primaryMemberId: "preserved-volunteer" } } };
    await setDoc(COLLECTIONS.teamSchedules, scheduleId, { assignments, publicLinkToken: "preserved-token" }, { merge: true });
    const targetClaimId = createHash("sha256").update(`${context.churchId}\u0000${teamId}\u0000sunday@2026-10-17`).digest("hex");
    let releaseImport;
    const gate = new Promise((resolve) => { releaseImport = resolve; });
    let entered;
    const paused = new Promise((resolve) => { entered = resolve; });
    let didPause = false;
    const pauseClaimRead = async (collectionName, id) => {
      const value = await getDoc(collectionName, id);
      if (!didPause && collectionName === COLLECTIONS.teamScheduleOccurrenceOwners && id === targetClaimId) {
        didPause = true;
        entered();
        await gate;
      }
      return value;
    };
    // Keep real storage and handlers; inject a controllable read and an authorized
    // operator to stop precisely between ownership validation and commit.
    const operator = { user: { uid: "race-operator" } };
    const handlers = createTeamsAuthHandlers({
      COLLECTIONS, getDoc: pauseClaimRead, queryDocs, setDoc,
      hashValue: (value) => createHash("sha256").update(String(value)).digest("hex"),
      requireFirestore: () => db,
      assertCsrf: async () => {}, requireAdminSession: async () => operator,
      requireTeamsViewSession: async () => operator,
      requireTeamsEditForTeamSession: async () => operator,
      readChurchServiceTimes: async () => services,
      normalizeEmail: (value) => String(value || "").trim().toLowerCase(),
      nowIso: () => new Date().toISOString(), createId: (prefix) => `${prefix}_${randomUUID()}`,
      httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
      addSecurityEvent: async () => {},
    });
    // Firestore's transaction.get bypasses getDoc, so gate its claim read instead.
    if (db) {
      const original = db.runTransaction.bind(db);
      db.runTransaction = (callback) => original((transaction) => callback({ ...transaction, get: async (target) => {
        const snapshot = await transaction.get(target);
        if (!didPause && target.collectionName === COLLECTIONS.teamScheduleOccurrenceOwners && target.id === targetClaimId) {
          didPause = true; entered(); await gate;
        }
        return snapshot;
      } }));
    }
    const imported = callHandler(handlers.commitPortableImport, { context, body: { type: "schedules", approvedRows: [{ row: 2, action: "update", recordId: scheduleId, record: {
      name: "October", team: "Media", teamId, startDate: "2026-10-01", endDate: "2026-10-31", service: "sunday", serviceId: "sunday", date: "2026-10-17", startTime: "12:00",
    } }] } });
    await Promise.race([paused, imported.then((result) => { throw new Error(`Import finished before ownership read: ${JSON.stringify(result.payload)}`); })]);
    const rival = callHandler(handlers.createTeamSchedule, { context, body: { ...periodBody(teamId, "2026-10-17", "2026-10-17", [second]), name: "Rival" } });
    // Let the competing request reach its lock/transaction before releasing import.
    await new Promise((resolve) => setImmediate(resolve));
    releaseImport();
    const results = await Promise.all([imported, rival]);
    const schedules = await queryDocs(COLLECTIONS.teamSchedules, [{ field: "churchId", value: context.churchId }]);
    const owners = schedules.filter((schedule) => (schedule.occurrences || []).some((event) => event.startsAt === second.startsAt));
    assert.equal(owners.length, 1, JSON.stringify(results.map((result) => result.payload)));
    const claims = await queryDocs(COLLECTIONS.teamScheduleOccurrenceOwners, [{ field: "churchId", value: context.churchId }]);
    assert.equal(claims.filter((claim) => claim.logicalOccurrenceId === "sunday@2026-10-17").length, 1);
    const original = await getDoc(COLLECTIONS.teamSchedules, scheduleId);
    assert.deepEqual(original.assignments, assignments);
    assert.equal(original.publicLinkToken, "preserved-token");
    assert.equal((results[0].payload.summary.updated || 0) + (results[1].statusCode === 200 ? 1 : 0), 1);
  });
}
