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
  recipients: [{
    memberId: "member_1", memberName: "Rae Rivera", recipientId: "recipient_1",
    maskedPhoneNumber: "••• ••• 0123", eligibilityStatus: "", eligible: true,
    intentId: "intent_1", status: "preview", segmentCount: 2,
    message: "Church: please respond at https://example.test/a/private-token. Reply STOP to opt out.",
  }],
  summary: {
    requested: 1, eligible: 1, excluded: 0, totalSegments: 2,
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
      members: [{ memberId: "member_1", firstName: "Rae", lastName: "Rivera", churchId: "church_1" }],
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  mockGetIntents.mockResolvedValue({ success: true, intents: [] });
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
  await user.click(screen.getByRole("button", { name: "Prepare selected batch" }));

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
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith("church_1", "batch_1"));
});
