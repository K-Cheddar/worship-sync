import type { TeamIntakeForm, TeamRosterMember } from "../../api/authTypes";
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
    member("no-mobile", { teamMemberships: { worship: { teamId: "worship" } } }),
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
  ["consent_needed", "SMS consent needed"],
  ["opted_out", "SMS opted out"],
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
