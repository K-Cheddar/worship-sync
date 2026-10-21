import test from "node:test";
import assert from "node:assert/strict";
import { createVolunteerOperations } from "./volunteerOperations.js";

const NOW = "2026-10-20T12:00:00.000Z";

const createMemoryFixture = ({ failScheduleId = "", maxScheduleGroupsPerRequest } = {}) => {
  const COLLECTIONS = {
    teamSchedules: "teamSchedules",
    teamRosterMembers: "teamRosterMembers",
    memberships: "memberships",
  };
  const collections = new Map(
    Object.values(COLLECTIONS).map((name) => [name, new Map()]),
  );
  const scheduleQueries = [];
  const queueTails = new Map();
  const failingSchedules = new Set(failScheduleId ? [failScheduleId] : []);
  const enqueueSchedule = (scheduleId, task) => {
    const previous = queueTails.get(scheduleId) || Promise.resolve();
    const result = previous.then(task, task);
    queueTails.set(scheduleId, result.catch(() => undefined));
    return result;
  };
  const getDoc = async (collection, id) => {
    if (collection === COLLECTIONS.teamSchedules && failingSchedules.has(id)) {
      throw new Error("Injected schedule read failure");
    }
    return collections.get(collection).get(id) || null;
  };
  const queryDocs = async (collection, filters = [], options = {}) => {
    if (collection === COLLECTIONS.teamSchedules) scheduleQueries.push(options);
    const rows = [...collections.get(collection).entries()]
      .map(([id, value]) => ({ id, ...value, ...(options.includeDocumentId ? { documentId: id } : {}) }))
      .filter((row) => filters.every(({ field, value }) => row[field] === value))
      .filter((row) => !options.startAfterId ||
        Buffer.compare(Buffer.from(row.id), Buffer.from(options.startAfterId)) > 0);
    if (options.orderById) {
      rows.sort((left, right) => Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)));
    }
    return rows.slice(0, options.limit || undefined);
  };
  const updateDocFields = async (collection, id, fields) => {
    collections.get(collection).set(id, {
      ...collections.get(collection).get(id),
      ...fields,
    });
  };
  const operations = createVolunteerOperations({
    COLLECTIONS,
    requireFirestore: () => null,
    getDoc,
    queryDocs,
    updateDocFields,
    nowIso: () => NOW,
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    enqueueSchedule,
    enqueueMember: (_id, task) => task(),
    ...(maxScheduleGroupsPerRequest ? { maxScheduleGroupsPerRequest } : {}),
  });
  const identity = { churchId: "church-a", memberId: "member-a", actorUid: "account-a" };
  collections.get(COLLECTIONS.teamRosterMembers).set(identity.memberId, {
    ...identity,
    userId: identity.actorUid,
    archivedAt: null,
  });
  collections.get(COLLECTIONS.memberships).set("church-a_account-a", {
    churchId: identity.churchId,
    userId: identity.actorUid,
    status: "active",
  });

  const addSchedule = (scheduleId, overrides = {}) => {
    collections.get(COLLECTIONS.teamSchedules).set(scheduleId, {
      churchId: identity.churchId,
      scheduleId,
      published: true,
      updatedAt: "before",
      occurrences: [{ occurrenceId: "future", startsAt: "2026-11-20T15:00:00.000Z" }],
      assignments: { future: { pending: "member-a" } },
      responses: {},
      ...overrides,
    });
  };
  return { COLLECTIONS, collections, identity, operations, addSchedule, scheduleQueries, failingSchedules };
};

test("accept pending processes each published schedule and preserves existing or ineligible responses", async () => {
  const fixture = createMemoryFixture();
  const { COLLECTIONS, collections, identity, operations, addSchedule } = fixture;
  addSchedule("schedule-a", {
    occurrences: [
      { occurrenceId: "future", startsAt: "2026-11-20T15:00:00.000Z" },
      { occurrenceId: "past", startsAt: "2026-10-01T15:00:00.000Z" },
      { occurrenceId: "invalid", startsAt: "invalid" },
    ],
    assignments: {
      future: {
        pending: { primaryMemberId: "member-a", shadows: [] },
        accepted: "member-a",
        declined: { primaryMemberId: "member-a" },
        shadow: { primaryMemberId: "another-member", shadows: ["member-a"] },
      },
      past: { old: { primaryMemberId: "member-a" } },
      invalid: { missing: { primaryMemberId: "member-a" } },
    },
    responses: {
      future: {
        accepted: { memberId: "member-a", response: "accepted", respondedAt: "old-accepted" },
        declined: { memberId: "member-a", response: "declined", respondedAt: "old-declined" },
        unrelated: { memberId: "another-member", response: "accepted", metadata: "keep" },
      },
    },
  });
  addSchedule("schedule-b", {
    published: undefined,
    assignments: { future: { legacyPending: "member-a" } },
  });
  addSchedule("draft", { published: false });
  addSchedule("archived", { archivedAt: "archived" });

  const result = await operations.acceptPendingAssignments(identity);

  assert.equal(result.newlyAccepted, 2);
  assert.equal(result.alreadyAccepted, 1);
  assert.equal(result.alreadyDeclined, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.failedScheduleCount, 0);
  assert.equal(result.schedules.length, 2);
  const scheduleA = collections.get(COLLECTIONS.teamSchedules).get("schedule-a");
  const scheduleB = collections.get(COLLECTIONS.teamSchedules).get("schedule-b");
  assert.equal(scheduleA.responses.future.pending.response, "accepted");
  assert.equal(scheduleA.responses.future.accepted.respondedAt, "old-accepted");
  assert.equal(scheduleA.responses.future.declined.respondedAt, "old-declined");
  assert.deepEqual(scheduleA.responses.future.unrelated, {
    memberId: "another-member",
    response: "accepted",
    metadata: "keep",
  });
  assert.equal(scheduleA.responses.past, undefined);
  assert.equal(scheduleA.responses.invalid, undefined);
  assert.equal(scheduleA.responses.future.shadow, undefined);
  assert.equal(scheduleB.responses.future.legacyPending.response, "accepted");
  assert.equal(collections.get(COLLECTIONS.teamSchedules).get("draft").updatedAt, "before");
  assert.equal(collections.get(COLLECTIONS.teamSchedules).get("archived").updatedAt, "before");
});

test("repeating and simultaneous accept-pending operations never rewrite an existing answer", async () => {
  const { COLLECTIONS, collections, identity, operations, addSchedule } = createMemoryFixture();
  addSchedule("schedule-a");

  const [first, second] = await Promise.all([
    operations.acceptPendingAssignments(identity),
    operations.acceptPendingAssignments(identity),
  ]);

  assert.equal(first.newlyAccepted + second.newlyAccepted, 1);
  assert.equal(
    collections.get(COLLECTIONS.teamSchedules).get("schedule-a").responses.future.pending.response,
    "accepted",
  );
  const beforeRetry = collections.get(COLLECTIONS.teamSchedules).get("schedule-a").updatedAt;
  const retry = await operations.acceptPendingAssignments(identity);
  assert.equal(retry.newlyAccepted, 0);
  assert.equal(retry.schedules.length, 0);
  assert.equal(collections.get(COLLECTIONS.teamSchedules).get("schedule-a").updatedAt, beforeRetry);
});

test("one schedule failure is reported without undoing another schedule's success and retries safely", async () => {
  const { COLLECTIONS, collections, identity, operations, addSchedule, failingSchedules } = createMemoryFixture({
    failScheduleId: "schedule-a",
  });
  addSchedule("schedule-a");
  addSchedule("schedule-b");

  const result = await operations.acceptPendingAssignments(identity);

  assert.equal(result.newlyAccepted, 1);
  assert.equal(result.failedScheduleCount, 1);
  assert.equal(result.schedules.find((row) => row.scheduleId === "schedule-a").status, "failed");
  assert.equal(result.schedules.find((row) => row.scheduleId === "schedule-b").status, "updated");
  assert.equal(collections.get(COLLECTIONS.teamSchedules).get("schedule-a").responses.future, undefined);
  assert.equal(collections.get(COLLECTIONS.teamSchedules).get("schedule-b").responses.future.pending.response, "accepted");

  failingSchedules.delete("schedule-a");
  const retry = await operations.acceptPendingAssignments(identity);
  assert.equal(retry.newlyAccepted, 1);
  assert.equal(retry.failedScheduleCount, 0);
  assert.deepEqual(retry.schedules.map(({ scheduleId }) => scheduleId), ["schedule-a"]);
  assert.equal(collections.get(COLLECTIONS.teamSchedules).get("schedule-a").responses.future.pending.response, "accepted");
});

test("accept-pending schedule pages resume from the last processed group", async () => {
  const { identity, operations, addSchedule } = createMemoryFixture({
    maxScheduleGroupsPerRequest: 1,
  });
  addSchedule("schedule-a");
  addSchedule("schedule-B");

  const firstPage = await operations.acceptPendingAssignments(identity);
  const secondPage = await operations.acceptPendingAssignments({
    ...identity,
    afterScheduleId: firstPage.nextCursor,
  });

  assert.equal(firstPage.schedules[0].scheduleId, "schedule-B");
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextCursor, "schedule-B");
  assert.equal(secondPage.schedules[0].scheduleId, "schedule-a");
  assert.equal(secondPage.hasMore, false);
});

test("schedule discovery is bounded and resumes after a page with no eligible groups", async () => {
  const { COLLECTIONS, collections, identity, operations, addSchedule, scheduleQueries } =
    createMemoryFixture({ maxScheduleGroupsPerRequest: 2 });
  for (let index = 0; index < 105; index += 1) {
    addSchedule(`schedule-${String(index).padStart(3, "0")}`, {
      assignments: index < 100 ? {} : { future: { pending: "member-a" } },
    });
  }

  const firstPage = await operations.acceptPendingAssignments(identity);
  assert.equal(firstPage.newlyAccepted, 0);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextCursor, "schedule-099");
  assert.equal(scheduleQueries[0].limit, 100);
  assert.equal(scheduleQueries[0].orderById, true);

  const secondPage = await operations.acceptPendingAssignments({
    ...identity,
    afterScheduleId: firstPage.nextCursor,
  });
  assert.equal(secondPage.newlyAccepted, 2);
  assert.equal(secondPage.hasMore, true);
  assert.equal(secondPage.nextCursor, "schedule-101");
  assert.equal(collections.get(COLLECTIONS.teamSchedules).get("schedule-100").responses.future.pending.response, "accepted");

  const thirdPage = await operations.acceptPendingAssignments({
    ...identity,
    afterScheduleId: secondPage.nextCursor,
  });
  assert.equal(thirdPage.newlyAccepted, 2);
  assert.equal(thirdPage.hasMore, true);
  assert.equal(thirdPage.nextCursor, "schedule-103");

  const fourthPage = await operations.acceptPendingAssignments({
    ...identity,
    afterScheduleId: thirdPage.nextCursor,
  });
  assert.equal(fourthPage.newlyAccepted, 1);
  assert.equal(fourthPage.hasMore, false);
});
