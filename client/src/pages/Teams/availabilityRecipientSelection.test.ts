import type { NotificationIntent, TeamIntakeForm, TeamRosterMember } from "../../api/authTypes";
import { getAvailabilityRecipientRows } from "./availabilityRecipientSelection";

const member = (memberId: string, overrides: Partial<TeamRosterMember> = {}): TeamRosterMember => ({
  memberId,
  churchId: "church-1",
  firstName: memberId,
  lastName: "Member",
  positionIds: [],
  blockoutDates: [],
  teamMemberships: {},
  ...overrides,
});

const form: TeamIntakeForm = {
  formId: "form-1",
  churchId: "church-1",
  name: "October availability",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  availabilityServices: [],
  availabilityOccurrences: [],
  teamIds: ["worship"],
  active: true,
};

it("reports SMS, scope, revoked, and responded exclusions without making them selectable", () => {
  const members = [
    member("eligible", { teamMemberships: { worship: { teamId: "worship" } } }),
    member("no-mobile", { phoneNumber: "not a phone", teamMemberships: { worship: { teamId: "worship" } } }),
    member("outside", { teamMemberships: { kids: { teamId: "kids" } } }),
    member("responded", { teamMemberships: { worship: { teamId: "worship" } } }),
    member("revoked", { teamMemberships: { worship: { teamId: "worship" } } }),
  ];
  const eligibilityByMemberId = {
    eligible: { status: "enabled" as const, eligible: true },
    "no-mobile": { status: "no_mobile" as const, eligible: false },
    outside: { status: "enabled" as const, eligible: true },
    responded: { status: "enabled" as const, eligible: true },
    revoked: { status: "enabled" as const, eligible: true },
  };
  const recipients = [
    { recipientId: "r1", churchId: "church-1", formId: form.formId, memberId: "responded", createdAt: "2026-09-01", respondedAt: "2026-09-20" },
    { recipientId: "r2", churchId: "church-1", formId: form.formId, memberId: "revoked", createdAt: "2026-09-01", revokedAt: "2026-09-20" },
  ];
  const rows = getAvailabilityRecipientRows({ members, positions: [], teams: [], recipients, eligibilityByMemberId, form, intentType: "availability_request", audienceType: "not_contacted" });

  expect(rows.map(({ member: item, eligible, reason }) => [item.memberId, eligible, reason])).toEqual([
    ["eligible", true, ""],
    ["no-mobile", false, "No mobile number"],
    ["outside", false, "Outside this form’s team scope"],
    ["responded", false, "Already responded"],
    ["revoked", false, "Response link revoked"],
  ]);
});

it.each([
  ["consent_needed", "Text message consent needed"],
  ["opted_out", "This phone number opted out"],
] as const)("excludes members with %s consent state", (status, reason) => {
  const rows = getAvailabilityRecipientRows({
    members: [member("one")],
    positions: [],
    teams: [],
    recipients: [],
    eligibilityByMemberId: { one: { status, eligible: false } },
    form: { ...form, teamIds: [] },
    intentType: "availability_request",
  });
  expect(rows[0]).toMatchObject({ eligible: false, reason });
});

it("keeps prior messages available for deliberate selection and exposes their history", () => {
  const members = [
    member("ready", { teamMemberships: { worship: { teamId: "worship" } } }),
    member("sent", { teamMemberships: { worship: { teamId: "worship" } } }),
    member("failed", { teamMemberships: { worship: { teamId: "worship" } } }),
    member("uncertain", { teamMemberships: { worship: { teamId: "worship" } } }),
    member("responded", { teamMemberships: { worship: { teamId: "worship" } } }),
    member("outside", { teamMemberships: { kids: { teamId: "kids" } } }),
  ];
  const recipients = ["ready", "sent", "failed", "uncertain", "responded", "outside"].map((memberId) => ({
    recipientId: `recipient-${memberId}`,
    churchId: form.churchId,
    formId: form.formId,
    memberId,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...(memberId === "responded" ? { respondedAt: "2026-09-20T00:00:00.000Z" } : {}),
  }));
  const notificationIntents = [
    { intentId: "sent-intent", churchId: form.churchId, formId: form.formId, recipientId: "recipient-sent", memberId: "sent", intentType: "availability_request" as const, sourceType: "team_intake_recipient" as const, sourceId: "recipient-sent", sourceVersion: "", occurrenceId: "", channel: "sms" as const, message: "", status: "sent" as const, createdAt: "2026-09-01", updatedAt: "2026-09-01" },
    { intentId: "failed-intent", churchId: form.churchId, formId: form.formId, recipientId: "recipient-failed", memberId: "failed", intentType: "availability_request" as const, sourceType: "team_intake_recipient" as const, sourceId: "recipient-failed", sourceVersion: "", occurrenceId: "", channel: "sms" as const, message: "", status: "failed" as const, createdAt: "2026-09-01", updatedAt: "2026-09-01" },
    { intentId: "unknown-intent", churchId: form.churchId, formId: form.formId, recipientId: "recipient-uncertain", memberId: "uncertain", intentType: "availability_request" as const, sourceType: "team_intake_recipient" as const, sourceId: "recipient-uncertain", sourceVersion: "", occurrenceId: "", channel: "sms" as const, message: "", status: "unknown" as const, createdAt: "2026-09-01", updatedAt: "2026-09-01" },
  ];
  const rows = getAvailabilityRecipientRows({
    members,
    positions: [],
    teams: [],
    recipients,
    eligibilityByMemberId: Object.fromEntries(members.map(({ memberId }) => [memberId, { status: "enabled" as const, eligible: true }])),
    notificationIntents,
    smsDeliveryAttempts: [{
      attemptId: "failed-attempt", churchId: form.churchId, recipientType: "notification_intent" as const,
      recipientId: "recipient-failed", memberId: "failed", formId: form.formId, provider: "twilio",
      purpose: "availability_request" as const, status: "failed" as const, outcome: "failed" as const,
      createdAt: "2026-09-01", updatedAt: "2026-09-01",
    }],
    form,
    intentType: "availability_request",
    audienceType: "specific",
  });

  expect(rows.map(({ member: item, eligible, reason, previousDeliveryStatus }) => [item.memberId, eligible, reason, previousDeliveryStatus])).toEqual([
    ["ready", true, "", ""],
    ["sent", true, "", "sent"],
    ["failed", true, "", "failed"],
    ["uncertain", true, "", "uncertain"],
    ["responded", true, "", ""],
    ["outside", false, "Outside this form’s team scope", ""],
  ]);
});

it("recognizes a completed legacy delivery so it is excluded from the default audience", () => {
  const row = getAvailabilityRecipientRows({
    members: [member("one", { teamMemberships: { worship: { teamId: "worship" } } })],
    positions: [],
    teams: [],
    recipients: [{ recipientId: "recipient-one", churchId: form.churchId, formId: form.formId, memberId: "one", createdAt: "2026-09-01" }],
    eligibilityByMemberId: { one: { status: "enabled", eligible: true } },
    smsDeliveryAttempts: [{ attemptId: "attempt-one", churchId: form.churchId, recipientType: "team_intake", recipientId: "recipient-one", memberId: "one", provider: "twilio", purpose: "initial", status: "delivered", outcome: "confirmed", createdAt: "2026-09-01", updatedAt: "2026-09-01" }],
    form,
    intentType: "availability_request",
    audienceType: "not_contacted",
  });

  expect(row[0]).toMatchObject({ eligible: true, hasPreviousRequest: true, hasAcceptedRequest: true, previousDeliveryStatus: "sent" });
});

it("keeps definitively failed sends in the default not-yet-contacted audience", () => {
  const rows = getAvailabilityRecipientRows({
    members: [member("one", { teamMemberships: { worship: { teamId: "worship" } } })],
    positions: [],
    teams: [],
    recipients: [{ recipientId: "recipient-one", churchId: form.churchId, formId: form.formId, memberId: "one", createdAt: "2026-09-01" }],
    eligibilityByMemberId: { one: { status: "enabled", eligible: true } },
    notificationIntents: [{
      intentId: "failed-intent", churchId: form.churchId, formId: form.formId, recipientId: "recipient-one", memberId: "one",
      intentType: "availability_request", sourceType: "team_intake_recipient", sourceId: "recipient-one", sourceVersion: "",
      occurrenceId: "", channel: "sms", message: "", status: "failed", attemptOutcome: "failed", createdAt: "2026-09-01", updatedAt: "2026-09-01",
    }],
    smsDeliveryAttempts: [{
      attemptId: "failed-attempt", churchId: form.churchId, recipientType: "notification_intent", recipientId: "recipient-one",
      memberId: "one", formId: form.formId, provider: "twilio", purpose: "availability_request", status: "failed",
      outcome: "failed", createdAt: "2026-09-01", updatedAt: "2026-09-01",
    }],
    form,
    intentType: "availability_request",
    audienceType: "not_contacted",
  });
  expect(rows[0]).toMatchObject({ eligible: true, hasAcceptedRequest: false, hasUncertainRequest: false, previousDeliveryStatus: "failed" });
});

it("makes an accepted but undelivered provider attempt available for an explicit resend", () => {
  const memberId = "one";
  const recipientId = "recipient-one";
  const intent: NotificationIntent = {
    intentId: "intent-one", churchId: form.churchId, formId: form.formId, recipientId, memberId,
    intentType: "availability_request", sourceType: "team_intake_recipient", sourceId: recipientId,
    sourceVersion: "", occurrenceId: "", channel: "sms", message: "", status: "failed", createdAt: "2026-09-01", updatedAt: "2026-09-02",
  };
  const rows = getAvailabilityRecipientRows({
    members: [member(memberId, { teamMemberships: { worship: { teamId: "worship" } } })],
    positions: [],
    teams: [],
    recipients: [{ recipientId, churchId: form.churchId, formId: form.formId, memberId, createdAt: "2026-09-01" }],
    eligibilityByMemberId: { [memberId]: { status: "enabled", eligible: true } },
    notificationIntents: [intent],
    smsDeliveryAttempts: [{
      attemptId: "attempt-one", churchId: form.churchId, recipientType: "notification_intent", recipientId, memberId,
      formId: form.formId, provider: "twilio", purpose: "availability_request",
      status: "undelivered", outcome: "confirmed", createdAt: "2026-09-01", updatedAt: "2026-09-02",
    }],
    form,
    intentType: "availability_request",
    audienceType: "specific",
  });

  expect(rows[0]).toMatchObject({ eligible: true, previousDeliveryStatus: "sent", hasPreviousRequest: true });
});

it("treats a failed attempt with no outcome as uncertain even when its intent is failed", () => {
  const memberId = "one";
  const recipientId = "recipient-one";
  const rows = getAvailabilityRecipientRows({
    members: [member(memberId, { teamMemberships: { worship: { teamId: "worship" } } })],
    positions: [],
    teams: [],
    recipients: [{ recipientId, churchId: form.churchId, formId: form.formId, memberId, createdAt: "2026-09-01" }],
    eligibilityByMemberId: { [memberId]: { status: "enabled", eligible: true } },
    notificationIntents: [{
      intentId: "intent-one", churchId: form.churchId, formId: form.formId, recipientId, memberId,
      intentType: "availability_request", sourceType: "team_intake_recipient", sourceId: recipientId,
      sourceVersion: "", occurrenceId: "", channel: "sms", message: "", status: "failed",
      createdAt: "2026-09-01", updatedAt: "2026-09-02",
    }],
    smsDeliveryAttempts: [{
      attemptId: "attempt-one", churchId: form.churchId, recipientType: "notification_intent", recipientId, memberId,
      formId: form.formId, provider: "twilio", purpose: "availability_request", status: "failed",
      createdAt: "2026-09-01", updatedAt: "2026-09-02",
    }],
    form,
    intentType: "availability_request",
    audienceType: "specific",
  });

  expect(rows[0]).toMatchObject({
    eligible: true,
    reason: "",
    previousDeliveryStatus: "uncertain",
  });
});

it("allows reminders only for previously sent nonresponders", () => {
  const memberId = "one";
  const recipientId = "recipient-one";
  const base = {
    members: [member(memberId, { teamMemberships: { worship: { teamId: "worship" } } })],
    positions: [],
    teams: [],
    recipients: [{ recipientId, churchId: form.churchId, formId: form.formId, memberId, createdAt: "2026-09-01" }],
    eligibilityByMemberId: { [memberId]: { status: "enabled" as const, eligible: true } },
    notificationIntents: [{
      intentId: "intent-one", churchId: form.churchId, formId: form.formId, recipientId, memberId,
      intentType: "availability_request" as const, sourceType: "team_intake_recipient" as const, sourceId: recipientId,
      sourceVersion: "", occurrenceId: "", channel: "sms" as const, message: "", status: "sent" as const,
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", sentAt: "2026-09-02T00:00:00.000Z",
    }],
    form,
    intentType: "availability_reminder" as const,
  };
  const waiting = getAvailabilityRecipientRows(base)[0];
  const responded = getAvailabilityRecipientRows({
    ...base,
    recipients: [{ ...base.recipients[0], respondedAt: "2026-09-03T00:00:00.000Z" }],
  })[0];
  expect(waiting).toMatchObject({ eligible: true, hasAcceptedRequest: true, previousSentAt: "2026-09-02T00:00:00.000Z" });
  expect(responded).toMatchObject({ eligible: false, reason: "Already responded" });
});

it("blocks a reminder when a newer resend is uncertain, even if an older request was accepted", () => {
  const memberId = "one";
  const recipientId = "recipient-one";
  const row = getAvailabilityRecipientRows({
    members: [member(memberId)],
    positions: [],
    teams: [],
    recipients: [{ recipientId, churchId: form.churchId, formId: form.formId, memberId, createdAt: "2026-09-01" }],
    eligibilityByMemberId: { [memberId]: { status: "enabled", eligible: true } },
    notificationIntents: [
      {
        intentId: "accepted-request", churchId: form.churchId, formId: form.formId, recipientId, memberId,
        intentType: "availability_request", sourceType: "team_intake_recipient", sourceId: recipientId,
        sourceVersion: "", occurrenceId: "", channel: "sms", message: "", status: "sent",
        createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        intentId: "uncertain-resend", churchId: form.churchId, formId: form.formId, recipientId, memberId,
        intentType: "availability_request", sourceType: "team_intake_recipient", sourceId: recipientId,
        sourceVersion: "", occurrenceId: "", channel: "sms", message: "", status: "unknown",
        createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ],
    form,
    intentType: "availability_reminder",
    audienceType: "nonresponders",
  })[0];

  expect(row).toMatchObject({
    eligible: false,
    hasAcceptedRequest: true,
    hasUncertainRequest: true,
    previousDeliveryStatus: "uncertain",
    reason: "We couldn't confirm whether a previous message was sent. Check message history before sending a reminder.",
  });
});
