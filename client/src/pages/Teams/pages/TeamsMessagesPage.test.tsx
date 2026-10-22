import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TeamsMessagesPage from "./TeamsMessagesPage";
import { useTeamsPage } from "../TeamsPageContext";
import { dispatchAvailabilityNotificationBatch, getAvailabilityNotificationBatch, getMessageHistory, prepareCustomMessage } from "../../../api/auth";
import { GlobalInfoContext } from "../../../context/globalInfo";

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
  window.localStorage.clear();
  jest.mocked(useTeamsPage).mockReturnValue({
    churchId: "church", canEditTeams: true, canEditTeam: () => true,
    pageData: { members, positions: [{ positionId: "p1", teamId: "t1" }, { positionId: "p2", teamId: "t2" }],
      teams: [{ teamId: "t1", name: "Praise Team", memberIds: ["m1", "m2"] },
        { teamId: "t2", name: "Tech Team", memberIds: ["m2", "m3"] }],
      smsEligibilityByMemberId: { m1: { eligible: true }, m2: { eligible: true }, m3: { eligible: false } } },
  } as unknown as ReturnType<typeof useTeamsPage>);
  jest.mocked(getMessageHistory).mockResolvedValue({ success: true, entries: [], nextCursor: "" });
  jest.mocked(getAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch: batch as never });
  jest.mocked(prepareCustomMessage).mockResolvedValue({ success: true, batch: batch as never });
  jest.mocked(dispatchAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch: batch as never });
});

const renderForAdmin = (administratorId = "admin-1") => render(
  <GlobalInfoContext.Provider value={{ sessionKind: "human", userId: administratorId } as never}>
    <TeamsMessagesPage />
  </GlobalInfoContext.Provider>,
);

it("opens history first and cancels without sending", async () => {
  const user = userEvent.setup();
  renderForAdmin();
  expect(await screen.findByText("Message history")).toBeInTheDocument();
  expect(screen.queryByLabelText(/Search volunteers/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  expect(screen.getByLabelText(/Search volunteers/)).toBeInTheDocument();
  expect(screen.getByText("0 selected · 0 eligible · 0 excluded")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();
});

it("shows the shared table loading state while history is pending", () => {
  jest.mocked(getMessageHistory).mockImplementationOnce(() => new Promise(() => {}));
  renderForAdmin();
  const loading = screen.getByRole("region", { name: "Loading messages" });
  expect(within(loading).getByRole("table", { name: "Message history table" })).toBeInTheDocument();
  expect(screen.queryByText("Loading message history…")).not.toBeInTheDocument();
});

it("shows message history in a filterable table", async () => {
  jest.mocked(getMessageHistory).mockResolvedValue({ success: true, nextCursor: "", entries: [{
    historyId: "h1", messageType: "custom_message", summary: "Practice Friday", createdAt: "2026-10-22T12:00:00.000Z",
    recipientCount: 1, status: "accepted", recipients: [{ memberId: "m1", memberName: "Alex Lane", status: "sent" }],
  }] as never });
  const user = userEvent.setup();
  renderForAdmin();
  await screen.findByRole("button", { name: "View details for Practice Friday" });
  const table = screen.getByRole("table", { name: "Message history table" });
  expect(within(table).getByRole("columnheader", { name: "Recipients" })).toBeInTheDocument();
  expect(within(table).getByRole("button", { name: "View details for Practice Friday" })).toBeInTheDocument();
  await user.click(within(table).getByRole("button", { name: "View details for Practice Friday" }));
  const details = screen.getByRole("dialog", { name: "Message details" });
  expect(within(details).getByText("Alex Lane")).toBeInTheDocument();
  await user.click(within(details).getByRole("button", { name: "Close modal" }));
  await user.click(screen.getByRole("combobox", { name: /Status/ }));
  await user.click(screen.getByRole("option", { name: "Failed" }));
  expect(within(table).getByText("No messages match these filters.")).toBeInTheDocument();
});

it("shows compact message rows at phone width", async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({ matches: query === "(max-width: 767px)", media: query, addEventListener: jest.fn(), removeEventListener: jest.fn() }));
  jest.mocked(getMessageHistory).mockResolvedValue({ success: true, nextCursor: "", entries: [{
    historyId: "h1", messageType: "custom_message", summary: "Practice Friday", createdAt: "2026-10-22T12:00:00.000Z",
    recipientCount: 1, status: "accepted", recipients: [{ memberId: "m1", memberName: "Alex Lane", status: "sent" }],
  }] as never });
  try {
    const user = userEvent.setup();
    renderForAdmin();
    await screen.findByRole("button", { name: "View details for Practice Friday" });
    const list = screen.getByRole("list", { name: "Message history table" });
    expect(screen.queryByRole("table", { name: "Message history table" })).not.toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "View details for Practice Friday" }));
    expect(within(screen.getByRole("dialog", { name: "Message details" })).getByText("Alex Lane")).toBeInTheDocument();
  } finally { window.matchMedia = originalMatchMedia; }
});

it("confirms a bulk message once and preserves the draft when confirmation is canceled", async () => {
  const user = userEvent.setup();
  renderForAdmin();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  await user.click(screen.getByRole("button", { name: "Teams" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Praise Team" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Tech Team" }));
  expect(screen.getByRole("menuitemcheckbox", { name: "Praise Team" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("menuitemcheckbox", { name: "Tech Team" })).toHaveAttribute("aria-checked", "true");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Teams" })).toHaveTextContent("2 teams selected");
  expect(screen.getByText("2 selected · 2 eligible · 0 excluded")).toBeInTheDocument();
  await user.type(screen.getByLabelText(/Search volunteers/), "Alex");
  expect(screen.getByText("2 selected · 2 eligible · 0 excluded · 1 hidden by search")).toBeInTheDocument();
  await user.clear(screen.getByLabelText(/Search volunteers/));
  expect(within(screen.getByRole("list", { name: "Volunteers" })).getByRole("checkbox", { name: "Casey Stone" })).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: /Message:/ }), "Practice Friday.");
  expect(screen.getByText(/about 1 SMS segment/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send to 2 volunteers" }));
  expect(prepareCustomMessage).toHaveBeenCalledWith("church", expect.objectContaining({ memberIds: ["m1", "m2"], message: "Practice Friday." }));
  expect(screen.getByText("Send this message to 2 volunteers?")).toBeInTheDocument();
  expect(screen.getByText("Practice Friday. Reply STOP to opt out.")).toBeInTheDocument();
  expect(screen.getByText("2 eligible · 0 excluded · 2 estimated SMS segments")).toBeInTheDocument();
  expect(screen.queryByText(/awaiting SMS campaign|feature flag/i)).not.toBeInTheDocument();
  const sendButton = screen.getByRole("button", { name: "Send 2 messages" });
  expect(sendButton).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: /Message:/ })).toHaveValue("Practice Friday.");
  await user.click(screen.getByRole("button", { name: "Send to 2 volunteers" }));
  await screen.findByText("Send this message to 2 volunteers?");
  await user.click(screen.getByRole("button", { name: "Send 2 messages" }));
  expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledWith("church", "b1", "review-v1");
});

it("sends one eligible recipient after one click when the prepared details match the composer", async () => {
  const singleBatch = {
    ...batch,
    selectedMemberIds: ["m1"], intentIds: ["i1"], approvalVersion: "single-v1",
    recipients: [batch.recipients[0]],
    summary: { ...batch.summary, eligible: 1, excluded: 0, totalSegments: 1 },
  };
  const sentBatch = {
    ...singleBatch, status: "sent",
    recipients: [{ ...singleBatch.recipients[0], status: "sent", eligible: false }],
    summary: { ...singleBatch.summary, sent: 1, delivered: 0, failed: 0, uncertain: 0 },
  };
  jest.mocked(prepareCustomMessage).mockResolvedValueOnce({ success: true, batch: singleBatch as never });
  jest.mocked(dispatchAvailabilityNotificationBatch).mockResolvedValueOnce({ success: true, batch: sentBatch as never });
  const user = userEvent.setup();
  renderForAdmin();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  await user.click(screen.getByRole("checkbox", { name: "Alex Lane" }));
  await user.type(screen.getByRole("textbox", { name: /Message:/ }), "Practice Friday.");
  expect(screen.getByText(/Alex Lane/, { selector: "p" })).toBeInTheDocument();
  expect(screen.getByText("Practice Friday. Reply STOP to opt out.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledWith("church", "b1", "single-v1"));
  expect(prepareCustomMessage).toHaveBeenCalledWith("church", expect.objectContaining({ memberIds: ["m1"], message: "Practice Friday." }));
  expect(screen.queryByText(/Send this message to/)).not.toBeInTheDocument();
});

it("ignores a rapid second click while a single-recipient send is preparing", async () => {
  const singleBatch = {
    ...batch,
    selectedMemberIds: ["m1"], intentIds: ["i1"], approvalVersion: "single-v1",
    recipients: [batch.recipients[0]],
    summary: { ...batch.summary, eligible: 1, excluded: 0, totalSegments: 1 },
  };
  let resolvePreparation: ((value: { success: boolean; batch: typeof singleBatch }) => void) | undefined;
  jest.mocked(prepareCustomMessage).mockReturnValueOnce(new Promise((resolve) => { resolvePreparation = resolve; }) as never);
  const user = userEvent.setup();
  renderForAdmin();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  await user.click(screen.getByRole("checkbox", { name: "Alex Lane" }));
  await user.type(screen.getByRole("textbox", { name: /Message:/ }), "Practice Friday.");
  await user.dblClick(screen.getByRole("button", { name: "Send message" }));
  expect(prepareCustomMessage).toHaveBeenCalledTimes(1);
  resolvePreparation?.({ success: true, batch: singleBatch });
  await waitFor(() => expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledTimes(1));
});

it("refreshes an expired approval and sends only when the confirmed details still match", async () => {
  const firstBatch = {
    ...batch, batchId: "b1", selectedMemberIds: ["m1"], intentIds: ["i1"], approvalVersion: "expired-v1",
    recipients: [batch.recipients[0]],
    summary: { ...batch.summary, eligible: 1, excluded: 0, totalSegments: 1 },
  };
  const freshBatch = { ...firstBatch, batchId: "b2", approvalVersion: "fresh-v2" };
  const sentBatch = {
    ...freshBatch, status: "sent",
    recipients: [{ ...freshBatch.recipients[0], status: "sent", eligible: false }],
    summary: { ...freshBatch.summary, sent: 1, delivered: 0, failed: 0, uncertain: 0 },
  };
  jest.mocked(prepareCustomMessage)
    .mockResolvedValueOnce({ success: true, batch: firstBatch as never })
    .mockResolvedValueOnce({ success: true, batch: freshBatch as never });
  jest.mocked(dispatchAvailabilityNotificationBatch)
    .mockRejectedValueOnce(Object.assign(new Error("This batch preview changed or expired."), { status: 409 }))
    .mockResolvedValueOnce({ success: true, batch: sentBatch as never });
  jest.mocked(getAvailabilityNotificationBatch).mockResolvedValueOnce({ success: true, batch: firstBatch as never });
  const user = userEvent.setup();
  renderForAdmin();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  await user.click(screen.getByRole("checkbox", { name: "Alex Lane" }));
  await user.type(screen.getByRole("textbox", { name: /Message:/ }), "Practice Friday.");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledTimes(2));
  expect(prepareCustomMessage).toHaveBeenCalledTimes(2);
  expect(dispatchAvailabilityNotificationBatch).toHaveBeenNthCalledWith(2, "church", "b2", "fresh-v2");
  expect(screen.queryByRole("dialog", { name: "Confirm message" })).not.toBeInTheDocument();
});

it("keeps the editable draft after an authenticated send rejection", async () => {
  const singleBatch = {
    ...batch,
    selectedMemberIds: ["m1"], intentIds: ["i1"], approvalVersion: "single-v1",
    recipients: [batch.recipients[0]],
    summary: { ...batch.summary, eligible: 1, excluded: 0, totalSegments: 1 },
  };
  jest.mocked(prepareCustomMessage).mockResolvedValueOnce({ success: true, batch: singleBatch as never });
  jest.mocked(getAvailabilityNotificationBatch).mockResolvedValueOnce({ success: true, batch: singleBatch as never });
  jest.mocked(dispatchAvailabilityNotificationBatch).mockRejectedValueOnce(
    Object.assign(new Error("Your session could not be refreshed."), { status: 403, code: "AUTH_CSRF_MISMATCH" }),
  );
  const user = userEvent.setup();
  renderForAdmin();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  await user.click(screen.getByRole("checkbox", { name: "Alex Lane" }));
  await user.type(screen.getByRole("textbox", { name: /Message:/ }), "Practice Friday.");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No message was sent. Your draft is saved.");
  expect(screen.getByRole("textbox", { name: /Message:/ })).toHaveValue("Practice Friday.");
  expect(prepareCustomMessage).toHaveBeenCalledTimes(1);
  expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledTimes(1);
});

it("reprepares and recovers after a dispatch fails before any provider request", async () => {
  const singleBatch = {
    ...batch,
    selectedMemberIds: ["m1"], intentIds: ["i1"], approvalVersion: "single-v1",
    recipients: [batch.recipients[0]],
    summary: { ...batch.summary, eligible: 1, excluded: 0, totalSegments: 1 },
  };
  const freshBatch = {
    ...singleBatch, batchId: "b2", intentIds: ["i2"], approvalVersion: "fresh-v2",
  };
  const sentBatch = {
    ...freshBatch, status: "sent",
    recipients: [{ ...freshBatch.recipients[0], status: "sent", eligible: false }],
    summary: { ...freshBatch.summary, sent: 1, delivered: 0, failed: 0, uncertain: 0 },
  };
  jest.mocked(prepareCustomMessage)
    .mockResolvedValueOnce({ success: true, batch: singleBatch as never })
    .mockResolvedValueOnce({ success: true, batch: freshBatch as never });
  jest.mocked(getAvailabilityNotificationBatch).mockResolvedValueOnce({ success: true, batch: singleBatch as never });
  jest.mocked(dispatchAvailabilityNotificationBatch)
    .mockRejectedValueOnce(Object.assign(new Error("Could not send this message."), { status: 500 }))
    .mockResolvedValueOnce({ success: true, batch: sentBatch as never });

  const user = userEvent.setup();
  renderForAdmin();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  await user.click(screen.getByRole("checkbox", { name: "Alex Lane" }));
  await user.type(screen.getByRole("textbox", { name: /Message:/ }), "Practice Friday.");
  await user.click(screen.getByRole("button", { name: "Send message" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("No message was sent. Your draft is saved. Choose Send again to prepare a fresh review.");
  expect(screen.getByRole("textbox", { name: /Message:/ })).toHaveValue("Practice Friday.");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledTimes(2));
  expect(prepareCustomMessage).toHaveBeenCalledTimes(2);
  expect(prepareCustomMessage).toHaveBeenLastCalledWith("church", expect.objectContaining({ memberIds: ["m1"], message: "Practice Friday." }));
  expect(dispatchAvailabilityNotificationBatch).toHaveBeenNthCalledWith(1, "church", "b1", "single-v1");
  expect(dispatchAvailabilityNotificationBatch).toHaveBeenNthCalledWith(2, "church", "b2", "fresh-v2");
});

it("requires confirmation when single-recipient destination details change during preparation", async () => {
  const changedBatch = {
    ...batch,
    selectedMemberIds: ["m1"], intentIds: ["i1"], approvalVersion: "changed-v1",
    recipients: [{ ...batch.recipients[0], maskedPhoneNumber: "••• ••• 9999" }],
    summary: { ...batch.summary, eligible: 1, excluded: 0, totalSegments: 1 },
  };
  jest.mocked(prepareCustomMessage).mockResolvedValueOnce({ success: true, batch: changedBatch as never });
  const user = userEvent.setup();
  renderForAdmin();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  await user.click(screen.getByRole("checkbox", { name: "Alex Lane" }));
  await user.type(screen.getByRole("textbox", { name: /Message:/ }), "Practice Friday.");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("dialog", { name: "Review updated message" })).toBeInTheDocument();
  expect(screen.getByText(/9999/, { selector: "p" })).toBeInTheDocument();
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledWith("church", "b1", "changed-v1");
});

it("requires confirmation when the prepared single-recipient segment estimate changes", async () => {
  const changedSegmentBatch = {
    ...batch,
    selectedMemberIds: ["m1"], intentIds: ["i1"], approvalVersion: "segments-v1",
    recipients: [{ ...batch.recipients[0], segmentCount: 2 }],
    summary: { ...batch.summary, eligible: 1, excluded: 0, totalSegments: 2 },
  };
  jest.mocked(prepareCustomMessage).mockResolvedValueOnce({ success: true, batch: changedSegmentBatch as never });
  const user = userEvent.setup();
  renderForAdmin();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  await user.click(screen.getByRole("checkbox", { name: "Alex Lane" }));
  await user.type(screen.getByRole("textbox", { name: /Message:/ }), "Practice Friday.");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("dialog", { name: "Review updated message" })).toBeInTheDocument();
  expect(screen.getByText(/1 eligible.*0 excluded.*2 estimated SMS segments/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();
});

it("restores editable drafts by church and administrator and removes legacy review pointers", async () => {
  const storageKey = "worshipsync:custom-message-draft:v1:church:admin-1";
  window.localStorage.setItem(storageKey, JSON.stringify({ message: "Practice Friday.", memberIds: ["m1"] }));
  window.localStorage.setItem("worshipsync:last-custom-message:church", "expired-batch");
  const user = userEvent.setup();
  const view = renderForAdmin("admin-1");
  expect(await screen.findByText("Message history")).toBeInTheDocument();
  expect(screen.queryByText(/earlier message review/i)).not.toBeInTheDocument();
  expect(getAvailabilityNotificationBatch).not.toHaveBeenCalled();
  expect(window.localStorage.getItem("worshipsync:last-custom-message:church")).toBeNull();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  expect(screen.getByRole("textbox", { name: /Message:/ })).toHaveValue("Practice Friday.");
  expect(screen.getByRole("checkbox", { name: "Alex Lane" })).toBeChecked();
  view.rerender(<GlobalInfoContext.Provider value={{ sessionKind: "human", userId: "admin-2" } as never}><TeamsMessagesPage /></GlobalInfoContext.Provider>);
  await screen.findByText("Message history");
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  expect(screen.getByRole("textbox", { name: /Message:/ })).toHaveValue("");
  expect(screen.getByRole("checkbox", { name: "Alex Lane" })).not.toBeChecked();
  view.rerender(<GlobalInfoContext.Provider value={{ sessionKind: "human", userId: "admin-1" } as never}><TeamsMessagesPage /></GlobalInfoContext.Provider>);
  await screen.findByText("Message history");
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  expect(screen.getByRole("textbox", { name: /Message:/ })).toHaveValue("Practice Friday.");
  expect(screen.getByRole("checkbox", { name: "Alex Lane" })).toBeChecked();
});

it("checks an uncertain custom send from message history without dispatching it again", async () => {
  jest.mocked(getMessageHistory).mockResolvedValue({ success: true, nextCursor: "", entries: [{
    historyId: "b1", messageType: "custom_message", summary: "Practice Friday.", createdAt: "2026-10-22T12:00:00.000Z",
    recipientCount: 1, status: "unconfirmed", recipients: [{ memberId: "m1", memberName: "Alex Lane", status: "unknown", outcome: "unknown" }],
  }] as never });
  const uncertainBatch = {
    ...batch, batchId: "b1", status: "partial",
    recipients: [{ ...batch.recipients[0], status: "unknown", eligible: false, attemptOutcome: "unknown" }],
    summary: { ...batch.summary, eligible: 0, sent: 0, delivered: 0, failed: 0, uncertain: 1 },
  };
  jest.mocked(getAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch: uncertainBatch as never });
  const user = userEvent.setup();
  renderForAdmin();
  await user.click(await screen.findByRole("button", { name: "View details for Practice Friday." }));
  await user.click(screen.getByRole("button", { name: "Check delivery status" }));
  expect(await screen.findByText("Latest status: 0 accepted · 0 delivered · 0 failed · 1 unconfirmed.")).toBeInTheDocument();
  expect(getAvailabilityNotificationBatch).toHaveBeenCalledWith("church", "b1");
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();
});

it("updates open history details after delivery becomes confirmed", async () => {
  const unresolvedEntry = {
    historyId: "b1", messageType: "custom_message", summary: "Practice Friday.", createdAt: "2026-10-22T12:00:00.000Z",
    recipientCount: 1, status: "unconfirmed", recipients: [{ memberId: "m1", memberName: "Alex Lane", status: "unknown", outcome: "unknown" }],
  };
  const deliveredEntry = {
    ...unresolvedEntry, status: "delivered",
    recipients: [{ memberId: "m1", memberName: "Alex Lane", status: "sent", deliveryStatus: "delivered", outcome: "delivered", failureMessage: "" }],
  };
  jest.mocked(getMessageHistory)
    .mockResolvedValueOnce({ success: true, nextCursor: "", entries: [unresolvedEntry] as never })
    .mockResolvedValueOnce({ success: true, nextCursor: "", entries: [deliveredEntry] as never });
  const deliveredBatch = {
    ...batch, batchId: "b1", status: "sent",
    recipients: [{ ...batch.recipients[0], status: "sent", eligible: false, attemptStatus: "delivered" }],
    summary: { ...batch.summary, eligible: 0, excluded: 0, totalSegments: 1, sent: 1, delivered: 1, failed: 0, uncertain: 0 },
  };
  jest.mocked(getAvailabilityNotificationBatch).mockResolvedValueOnce({ success: true, batch: deliveredBatch as never });
  const user = userEvent.setup();
  renderForAdmin();
  await user.click(await screen.findByRole("button", { name: "View details for Practice Friday." }));
  await user.click(screen.getByRole("button", { name: "Check delivery status" }));
  await screen.findByText(/Latest status: 1 accepted.*1 delivered.*0 failed.*0 unconfirmed/);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Check delivery status" })).not.toBeInTheDocument());
  expect(screen.getAllByText("Delivered").length).toBeGreaterThan(0);
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();
});

it("shows the specific reason an excluded volunteer cannot receive the reviewed message", async () => {
  const reviewedBatch = {
    ...batch,
    recipients: [batch.recipients[0], {
      ...batch.recipients[1], eligible: false, status: "excluded",
      exclusionReason: "SMS consent is needed for this phone number.",
    }],
    summary: { ...batch.summary, eligible: 1, excluded: 1, totalSegments: 1 },
  };
  jest.mocked(prepareCustomMessage).mockResolvedValue({ success: true, batch: reviewedBatch as never });
  const user = userEvent.setup();
  renderForAdmin();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  await user.click(screen.getByRole("button", { name: "Select all eligible volunteers" }));
  await user.type(screen.getByRole("textbox", { name: /Message:/ }), "Practice Friday.");
  await user.click(screen.getByRole("button", { name: "Send to 2 volunteers" }));
  await user.click(screen.getByText("Show recipients"));
  expect(screen.getByText("SMS consent is needed for this phone number.")).toBeInTheDocument();
  expect(screen.getByText("Send this message to 1 volunteer?")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send 1 message" })).toBeEnabled();
});

it("removes deselected teams while preserving individual volunteer changes", async () => {
  const user = userEvent.setup();
  renderForAdmin();
  await user.click(screen.getByRole("button", { name: "+ New message" }));
  await user.click(screen.getByRole("button", { name: "Teams" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Praise Team" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Tech Team" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Praise Team" }));
  expect(screen.getByText("1 selected · 1 eligible · 0 excluded")).toBeInTheDocument();
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Praise Team" }));
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("checkbox", { name: "Alex Lane" }));
  expect(screen.getByText("1 selected · 1 eligible · 0 excluded")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Teams" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Praise Team" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Praise Team" }));
  expect(screen.getByText("1 selected · 1 eligible · 0 excluded")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.getByText("0 selected · 0 eligible · 0 excluded")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Teams" })).toHaveTextContent("Choose teams");
});
