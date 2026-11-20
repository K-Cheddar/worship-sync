import test from "node:test";
import assert from "node:assert/strict";
import { createVolunteerMutations } from "./volunteerMutations.js";
import { createVolunteerPortalHandlers, VOLUNTEER_SESSION_COOKIE } from "./volunteerPortalHandlers.js";

const makeError = (status, message) => Object.assign(new Error(message), { status });

const fixture = () => {
  const member = {
    churchId: "church-a",
    memberId: "member-a",
    archivedAt: null,
    updatedAt: "before",
    firstName: "Avery",
    notes: "Keep these notes",
    blockoutDates: [{ startDate: "2026-12-24", endDate: "2026-12-25" }],
    servingFrequency: "as_needed",
    recurringAvailability: { weeksOfMonth: [], includeLastWeekOfMonth: false },
  };
  const session = {
    churchId: member.churchId,
    memberId: member.memberId,
    csrfToken: "session-csrf",
    generation: 1,
    credentialDigest: "session-digest",
    expiresAt: "2027-01-01T00:00:00.000Z",
  };
  const accessStore = {
    async readSession(cookie) {
      return cookie === "session-cookie" ? session : null;
    },
  };
  const mutations = createVolunteerMutations({
    COLLECTIONS: { teamRosterMembers: "members" },
    requireFirestore: () => null,
    getDoc: async (collection, id) => collection === "members" && id === member.memberId ? member : null,
    updateDocFields: async (collection, id, patch) => {
      assert.equal(collection, "members");
      assert.equal(id, member.memberId);
      Object.assign(member, patch);
    },
    nowIso: () => "2026-11-20T12:00:00.000Z",
    httpError: makeError,
    enqueueMember: (_memberId, task) => task(),
  });
  const handlers = createVolunteerPortalHandlers({
    getAccessStore: () => accessStore,
    getRecoveryStore: () => ({}),
    appBaseUrl: "https://worshipsync.test",
    httpError: makeError,
    requireAdminSession: async () => {},
    assertCsrf: async () => {},
    enforceRateLimit: async () => {},
    getClientIp: () => "127.0.0.1",
    addSecurityEvent: async () => {},
    logAuthEvent: () => {},
    getSchedule: async () => ({}),
    respond: async () => ({}),
    acceptUnanswered: async () => ({}),
    saveBlockouts: async () => ({}),
    saveSchedulingPreferences: async (identity, body) => {
      const { member: saved } = await mutations.saveSchedulingPreferences({
        churchId: identity.churchId,
        memberId: identity.memberId,
        actorId: identity.actorId,
        authorize: identity.authorize,
        expectedUpdatedAt: body.expectedUpdatedAt,
        servingFrequency: body.servingFrequency,
        recurringAvailability: body.recurringAvailability,
      });
      return {
        success: true,
        schedulingPreferences: {
          servingFrequency: saved.servingFrequency,
          recurringAvailability: saved.recurringAvailability,
          updatedAt: saved.updatedAt,
        },
      };
    },
    getAvailability: async () => ({}),
    submitAvailability: async () => ({}),
  });
  return { member, handlers };
};

const invoke = async (handler, headers, body) => {
  const response = {
    statusCode: 200,
    payload: null,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({ headers, body }, response);
  return response;
};

const validHeaders = {
  cookie: `${VOLUNTEER_SESSION_COOKIE}=session-cookie`,
  origin: "https://worshipsync.test",
  "x-volunteer-csrf": "session-csrf",
};
const preferenceBody = {
  servingFrequency: "twice_monthly",
  recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: true },
  expectedUpdatedAt: "before",
  memberId: "forged-member",
  firstName: "Forged name",
  notes: "Forged notes",
  blockoutDates: [],
};

test("accountless scheduling preference writes use the session member and reject invalid CSRF, origin, and revisions", async () => {
  const { member, handlers } = fixture();
  const save = handlers.saveVolunteerPersonalSchedulingPreferences;

  const noCsrf = await invoke(save, { ...validHeaders, "x-volunteer-csrf": "" }, preferenceBody);
  assert.equal(noCsrf.statusCode, 403);
  assert.equal(member.servingFrequency, "as_needed");

  const wrongOrigin = await invoke(save, { ...validHeaders, origin: "https://attacker.test" }, preferenceBody);
  assert.equal(wrongOrigin.statusCode, 403);
  assert.equal(member.servingFrequency, "as_needed");

  const saved = await invoke(save, validHeaders, preferenceBody);
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.payload));
  assert.deepEqual(saved.payload.schedulingPreferences, {
    servingFrequency: "twice_monthly",
    recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: true },
    updatedAt: "2026-11-20T12:00:00.000Z",
  });
  assert.equal(member.memberId, "member-a");
  assert.equal(member.firstName, "Avery");
  assert.equal(member.notes, "Keep these notes");
  assert.deepEqual(member.blockoutDates, [{ startDate: "2026-12-24", endDate: "2026-12-25" }]);

  const stale = await invoke(save, validHeaders, { ...preferenceBody, servingFrequency: "monthly" });
  assert.equal(stale.statusCode, 409);
  assert.equal(member.servingFrequency, "twice_monthly");
});
