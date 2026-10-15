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

const createFixture = async (suffix, services) => {
  const db = createTransactionalFirestore();
  setServerFirestoreForTests(db);
  const context = await createAdminContext(suffix);
  const teamId = `schedule_ownership_team_${suffix}`;
  await db.collection(COLLECTIONS.teams).doc(teamId).set({
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
