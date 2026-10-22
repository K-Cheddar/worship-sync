import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TeamsMessagesPage from "./TeamsMessagesPage";
import { useTeamsPage } from "../TeamsPageContext";
import { dispatchAvailabilityNotificationBatch, getMessageHistory, prepareCustomMessage } from "../../../api/auth";

jest.mock("../TeamsPageContext", () => ({ useTeamsPage: jest.fn() }));
jest.mock("../../../api/auth", () => ({
  dispatchAvailabilityNotificationBatch: jest.fn(),
  getAvailabilityNotificationBatch: jest.fn(),
  getMessageHistory: jest.fn(),
  prepareCustomMessage: jest.fn(),
}));

const members = [
  { memberId: "m1", churchId: "church", firstName: "Alex", lastName: "Lane", positionIds: ["p1"], phoneNumber: "+15555550101" },
  { memberId: "m2", churchId: "church", firstName: "Blair", lastName: "Rivera", positionIds: ["p1", "p2"], phoneNumber: "+15555550102" },
  { memberId: "m3", churchId: "church", firstName: "Casey", lastName: "Stone", positionIds: ["p2"], phoneNumber: "" },
];
const batch = {
  batchId: "b1", churchId: "church", intentType: "custom_message", status: "prepared",
  selectedMemberIds: ["m1", "m2"], intentIds: ["i1", "i2"], approvalVersion: "review-v1",
  message: "Practice Friday. Reply STOP to opt out.",
  recipients: [
    { memberId: "m1", memberName: "Alex Lane", maskedPhoneNumber: "••• ••• 0101", eligible: true, status: "preview", segmentCount: 1 },
    { memberId: "m2", memberName: "Blair Rivera", maskedPhoneNumber: "••• ••• 0102", eligible: true, status: "preview", segmentCount: 1 },
  ],
  summary: { eligible: 2, excluded: 0, totalSegments: 2 },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useTeamsPage).mockReturnValue({
    churchId: "church", canEditTeams: true, canEditTeam: () => true,
    pageData: { members, positions: [{ positionId: "p1", teamId: "t1" }, { positionId: "p2", teamId: "t2" }],
      teams: [{ teamId: "t1", name: "Praise Team", memberIds: ["m1", "m2"] },
        { teamId: "t2", name: "Tech Team", memberIds: ["m2", "m3"] }],
      smsEligibilityByMemberId: { m1: { eligible: true }, m2: { eligible: true }, m3: { eligible: false } } },
  } as unknown as ReturnType<typeof useTeamsPage>);
  jest.mocked(getMessageHistory).mockResolvedValue({ success: true, entries: [], nextCursor: "" });
  jest.mocked(prepareCustomMessage).mockResolvedValue({ success: true, batch: batch as never, enabled: false });
});

it("opens history first and cancels without sending", async () => {
  const user = userEvent.setup();
  render(<TeamsMessagesPage />);
  expect(await screen.findByText("Message history")).toBeInTheDocument();
  expect(screen.queryByLabelText(/Search volunteers/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  expect(screen.getByLabelText(/Search volunteers/)).toBeInTheDocument();
  expect(screen.getByText("0 selected")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();
});

it("deduplicates team members, keeps hidden selections, and reviews the exact SMS", async () => {
  const user = userEvent.setup();
  render(<TeamsMessagesPage />);
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  await user.click(screen.getByRole("checkbox", { name: "Praise Team" }));
  await user.click(screen.getByRole("checkbox", { name: "Tech Team" }));
  expect(screen.getByText("3 selected")).toBeInTheDocument();
  await user.type(screen.getByLabelText(/Search volunteers/), "Alex");
  expect(screen.getByText("3 selected · 2 hidden by search")).toBeInTheDocument();
  await user.clear(screen.getByLabelText(/Search volunteers/));
  await user.click(within(screen.getByRole("list", { name: "Volunteers" })).getByRole("checkbox", { name: "Casey Stone" }));
  await user.type(screen.getByRole("textbox", { name: "Message" }), "Practice Friday.");
  expect(screen.getByText(/about 1 SMS segment/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review message" }));
  expect(prepareCustomMessage).toHaveBeenCalledWith("church", expect.objectContaining({ memberIds: ["m1", "m2"], message: "Practice Friday." }));
  expect(screen.getByText("Practice Friday. Reply STOP to opt out.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send 2 messages" })).toBeDisabled();
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();
});
