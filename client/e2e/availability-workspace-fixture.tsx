import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import AvailabilityFormWorkspace from "../src/pages/Teams/components/AvailabilityFormWorkspace";
import { getAvailabilityFormProgress } from "../src/pages/Teams/availabilityFormProgress";
import type { TeamIntakeForm } from "../src/api/authTypes";

const form: TeamIntakeForm = {
  formId: "form",
  churchId: "church",
  purpose: "team_availability",
  name: "November Availability",
  active: true,
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  teamIds: ["praise"],
  availabilityServices: [],
  availabilityOccurrences: [1, 8, 15, 22, 29].map((day) => ({
    occurrenceId: `day-${day}`,
    serviceId: "service",
    serviceDate: `2026-11-${String(day).padStart(2, "0")}`,
    startsAt: `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`,
    name: "Sunday worship",
  })),
};
const members = ["Jane Smith", "John Davis", "Mary Wilson"].map(
  (name, index) => ({
    memberId: `member-${index}`,
    churchId: "church",
    firstName: name.split(" ")[0],
    lastName: name.split(" ")[1],
    positionIds: [],
    blockoutDates: [],
    teamMemberships: { praise: { teamId: "praise" } },
  }),
);
const recipients = members
  .slice(0, 2)
  .map((member, index) => ({
    recipientId: `recipient-${index}`,
    memberId: member.memberId,
    churchId: "church",
    formId: "form",
    createdAt: "2026-10-21T10:00:00Z",
    linkCopiedAt: "2026-10-21T10:00:00Z",
    ...(index === 0 ? { respondedAt: "2026-10-21T11:00:00Z" } : {}),
  }));
const teams = [
  {
    teamId: "praise",
    churchId: "church",
    name: "Praise Team",
    memberIds: members.map((member) => member.memberId),
  },
];
const noop = () => undefined;
const rows = getAvailabilityFormProgress(
  {
    form,
    members,
    recipients,
    teams,
    positions: [],
    intentType: "availability_request",
  },
  [
    {
      formId: "form",
      recipientId: "recipient-0",
      memberId: "member-0",
      respondedAt: "2026-10-21T11:00:00Z",
      submittedAt: "2026-10-21T11:00:00Z",
      occurrenceAvailability: {
        "day-1": "available",
        "day-8": "unavailable",
        "day-15": "available",
      },
    },
  ],
  [],
);

function Fixture() {
  const [sendOpen, setSendOpen] = useState(false);
  return (
    <main className="min-h-dvh bg-gray-950 p-3 text-white sm:p-6">
      <AvailabilityFormWorkspace
        rows={rows}
        canEdit
        canCopyGeneralLink
        linkBusy={false}
        serviceTimeZone="UTC"
        sendOpen={sendOpen}
        onSend={() => setSendOpen(true)}
        onEdit={noop}
        onBack={noop}
        onCopyGeneralLink={async () => undefined}
        onRefresh={noop}
        recipientActions={{
          onCreateLink: noop,
          onCopyLink: noop,
          onOpenLink: noop,
          onRevoke: noop,
        }}
        sendFlowProps={{
          churchId: "church",
          form,
          members,
          positions: [],
          teams,
          recipients,
          notificationIntents: [],
          smsDeliveryAttempts: [],
          eligibilityByMemberId: Object.fromEntries(
            members.map((member) => [member.memberId, { eligible: true }]),
          ),
          historyLoaded: true,
          historyError: "",
          onRetryHistory: noop,
          onClose: () => setSendOpen(false),
        }}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
