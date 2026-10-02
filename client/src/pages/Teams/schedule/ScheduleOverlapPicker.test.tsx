import { render, screen, within } from "@testing-library/react";
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

    expect(screen.queryByRole("button", { name: "Schedule: October 2026" })).not.toBeInTheDocument();
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

    const trigger = screen.getByRole("button", { name: "Schedule: October 2026" });
    await user.click(trigger);
    const options = within(screen.getByRole("group", { name: "Overlapping schedules" }));
    expect(options.getByRole("button", { name: /October 2026/ })).toBeInTheDocument();
    expect(screen.getByText("Oct 1, 2026 – Oct 31, 2026")).toBeInTheDocument();
    await user.click(options.getByRole("button", { name: /Quarter 4 2026/ }));

    expect(onSelect).toHaveBeenCalledWith("quarter");
  });

  it("offers Current period alongside an overlapping partial generated schedule", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(
      <ScheduleOverlapPicker
        schedules={[
          {
            ...schedule("virtual:team-1:2026-10-01:2026-10-31", "October 2026", "2026-10-01", "2026-10-31"),
            source: "generated-period",
          },
          {
            ...schedule("generated_old-period", "Old generated schedule", "2026-09-29", "2026-10-05"),
            source: "generated-period",
            generatedPeriodKey: "old-period",
          },
        ]}
        selectedScheduleId="virtual:team-1:2026-10-01:2026-10-31"
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Schedule: October 2026" }));
    const options = within(screen.getByRole("group", { name: "Overlapping schedules" }));
    expect(options.getByRole("button", { name: /Current period.*Oct 1, 2026.*Oct 31, 2026/ })).toBeInTheDocument();
    expect(options.getByRole("button", { name: /Old generated schedule.*Sep 29, 2026.*Oct 5, 2026/ })).toBeInTheDocument();
    await user.click(options.getByRole("button", { name: /Old generated schedule/ }));

    expect(onSelect).toHaveBeenCalledWith("generated_old-period");
  });
});
