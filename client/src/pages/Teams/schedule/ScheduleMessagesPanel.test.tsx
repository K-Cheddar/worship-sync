import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotificationIntent } from "../../../api/authTypes";
import ScheduleMessagesPanel from "./ScheduleMessagesPanel";
import ScheduleReplacementInvitationForm from "./ScheduleReplacementInvitationForm";

const intent = (overrides: Partial<NotificationIntent>): NotificationIntent => ({
  intentId: "intent-assignment",
  churchId: "church-1",
  intentType: "assignment_notification",
  sourceType: "team_schedule",
  sourceId: "schedule-1",
  sourceVersion: "version-1",
  memberId: "member-1",
  occurrenceId: "occurrence-1",
  cellKey: "position-1",
  channel: "sms",
  status: "ready",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  messagePreview: "You are scheduled this Sunday.",
  previewEligible: true,
  ...overrides,
});

describe("ScheduleMessagesPanel", () => {
  it("prepares a selected replacement for review and exposes permission failures", async () => {
    const user = userEvent.setup();
    let rejectPreparation: (error: Error) => void = () => undefined;
    const onPrepare = jest.fn(() => new Promise<void>((resolve, reject) => { rejectPreparation = reject; }));
    const vacancy = { occurrenceId: "occ-1", cellKey: "camera::0", label: "Sunday · Camera", memberIds: ["candidate"] };
    render(<ScheduleMessagesPanel open onOpenChange={jest.fn()} intents={[]} members={[
      { memberId: "candidate", churchId: "church-1", firstName: "Rae", lastName: "Rivera", positionIds: ["camera"], blockoutDates: [] },
      { memberId: "unrelated", churchId: "church-1", firstName: "Other", lastName: "Team", positionIds: [], blockoutDates: [] },
    ]} duplicateFirstNames={new Set()} counts={{ requested: 0, accepted: 0, delivered: 0, failed: 0, uncertain: 0, responded: 0, waiting: 0, optedOut: 0 }} loading={false} nextCursor="" sendingIntentId="" getVolunteerResponse={() => "waiting"} onSend={jest.fn()} onCloseInvitation={jest.fn()} onLoadOlder={jest.fn()} replacementVacancies={[vacancy]} onPrepareReplacement={onPrepare} />);
    await user.click(screen.getByText("Invite a replacement by SMS"));
    expect(screen.getByRole("button", { name: "Review replacement SMS" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: /Vacant or declined assignment/ }));
    await user.click(screen.getByRole("option", { name: "Sunday · Camera" }));
    await user.click(screen.getByRole("combobox", { name: /Replacement volunteer/ }));
    expect(screen.queryByRole("option", { name: "Other Team" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Rae" }));
    await user.click(screen.getByRole("button", { name: "Review replacement SMS" }));
    expect(onPrepare).toHaveBeenCalledWith(vacancy, "candidate");
    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Review replacement SMS" })).toBeDisabled();
    await act(async () => { rejectPreparation(new Error("Teams edit access required")); });
    expect(screen.getByRole("alert")).toHaveTextContent("Teams edit access required");
    expect(screen.getByRole("button", { name: "Review replacement SMS" })).toBeEnabled();
  });

  it("retires a pending preparation when the schedule form changes", async () => {
    const user = userEvent.setup();
    let rejectPreparation: (error: Error) => void = () => undefined;
    const onPrepare = jest.fn(() => new Promise<void>((resolve, reject) => { rejectPreparation = reject; }));
    const props = {
      vacancies: [{ occurrenceId: "occ-1", cellKey: "camera::0", label: "Sunday · Camera", memberIds: ["candidate"] }],
      members: [{ memberId: "candidate", churchId: "church-1", firstName: "Rae", lastName: "Rivera", positionIds: ["camera"], blockoutDates: [] }],
      duplicateFirstNames: new Set<string>(), onPrepare,
    };
    const view = render(<ScheduleReplacementInvitationForm key="church-1:schedule-1" {...props} />);
    await user.click(screen.getByText("Invite a replacement by SMS"));
    await user.click(screen.getByRole("combobox", { name: /Vacant or declined assignment/ }));
    await user.click(screen.getByRole("option", { name: "Sunday · Camera" }));
    await user.click(screen.getByRole("combobox", { name: /Replacement volunteer/ }));
    await user.click(screen.getByRole("option", { name: "Rae" }));
    await user.click(screen.getByRole("button", { name: "Review replacement SMS" }));
    view.rerender(<ScheduleReplacementInvitationForm key="church-2:schedule-1" {...props} />);
    await act(async () => { rejectPreparation(new Error("Old church permission denied")); });
    await user.click(screen.getByText("Invite a replacement by SMS"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review replacement SMS" })).toBeDisabled();
  });

  it("shows status detail and keeps individual review actions available", async () => {
    const user = userEvent.setup();
    const assignmentIntent = intent({});
    const replacementIntent = intent({
      intentId: "intent-replacement",
      intentType: "replacement_request",
      status: "preview",
      messagePreview: "Can you serve this Sunday?",
    });
    const uncertainIntent = intent({
      intentId: "intent-uncertain",
      status: "unknown",
      attemptOutcome: "unknown",
      attemptStatus: "failed",
      previewEligible: false,
    });
    const onSend = jest.fn();
    const onCloseInvitation = jest.fn();
    const onLoadOlder = jest.fn();

    render(
      <ScheduleMessagesPanel
        open
        onOpenChange={jest.fn()}
        intents={[assignmentIntent, replacementIntent, uncertainIntent]}
        members={[]}
        duplicateFirstNames={new Set()}
        counts={{ requested: 3, accepted: 1, delivered: 1, failed: 0, uncertain: 1, responded: 0, waiting: 3, optedOut: 0 }}
        loading={false}
        nextCursor="older"
        sendingIntentId=""
        getVolunteerResponse={() => "waiting"}
        onSend={onSend}
        onCloseInvitation={onCloseInvitation}
        onLoadOlder={onLoadOlder}
      />,
    );

    expect(screen.getByText("Provider accepted 1")).toBeInTheDocument();
    expect(screen.getByText(/Provider outcome uncertain/)).toBeInTheDocument();
    expect(screen.getAllByText("You are scheduled this Sunday.")).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "Send one SMS" })[0]);
    await user.click(screen.getByRole("button", { name: "Close invitation" }));
    await user.click(screen.getByRole("button", { name: "Load older message history" }));

    expect(onSend).toHaveBeenCalledWith(assignmentIntent);
    expect(onCloseInvitation).toHaveBeenCalledWith(replacementIntent);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });
});
