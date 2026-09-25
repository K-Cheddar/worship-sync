import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TeamsMessagesPage from "./TeamsMessagesPage";
import { useTeamsPage } from "../TeamsPageContext";
import {
  getNotificationIntents,
  previewAvailabilityNotifications,
  sendNotificationIntent,
} from "../../../api/auth";
import type { NotificationIntent } from "../../../api/authTypes";

jest.mock("../TeamsPageContext", () => ({ useTeamsPage: jest.fn() }));
jest.mock("../../../api/auth", () => ({
  getNotificationIntents: jest.fn(),
  previewAvailabilityNotifications: jest.fn(),
  sendNotificationIntent: jest.fn(),
}));

const mockUseTeamsPage = jest.mocked(useTeamsPage);
const mockGetIntents = jest.mocked(getNotificationIntents);
const mockPreview = jest.mocked(previewAvailabilityNotifications);
const mockSend = jest.mocked(sendNotificationIntent);

const previewIntent: NotificationIntent = {
  intentId: "intent_1", churchId: "church_1", intentType: "availability_request",
  sourceType: "team_schedule", sourceId: "schedule_1", sourceVersion: "v1",
  memberId: "member_1", occurrenceId: "occ_1", idempotencyKey: "key_1",
  channel: "sms", message: "Please update your availability.", status: "preview",
  createdAt: "2026-09-25T12:00:00.000Z", updatedAt: "2026-09-25T12:00:00.000Z",
  previewEligible: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseTeamsPage.mockReturnValue({
    churchId: "church_1",
    canEditTeams: true,
    pageData: {
      schedules: [{ scheduleId: "schedule_1", name: "October rota", teamId: "team_1", churchId: "church_1", startDate: "2026-10-01", serviceIds: [] }],
      members: [{ memberId: "member_1", firstName: "Rae", lastName: "Rivera", churchId: "church_1" }],
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  mockGetIntents.mockResolvedValue({ success: true, intents: [] });
  mockPreview.mockResolvedValue({ success: true, intents: [previewIntent] });
  mockSend.mockResolvedValue({ success: true, intent: { ...previewIntent, status: "sent" } });
});

test("availability SMS stays preview-only until the admin approves the bulk send", async () => {
  const user = userEvent.setup();
  mockGetIntents
    .mockResolvedValueOnce({ success: true, intents: [] })
    .mockResolvedValueOnce({ success: true, intents: [previewIntent] })
    .mockResolvedValueOnce({ success: true, intents: [{ ...previewIntent, status: "sent" }] });
  render(<TeamsMessagesPage />);

  await waitFor(() => expect(mockGetIntents).toHaveBeenCalledTimes(1));
  expect(mockSend).not.toHaveBeenCalled();

  await user.click(screen.getByRole("combobox", { name: "Schedule:" }));
  await user.click(screen.getByRole("option", { name: /October rota/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("button", { name: "Prepare preview" }));

  expect(await screen.findByText("Please update your availability.")).toBeInTheDocument();
  const approve = await screen.findByRole("button", { name: "Approve and send 1" });
  expect(mockSend).not.toHaveBeenCalled();
  await user.click(approve);
  await waitFor(() => expect(mockSend).toHaveBeenCalledWith("church_1", "intent_1"));
  expect(await screen.findByRole("status")).toHaveTextContent(/1 sent, 0 need review/);
});
