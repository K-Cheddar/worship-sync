process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";

const {
  authHandlers,
  canSeedHumanBearerAuthForServerTests,
  COLLECTIONS,
  getDoc,
  queryDocs,
  seedActiveHumanBearerForServerTests,
  seedSmsConsentForServerTests,
  setDoc,
} = await import("../authService.js");
import { createFakeSmsProvider, setSmsProviderForServerTests } from "./smsProvider.js";

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

const createHumanContext = async (
  suffix,
  {
    userId = `team_availability_${suffix}`,
    churchId = `team_availability_church_${suffix}`,
    role = "admin",
    appAccess = "full",
    controllerAccess,
    permissions,
  } = {},
) => {
  const session = createSession();
  const seedReq = createReq({ session });
  const seeded = await seedActiveHumanBearerForServerTests({
    req: seedReq,
    userId,
    email: `${suffix}@example.com`,
    churchId,
    role,
    appAccess,
    controllerAccess,
    permissions,
  });
  const meRes = createRes();
  await authHandlers.getAuthMe(createReq({
    session,
    headers: { authorization: `Bearer ${seeded.humanApiToken}` },
  }), meRes);
  return {
    churchId: seeded.churchId,
    userId,
    headers: {
      authorization: `Bearer ${seeded.humanApiToken}`,
      "x-csrf-token": String(meRes.payload?.csrfToken || ""),
    },
    session,
  };
};

const callHandler = async (
  handler,
  { context, params = {}, body = {}, query = {} },
) => {
  const res = createRes();
  await handler(createReq({
    params: { churchId: context.churchId, ...params },
    headers: context.headers,
    session: context.session,
    body,
    query,
  }), res);
  return res;
};

const seedTeam = async (context, { name, members = [] }) => {
  const created = await callHandler(authHandlers.createTeam, {
    context,
    body: { name, memberIds: [] },
  });
  assert.equal(created.statusCode, 200, JSON.stringify(created.payload));
  const teamId = created.payload.team.teamId;
  const memberIds = {};
  for (const member of members) {
    const result = await callHandler(authHandlers.createTeamRosterMember, {
      context,
      body: { firstName: member.firstName, lastName: member.lastName, positionIds: [] },
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
    memberIds[member.firstName] = result.payload.member.memberId;
  }
  if (Object.keys(memberIds).length) {
    const updated = await callHandler(authHandlers.updateTeam, {
      context,
      params: { teamId },
      body: { name, memberIds: Object.values(memberIds) },
    });
    assert.equal(updated.statusCode, 200, JSON.stringify(updated.payload));
  }
  return { teamId, memberIds };
};

const dateFromToday = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const makeAvailabilityForm = (teamIds, name = "Team availability") => {
  const startDate = dateFromToday(0);
  const serviceDate = dateFromToday(14);
  const occurrenceId = `service-sunday@${serviceDate}T10:00:00.000Z`;
  return {
    name,
    startDate,
    endDate: serviceDate,
    responseDeadline: serviceDate,
    availabilityServices: [{ serviceId: "service-sunday", name: "Sunday" }],
    availabilityOccurrences: [{
      occurrenceId,
      serviceId: "service-sunday",
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

test("selected-Team availability creation, read, SMS, and response application stay inside current Team access", async (t) => {
  if (!canSeedHumanBearerAuthForServerTests()) {
    t.skip("Team availability API tests use in-memory human auth only.");
    return;
  }

  const owner = await createHumanContext("phase3a_owner");
  const worship = await seedTeam(owner, {
    name: "Worship",
    members: [{ firstName: "Rae", lastName: "Kim" }],
  });
  const av = await seedTeam(owner, {
    name: "AV",
    members: [{ firstName: "Alex", lastName: "Rivera" }],
  });
  const worshipMemberId = worship.memberIds.Rae;
  const avMemberId = av.memberIds.Alex;
  const phoneNumber = "+19545551236";
  await setDoc(COLLECTIONS.teamRosterMembers, worshipMemberId, {
    email: "private-rae@example.com",
    phoneNumber,
    notes: "private pastoral note",
    birthDate: "1995-04-12",
    recurringAvailability: { weeksOfMonth: [1] },
    blockoutDates: [{ startDate: dateFromToday(20), endDate: dateFromToday(21) }],
    positionIds: [],
    teamMemberships: { [worship.teamId]: { teamId: worship.teamId } },
  }, { merge: true });
  await setDoc(COLLECTIONS.teamRosterMembers, avMemberId, {
    email: "private-alex@example.com",
    phoneNumber: "+19545551237",
    notes: "another Team's note",
  }, { merge: true });
  await seedSmsConsentForServerTests({ churchId: owner.churchId, phoneNumber, status: "opted_in" });
  await setDoc(COLLECTIONS.churchMessagingConfigs, owner.churchId, {
    churchId: owner.churchId,
    provider: "twilio",
    providerAccountId: "AC_test",
    messagingServiceId: "MG_test",
    registrationStatus: "approved",
    enabled: true,
  }, { merge: false });

  const managerUserId = "phase3a_worship_manager";
  const worshipManager = await createHumanContext("phase3a_worship_manager", {
    userId: managerUserId,
    churchId: owner.churchId,
    role: "member",
    permissions: { teams: "none", teamScopes: { [worship.teamId]: "edit" } },
  });
  const bothTeamManager = await createHumanContext("phase3a_both_teams_manager", {
    churchId: owner.churchId,
    role: "member",
    permissions: { teams: "none", teamScopes: { [worship.teamId]: "edit", [av.teamId]: "edit" } },
  });
  const teamReader = await createHumanContext("phase3a_team_reader", {
    churchId: owner.churchId,
    role: "member",
    permissions: { teams: "view", teamScopes: {} },
  });
  const servicesEditor = await createHumanContext("phase3a_services_editor", {
    churchId: owner.churchId,
    role: "member",
    permissions: { teams: "none", services: "edit", teamScopes: {} },
  });
  const controllerOnly = await createHumanContext("phase3a_controller_only", {
    churchId: owner.churchId,
    role: "member",
    controllerAccess: "edit",
    permissions: { teams: "none", services: "none", teamScopes: {} },
  });

  const managedForm = await callHandler(authHandlers.createTeamIntakeForm, {
    context: worshipManager,
    body: makeAvailabilityForm([worship.teamId]),
  });
  assert.equal(managedForm.statusCode, 200, JSON.stringify(managedForm.payload));
  const formId = managedForm.payload.form.formId;
  assert.equal(managedForm.payload.form.purpose, "team_availability");
  assert.equal(managedForm.payload.publicUrl, undefined);
  assert.equal(managedForm.payload.publicToken, undefined);

  const legacyFormId = `${owner.churchId}_legacy_form`;
  const legacyAvailabilityForm = makeAvailabilityForm([worship.teamId]);
  delete legacyAvailabilityForm.purpose;
  await setDoc(COLLECTIONS.teamIntakeForms, legacyFormId, {
    formId: legacyFormId,
    churchId: owner.churchId,
    name: "Legacy intake form",
    ...legacyAvailabilityForm,
    enabledFields: ["firstName", "availability"],
  }, { merge: false });
  const legacyPurposeChange = await callHandler(authHandlers.updateTeamIntakeForm, {
    context: owner,
    params: { formId: legacyFormId },
    body: makeAvailabilityForm([worship.teamId]),
  });
  assert.equal(legacyPurposeChange.statusCode, 400);
  assert.equal((await getDoc(COLLECTIONS.teamIntakeForms, legacyFormId)).purpose, undefined);

  assert.equal((await callHandler(authHandlers.createTeamIntakeForm, {
    context: worshipManager,
    body: makeAvailabilityForm([av.teamId], "Unauthorized AV form"),
  })).statusCode, 403);
  assert.equal((await callHandler(authHandlers.updateTeamIntakeForm, {
    context: worshipManager,
    params: { formId },
    body: makeAvailabilityForm([worship.teamId, av.teamId]),
  })).statusCode, 403);
  assert.deepEqual((await getDoc(COLLECTIONS.teamIntakeForms, formId)).teamIds, [worship.teamId]);
  assert.equal((await callHandler(authHandlers.updateTeamIntakeForm, {
    context: bothTeamManager,
    params: { formId },
    body: makeAvailabilityForm([worship.teamId, av.teamId]),
  })).statusCode, 200);
  assert.equal((await callHandler(authHandlers.updateTeamIntakeForm, {
    context: bothTeamManager,
    params: { formId },
    body: makeAvailabilityForm([worship.teamId]),
  })).statusCode, 200);

  for (const [label, teamIds] of [["empty", []], ["missing", ["missing-team"]]]) {
    const invalid = await callHandler(authHandlers.createTeamIntakeForm, {
      context: worshipManager,
      body: makeAvailabilityForm(teamIds, `Invalid ${label}`),
    });
    assert.ok([400, 403].includes(invalid.statusCode), `${label} Team scope must be denied`);
  }
  const foreignOwner = await createHumanContext("phase3a_foreign_owner");
  const foreignTeam = await seedTeam(foreignOwner, { name: "Foreign" });
  const foreignScope = await callHandler(authHandlers.createTeamIntakeForm, {
    context: worshipManager,
    body: makeAvailabilityForm([foreignTeam.teamId], "Foreign Team form"),
  });
  assert.equal(foreignScope.statusCode, 403);
  const archivedTeam = await seedTeam(owner, { name: "Archived" });
  assert.equal((await callHandler(authHandlers.archiveTeam, {
    context: owner,
    params: { teamId: archivedTeam.teamId },
  })).statusCode, 200);
  const archivedScope = await callHandler(authHandlers.createTeamIntakeForm, {
    context: bothTeamManager,
    body: makeAvailabilityForm([archivedTeam.teamId], "Archived Team form"),
  });
  assert.equal(archivedScope.statusCode, 403);
  const malformedScope = await callHandler(authHandlers.createTeamIntakeForm, {
    context: worshipManager,
    body: makeAvailabilityForm([worship.teamId, ""], "Malformed Team form"),
  });
  assert.equal(malformedScope.statusCode, 400);

  const outsiderId = `${owner.churchId}_outside_worship_roster`;
  await setDoc(COLLECTIONS.teamRosterMembers, outsiderId, {
    memberId: outsiderId,
    churchId: owner.churchId,
    firstName: "Outside",
    lastName: "Member",
    positionIds: [],
    teamMemberships: { [worship.teamId]: { teamId: worship.teamId } },
  }, { merge: false });
  assert.equal((await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: worshipManager,
    params: { formId },
    body: { memberIds: [outsiderId] },
  })).statusCode, 400);
  const createdRecipients = await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: worshipManager,
    params: { formId },
    body: { memberIds: [worshipMemberId] },
  });
  assert.equal(createdRecipients.statusCode, 200, JSON.stringify(createdRecipients.payload));
  const recipientId = createdRecipients.payload.recipients[0].recipientId;
  const link = await callHandler(authHandlers.getTeamIntakeRecipientLink, {
    context: worshipManager,
    params: { recipientId },
  });
  assert.equal(link.statusCode, 200);
  const recipientToken = link.payload.publicUrl.split("/a/")[1];
  assert.ok(recipientToken);

  const avForm = await callHandler(authHandlers.createTeamIntakeForm, {
    context: owner,
    body: makeAvailabilityForm([av.teamId], "AV availability"),
  });
  assert.equal(avForm.statusCode, 200);
  assert.ok(avForm.payload.publicUrl);
  const avFormId = avForm.payload.form.formId;
  assert.equal((await callHandler(authHandlers.createTeamIntakeRecipients, {
    context: worshipManager,
    params: { formId: avFormId },
    body: { memberIds: [avMemberId] },
  })).statusCode, 403);
  assert.equal((await callHandler(authHandlers.listIntents, {
    context: worshipManager,
    query: { formId: avFormId },
  })).statusCode, 403);
  for (const context of [teamReader, servicesEditor, controllerOnly]) {
    assert.equal((await callHandler(authHandlers.getTeamAvailabilityManagementData, { context })).statusCode, 403);
    assert.equal((await callHandler(authHandlers.createTeamIntakeForm, {
      context,
      body: makeAvailabilityForm([worship.teamId]),
    })).statusCode, 403);
  }
  assert.equal((await callHandler(authHandlers.updateTeamIntakeForm, {
    context: teamReader,
    params: { formId },
    body: makeAvailabilityForm([worship.teamId]),
  })).statusCode, 403);

  const bootstrap = await callHandler(authHandlers.getTeamsBootstrap, { context: worshipManager });
  assert.equal(bootstrap.payload.intakeForms?.some((form) => form.formId === formId) ?? false, false);
  const scopedRead = await callHandler(authHandlers.getTeamAvailabilityManagementData, { context: worshipManager });
  assert.equal(scopedRead.statusCode, 200, JSON.stringify(scopedRead.payload));
  assert.deepEqual(scopedRead.payload.forms.map((form) => form.formId), [formId]);
  assert.deepEqual(scopedRead.payload.teams.map((team) => team.teamId), [worship.teamId]);
  assert.deepEqual(scopedRead.payload.members.map((member) => member.memberId), [worshipMemberId]);
  assert.equal(scopedRead.payload.members[0].email, undefined);
  assert.equal(scopedRead.payload.members[0].phoneNumber, undefined);
  assert.equal(scopedRead.payload.members[0].notes, undefined);
  assert.equal(scopedRead.payload.members[0].birthDate, undefined);
  assert.equal(scopedRead.payload.members[0].recurringAvailability, undefined);
  assert.equal(scopedRead.payload.smsEligibilityByMemberId[worshipMemberId].eligible, true);
  assert.equal(JSON.stringify(scopedRead.payload).includes(phoneNumber), false);
  assert.equal(JSON.stringify(scopedRead.payload).includes("private-rae@example.com"), false);
  assert.equal(JSON.stringify(scopedRead.payload).includes("another Team's note"), false);
  assert.equal(JSON.stringify(scopedRead.payload).includes(recipientToken), false);

  const provider = createFakeSmsProvider();
  setSmsProviderForServerTests(provider);
  try {
    const prepared = await callHandler(authHandlers.prepareAvailabilityBatch, {
      context: worshipManager,
      body: { formId, intentType: "availability_request", memberIds: [worshipMemberId], requestKey: "phase3a-initial-request" },
    });
    assert.equal(prepared.statusCode, 200, JSON.stringify(prepared.payload));
    assert.equal(prepared.payload.batch.summary.eligible, 1);
    assert.equal(prepared.payload.batch.recipients[0].phoneNumberSnapshot, undefined);
    assert.equal(prepared.payload.batch.recipients[0].eligibilityStatus, undefined);
    assert.equal(prepared.payload.batch.recipients[0].message.includes(recipientToken), false);
    assert.equal(JSON.stringify(prepared.payload).includes(phoneNumber), false);

    const history = await callHandler(authHandlers.listIntents, {
      context: worshipManager,
      query: { formId },
    });
    assert.equal(history.statusCode, 200);
    assert.equal(JSON.stringify(history.payload).includes(recipientToken), false);
    assert.equal(JSON.stringify(history.payload).includes(phoneNumber), false);
    const preview = await callHandler(authHandlers.getIntentPreview, {
      context: worshipManager,
      params: { intentId: prepared.payload.batch.recipients[0].intentId },
    });
    assert.equal(preview.statusCode, 200, JSON.stringify(preview.payload));
    assert.equal(preview.payload.preview.eligibilityStatus, undefined);
    assert.equal(preview.payload.preview.phoneNumberSnapshot.includes(phoneNumber), false);
    assert.equal(preview.payload.preview.message.includes(recipientToken), false);

    const dispatch = (batch) => callHandler(authHandlers.dispatchAvailabilityBatch, {
      context: worshipManager,
      params: { batchId: batch.batchId },
      body: { confirmed: true, approvalVersion: batch.approvalVersion },
    });
    const sent = await dispatch(prepared.payload.batch);
    assert.equal(sent.statusCode, 200, JSON.stringify(sent.payload));
    assert.equal(provider.calls.length, 1);
    assert.equal(sent.payload.batch.recipients[0].status, "sent");
    const duplicate = await dispatch(prepared.payload.batch);
    assert.equal(duplicate.statusCode, 409);
    assert.equal(provider.calls.length, 1);

    const scopeForm = await callHandler(authHandlers.createTeamIntakeForm, {
      context: worshipManager,
      body: makeAvailabilityForm([worship.teamId], "Scope change check"),
    });
    const staleScopeBatch = await callHandler(authHandlers.prepareAvailabilityBatch, {
      context: worshipManager,
      body: { formId: scopeForm.payload.form.formId, intentType: "availability_request", memberIds: [worshipMemberId], requestKey: "phase3a-stale-scope" },
    });
    assert.equal(staleScopeBatch.statusCode, 200);
    assert.equal((await callHandler(authHandlers.updateTeamIntakeForm, {
      context: bothTeamManager,
      params: { formId: scopeForm.payload.form.formId },
      body: makeAvailabilityForm([worship.teamId, av.teamId], "Scope change check"),
    })).statusCode, 200);
    assert.equal((await dispatch(staleScopeBatch.payload.batch)).statusCode, 403);
    assert.equal(provider.calls.length, 1);

    const permissionForm = await callHandler(authHandlers.createTeamIntakeForm, {
      context: worshipManager,
      body: makeAvailabilityForm([worship.teamId], "Permission change check"),
    });
    const stalePermissionBatch = await callHandler(authHandlers.prepareAvailabilityBatch, {
      context: worshipManager,
      body: { formId: permissionForm.payload.form.formId, intentType: "availability_request", memberIds: [worshipMemberId], requestKey: "phase3a-stale-permission" },
    });
    assert.equal(stalePermissionBatch.statusCode, 200);
    const managerMembership = (await queryDocs(COLLECTIONS.memberships, [
      { field: "churchId", value: owner.churchId },
      { field: "userId", value: managerUserId },
    ]))[0];
    await setDoc(COLLECTIONS.memberships, managerMembership.membershipId, {
      permissions: { teams: "none", teamScopes: {} },
    }, { merge: true });
    assert.equal((await dispatch(stalePermissionBatch.payload.batch)).statusCode, 403);
    assert.equal(provider.calls.length, 1);
  } finally {
    setSmsProviderForServerTests(null);
  }

  const publicPreview = createRes();
  await authHandlers.getTeamIntakePreview(createReq({
    query: { token: recipientToken, recipientOnly: "true" },
  }), publicPreview);
  assert.equal(publicPreview.statusCode, 200);
  const submitted = createRes();
  await authHandlers.submitTeamIntake(createReq({
    query: { token: recipientToken, recipientOnly: "true" },
    body: {
      firstName: "Changed",
      lastName: "Name",
      email: "attacker@example.com",
      positionIds: [],
      occurrenceAvailability: { [scopedRead.payload.forms[0].availabilityOccurrences[0].occurrenceId]: "available" },
      blockoutRanges: [{ startDate: dateFromToday(20), endDate: dateFromToday(20) }],
      notes: "attempted private note",
    },
  }), submitted);
  assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.payload));
  const savedMember = await getDoc(COLLECTIONS.teamRosterMembers, worshipMemberId);
  const occurrenceId = scopedRead.payload.forms[0].availabilityOccurrences[0].occurrenceId;
  assert.equal(savedMember.serviceAvailability[occurrenceId], "available");
  assert.equal(savedMember.firstName, "Rae");
  assert.equal(savedMember.email, "private-rae@example.com");
  assert.equal(savedMember.notes, "private pastoral note");
  assert.equal(savedMember.birthDate, "1995-04-12");
  assert.deepEqual((await getDoc(COLLECTIONS.teams, worship.teamId)).memberIds, [worshipMemberId]);

  const afterResponse = await callHandler(authHandlers.getTeamAvailabilityManagementData, { context: bothTeamManager });
  assert.equal(afterResponse.statusCode, 200);
  const response = afterResponse.payload.availabilityResponses.find((row) => row.formId === formId);
  assert.equal(response.occurrenceAvailability[occurrenceId], "available");
});
