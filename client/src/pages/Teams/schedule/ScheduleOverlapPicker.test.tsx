import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamScheduleSummary } from "../../../api/authTypes";
import ScheduleOverlapPicker from "./ScheduleOverlapPicker";

const schedule = (scheduleId: string, name: string, startDate: string, endDate: string): TeamScheduleSummary => ({
  scheduleId,
  churchId: "church-1",
  teamId: "team-1",
  name,
  startDate,
  endDate,
  serviceIds: [],
});

describe("ScheduleOverlapPicker", () => {
  it("stays hidden for one overlapping schedule", () => {
    render(
      <ScheduleOverlapPicker
        schedules={[schedule("october", "October 2026", "2026-10-01", "2026-10-31")]}
        selectedScheduleId="october"
        onSelect={jest.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Schedule" })).not.toBeInTheDocument();
  });

  it("shows both schedules with their persisted bounds and switches the selected schedule", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(
      <ScheduleOverlapPicker
        schedules={[
          schedule("october", "October 2026", "2026-10-01", "2026-10-31"),
          schedule("quarter", "Quarter 4 2026", "2026-10-01", "2026-12-31"),
        ]}
        selectedScheduleId="october"
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.getByRole("button", { name: /October 2026/ })).toBeInTheDocument();
    expect(screen.getByText("Oct 1, 2026 – Oct 31, 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Quarter 4 2026/ }));

    expect(onSelect).toHaveBeenCalledWith("quarter");
  });
});
