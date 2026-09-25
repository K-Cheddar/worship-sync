import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TeamsMessagesPage from "./TeamsMessagesPage";
import { useTeamsPage } from "../TeamsPageContext";
import {
  dispatchAvailabilityNotificationBatch,
  getAvailabilityNotificationBatch,
  getNotificationIntents,
  prepareAvailabilityNotificationBatch,
} from "../../../api/auth";
import type { NotificationBatch } from "../../../api/authTypes";

jest.mock("../TeamsPageContext", () => ({ useTeamsPage: jest.fn() }));
jest.mock("../../../api/auth", () => ({
  dispatchAvailabilityNotificationBatch: jest.fn(),
  getAvailabilityNotificationBatch: jest.fn(),
  getNotificationIntents: jest.fn(),
  prepareAvailabilityNotificationBatch: jest.fn(),
  sendNotificationIntent: jest.fn(),
}));

const mockUseTeamsPage = jest.mocked(useTeamsPage);
const mockGetBatch = jest.mocked(getAvailabilityNotificationBatch);
const mockGetIntents = jest.mocked(getNotificationIntents);
const mockPrepare = jest.mocked(prepareAvailabilityNotificationBatch);
const mockDispatch = jest.mocked(dispatchAvailabilityNotificationBatch);

const batch: NotificationBatch = {
  batchId: "batch_1",
  churchId: "church_1",
  formId: "form_1",
  intentType: "availability_request",
  reminderRound: 0,
  status: "prepared",
  selectedMemberIds: ["member_1"],
  intentIds: ["intent_1"],
  approvalVersion: "batch-review-v1",
  recipients: [{
    memberId: "member_1", memberName: "Rae Rivera", recipientId: "recipient_1",
    maskedPhoneNumber: "••• ••• 0123", eligibilityStatus: "", eligible: true,
    intentId: "intent_1", status: "preview", segmentCount: 2,
    approvalVersion: "intent-review-v1",
    message: "Church: please respond at https://example.test/a/private-token. Reply STOP to opt out.",
  }],
  summary: {
    requested: 1, selected: 1, eligible: 1, awaitingDispatch: 1, alreadySent: 0, excluded: 0, totalSegments: 2,
    sent: 0, delivered: 0, failed: 0, uncertain: 0, responded: 0,
    waiting: 0, optedOut: 0,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockUseTeamsPage.mockReturnValue({
    churchId: "church_1",
    canEditTeams: true,
    pageData: {
      intakeForms: [{ formId: "form_1", name: "October availability", startDate: "2026-10-01", endDate: "2026-10-31", active: true }],
      schedules: [],
      teams: [], positions: [], intakeRecipients: [],
      smsEligibilityByMemberId: { member_1: { status: "enabled", eligible: true } },
      members: [{ memberId: "member_1", firstName: "Rae", lastName: "Rivera", churchId: "church_1", phoneNumber: "+15555550123", positionIds: [] }],
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  mockGetIntents.mockResolvedValue({ success: true, intents: [], nextCursor: "", limit: 50 });
  mockGetBatch.mockResolvedValue({ success: true, batch });
  mockPrepare.mockResolvedValue({ success: true, batch });
  mockDispatch.mockResolvedValue({ success: true, batch: { ...batch, status: "sent", summary: { ...batch.summary, sent: 1 } } });
});

test("only sends after confirmation and dispatches the explicitly prepared batch", async () => {
  const user = userEvent.setup();
  render(<TeamsMessagesPage />);

  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));

  await waitFor(() => expect(mockPrepare).toHaveBeenCalledWith("church_1", expect.objectContaining({
    intentType: "availability_request", formId: "form_1", memberIds: ["member_1"],
  })));
  expect(await screen.findByText(/secure response/)).toBeInTheDocument();
  expect(await screen.findByText(/Church: please respond at/)).toBeInTheDocument();
  expect(mockDispatch).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Review and send this batch" }));
  expect(await screen.findByRole("dialog", { name: "Confirm this batch" })).toBeInTheDocument();
  expect(screen.getByText(/Send exactly 1 selected messages/)).toBeInTheDocument();
  expect(mockDispatch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm and send selected batch" }));
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith("church_1", "batch_1", "batch-review-v1"));
});

test("team and name filters compose, and selection survives filter changes", async () => {
  const user = userEvent.setup();
  mockUseTeamsPage.mockReturnValue({
    churchId: "church_1", canEditTeams: true,
    pageData: {
      intakeForms: [{ formId: "form_1", name: "October availability", startDate: "2026-10-01", endDate: "2026-10-31", active: true, teamIds: [] }],
      teams: [{ teamId: "worship", churchId: "church_1", name: "Worship", memberIds: ["member_1", "member_2"] }, { teamId: "care", churchId: "church_1", name: "Care", memberIds: ["member_1", "member_3"] }],
      positions: [], schedules: [], intakeRecipients: [],
      smsEligibilityByMemberId: { member_1: { status: "enabled", eligible: true }, member_2: { status: "enabled", eligible: true }, member_3: { status: "no_mobile", eligible: false } },
      members: [
        { memberId: "member_1", firstName: "Rae", lastName: "Rivera", churchId: "church_1", phoneNumber: "+15555550123", positionIds: [] },
        { memberId: "member_2", firstName: "Sam", lastName: "Smith", churchId: "church_1", phoneNumber: "+15555550124", positionIds: [] },
        { memberId: "member_3", firstName: "Terry", lastName: "Taylor", churchId: "church_1", positionIds: [] },
      ],
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  render(<TeamsMessagesPage />);
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("combobox", { name: /Team/ }));
  await user.click(screen.getByRole("option", { name: "Worship" }));
  await user.type(screen.getByRole("textbox", { name: /Search volunteers/ }), "sam");
  expect(screen.getByText("Sam Smith")).toBeInTheDocument();
  expect(screen.queryByText("Rae Rivera")).not.toBeInTheDocument();
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: /Search volunteers/ }));
  await user.click(screen.getByRole("combobox", { name: /Team/ }));
  await user.click(screen.getByRole("option", { name: "All teams" }));
  await user.click(screen.getByRole("checkbox", { name: /Select all 2 eligible shown/ }));
  expect(screen.getByRole("checkbox", { name: /Select all 2 eligible shown/ })).toHaveAttribute("data-state", "checked");
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.getByText("0 selected")).toBeInTheDocument();
  expect(screen.getByText("No mobile number")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Terry Taylor" })).toBeDisabled();
});

test("select all is indeterminate for some visible selections and prepares only eligible selected volunteers", async () => {
  const user = userEvent.setup();
  mockUseTeamsPage.mockReturnValue({
    churchId: "church_1", canEditTeams: true,
    pageData: {
      intakeForms: [{ formId: "form_1", name: "October availability", startDate: "2026-10-01", endDate: "2026-10-31", active: true, teamIds: [] }],
      teams: [{ teamId: "worship", churchId: "church_1", name: "Worship", memberIds: ["member_1", "member_2"] }], positions: [], schedules: [], intakeRecipients: [],
      smsEligibilityByMemberId: { member_1: { status: "enabled", eligible: true }, member_2: { status: "enabled", eligible: true } },
      members: [
        { memberId: "member_1", firstName: "Rae", lastName: "Rivera", churchId: "church_1", phoneNumber: "+15555550123", positionIds: [] },
        { memberId: "member_2", firstName: "Terry", lastName: "Taylor", churchId: "church_1", phoneNumber: "+15555550124", positionIds: [] },
      ],
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  render(<TeamsMessagesPage />);
  expect(screen.getByRole("button", { name: "Review 0 messages" })).toBeDisabled();
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  expect(screen.getByRole("checkbox", { name: /Select all 2 eligible shown/ })).toHaveAttribute("data-state", "indeterminate");
  expect(screen.getByRole("button", { name: "Review 1 message" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  await waitFor(() => expect(mockPrepare).toHaveBeenCalledWith("church_1", expect.objectContaining({ memberIds: ["member_1"] })));
});
