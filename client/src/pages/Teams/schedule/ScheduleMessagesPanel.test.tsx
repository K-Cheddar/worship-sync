import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotificationIntent } from "../../../api/authTypes";
import ScheduleMessagesPanel from "./ScheduleMessagesPanel";

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
