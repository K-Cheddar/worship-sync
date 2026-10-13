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
  const rows = getAvailabilityRecipientRows({ members, positions: [], teams: [], recipients, eligibilityByMemberId, form, intentType: "availability_request" });

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

it("keeps only unsent eligible members selectable and exposes retryable and uncertain history", () => {
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
  });

  expect(rows.map(({ member: item, eligible, reason, previousDeliveryStatus }) => [item.memberId, eligible, reason, previousDeliveryStatus])).toEqual([
    ["ready", true, "", ""],
    ["sent", false, "Already sent", "sent"],
    ["failed", true, "", "failed"],
    ["uncertain", false, "We couldn't confirm whether this text was sent. Check message history before trying again.", "uncertain"],
    ["responded", false, "Already responded", ""],
    ["outside", false, "Outside this form’s team scope", ""],
  ]);
});

it("uses a completed delivery attempt to keep a legacy sent request out of the picker", () => {
  const row = getAvailabilityRecipientRows({
    members: [member("one", { teamMemberships: { worship: { teamId: "worship" } } })],
    positions: [],
    teams: [],
    recipients: [{ recipientId: "recipient-one", churchId: form.churchId, formId: form.formId, memberId: "one", createdAt: "2026-09-01" }],
    eligibilityByMemberId: { one: { status: "enabled", eligible: true } },
    smsDeliveryAttempts: [{ attemptId: "attempt-one", churchId: form.churchId, recipientType: "team_intake", recipientId: "recipient-one", memberId: "one", provider: "twilio", purpose: "initial", status: "delivered", outcome: "confirmed", createdAt: "2026-09-01", updatedAt: "2026-09-01" }],
    form,
    intentType: "availability_request",
  });

  expect(row[0]).toMatchObject({ eligible: false, reason: "Already sent", previousDeliveryStatus: "sent" });
});

it("keeps an accepted but undelivered provider attempt blocked from duplicate sends", () => {
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
  });

  expect(rows[0]).toMatchObject({ eligible: false, reason: "Already sent", previousDeliveryStatus: "sent" });
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
  });

  expect(rows[0]).toMatchObject({
    eligible: false,
    reason: "We couldn't confirm whether this text was sent. Check message history before trying again.",
    previousDeliveryStatus: "uncertain",
  });
});
