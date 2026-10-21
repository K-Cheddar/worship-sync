import type {
  NotificationIntent,
  SmsDeliveryAttempt,
  TeamIntakeForm,
  TeamIntakeRecipient,
  TeamIntakeSubmission,
  TeamRosterMember,
} from "../../api/authTypes";
import { getAvailabilityFormProgress } from "./availabilityFormProgress";

const form: TeamIntakeForm = {
  formId: "form",
  churchId: "church",
  name: "Availability",
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  active: true,
  teamIds: ["team"],
  availabilityServices: [],
  availabilityOccurrences: [],
};
const member: TeamRosterMember = {
  memberId: "member",
  churchId: "church",
  firstName: "Jane",
  lastName: "Smith",
  teamMemberships: { team: { teamId: "team" } },
  positionIds: [],
  blockoutDates: [],
};
const recipient: TeamIntakeRecipient = {
  recipientId: "recipient",
  formId: "form",
  churchId: "church",
  memberId: "member",
  createdAt: "2026-10-01T00:00:00Z",
};
const intent: NotificationIntent = {
  intentId: "intent",
  churchId: "church",
  formId: "form",
  memberId: "member",
  recipientId: "recipient",
  sourceId: "recipient",
  sourceType: "team_intake_recipient",
  sourceVersion: "1",
  occurrenceId: "",
  channel: "sms",
  intentType: "availability_request",
  status: "ready",
  createdAt: recipient.createdAt,
  updatedAt: recipient.createdAt,
};
const attempt: SmsDeliveryAttempt = {
  attemptId: "attempt",
  churchId: "church",
  formId: "form",
  memberId: "member",
  recipientId: "recipient",
  recipientType: "notification_intent",
  purpose: "availability_request",
  provider: "twilio",
  status: "delivered",
  createdAt: recipient.createdAt,
  updatedAt: recipient.createdAt,
};
const input = {
  members: [member],
  positions: [],
  teams: [],
  recipients: [recipient],
  form,
  intentType: "availability_request" as const,
  notificationIntents: [intent],
  eligibilityByMemberId: {
    member: { eligible: true, status: "enabled" as const },
  },
};

test("preparation and personal link creation do not count as an invitation or delivery", () => {
  const [row] = getAvailabilityFormProgress(input, [], []);
  expect(row.status).toBe("Not requested");
  expect(row.delivery).toBe("Prepared · not sent");
  const [shared] = getAvailabilityFormProgress(
    {
      ...input,
      recipients: [{ ...recipient, linkCopiedAt: recipient.createdAt }],
    },
    [],
    [],
  );
  expect(shared.status).toBe("Awaiting response");
  expect(shared.delivery).toBe("Prepared · not sent");
});

test.each([
  ["delivered", undefined, "Delivered"],
  ["undelivered", "confirmed", "Undelivered · resend blocked"],
  ["failed", "unknown", "Unconfirmed · check history"],
  ["failed", "not_sent", "Failed · retry available"],
] as const)(
  "represents persisted %s / %s evidence without permitting resend",
  (status, outcome, delivery) => {
    const [row] = getAvailabilityFormProgress(
      {
        ...input,
        smsDeliveryAttempts: [
          { ...attempt, status, ...(outcome ? { outcome } : {}) },
        ],
      },
      [],
      [],
    );
    expect(row.delivery).toBe(delivery);
    expect(row.eligible).toBe(delivery === "Failed · retry available");
  },
);

test("binds administrator answers to the recipient submission ID, never a matching name", () => {
  const submission: TeamIntakeSubmission = {
    submissionId: "submission",
    churchId: "church",
    formId: "form",
    firstName: "Jane",
    lastName: "Smith",
    normalizedName: "jane smith",
    positionIds: [],
    occurrenceAvailability: { sunday: "available" },
    blockoutRanges: [],
    status: "applied",
    submittedAt: recipient.createdAt,
  };
  expect(
    getAvailabilityFormProgress(input, [], [submission])[0].responded,
  ).toBe(false);
  const [row] = getAvailabilityFormProgress(
    {
      ...input,
      recipients: [{ ...recipient, submissionId: submission.submissionId }],
    },
    [],
    [submission],
  );
  expect(row.status).toBe("Responded");
  expect(row.occurrenceAvailability).toEqual({ sunday: "available" });
});

test("revocation stays visible and unrelated form submissions cannot become answers", () => {
  const [row] = getAvailabilityFormProgress(
    {
      ...input,
      recipients: [
        {
          ...recipient,
          revokedAt: recipient.createdAt,
          respondedAt: recipient.createdAt,
        },
      ],
    },
    [],
    [],
  );
  expect(row.status).toBe("Revoked");
});

test("recreating a revoked link cannot reuse a stale response projection", () => {
  const [row] = getAvailabilityFormProgress(input, [{
    formId: form.formId, memberId: member.memberId, recipientId: recipient.recipientId,
    submittedAt: recipient.createdAt, respondedAt: recipient.createdAt,
    occurrenceAvailability: { sunday: "available" },
  }], []);
  expect(row.responded).toBe(false);
  expect(row.occurrenceAvailability).toEqual({});
});
