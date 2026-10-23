import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import ScheduleAssignmentPicker from "../src/pages/Teams/schedule/ScheduleAssignmentPicker";
import "../src/index.css";
const Fixture = () => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        anchor?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest(
          "[data-schedule-assignment-menu], [data-schedule-cell-trigger]",
        )
      )
        setOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", outside);
    };
  }, [anchor]);
  return (
    <main className="min-h-dvh bg-gray-950 p-4 text-white">
      <button
        data-schedule-cell-trigger
        ref={setAnchor}
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
      >
        Choose assignee
      </button>
      <p role="status">{status}</p>
      <ScheduleAssignmentPicker
        open={open}
        anchorEl={anchor}
        label="Sunday Vocal"
        churchId="church-1"
        teamId="team-1"
        teamName="Worship"
        positionId="vocal"
        positionName="Vocal"
        members={[]}
        assignmentQuery={query}
        onAssignmentQueryChange={setQuery}
        currentPrimaryMemberId=""
        currentAssigneeLabel="Empty"
        getIssue={() => ""}
        onSelectMember={() => undefined}
        onClose={() => {
          setOpen(false);
          anchor?.focus();
        }}
        onAssignGuest={() => undefined}
        onCreateMember={async (draft) => {
          setStatus(`Saved ${draft.firstName} ${draft.lastName}`);
          setOpen(false);
          return {
            member: {
              memberId: "created",
              churchId: "church-1",
              ...draft,
              positionIds: ["vocal"],
              blockoutDates: [],
            },
          };
        }}
      />
    </main>
  );
};
createRoot(document.getElementById("root")!).render(<Fixture />);
