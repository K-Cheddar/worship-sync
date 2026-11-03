import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScheduleServiceAdditionNotice, { scheduleServiceAdditionDismissalKey } from "./ScheduleServiceAdditionNotice";

it("summarizes recurring occurrences once using the church timezone and can be dismissed", async () => {
  const user = userEvent.setup();
  const onDismiss = jest.fn();
  const addedOccurrences = [7, 14, 21, 28].map((day) => ({
    occurrenceId: `sabbath@2026-11-${String(day).padStart(2, "0")}`,
    serviceId: "sabbath",
    name: "Sabbath Service",
    startsAt: `2026-11-${String(day).padStart(2, "0")}T15:30:00.000Z`,
    serviceDate: `2026-11-${String(day).padStart(2, "0")}`,
  }));
  render(<ScheduleServiceAdditionNotice
    addedOccurrences={addedOccurrences}
    periodName="November 2026"
    timeZone="America/New_York"
    onDismiss={onDismiss}
  />);

  const notice = screen.getByRole("status", { name: "New service addition" });
  expect(screen.getByText("New service added")).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(notice).toHaveTextContent("Sabbath Service — 4 occurrences, first Sat, Nov 7, 2026, 10:30 AM EST");
  expect(notice).toHaveTextContent("Added to your November 2026 schedule.");

  await user.click(screen.getByRole("button", { name: "Dismiss service addition notice" }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("scopes a dismissal to church, team, schedule and committed occurrence IDs", () => {
  const scope = {
    churchId: "church-a",
    teamId: "team-a",
    scheduleId: "schedule-a",
    occurrenceIds: ["service@2026-11-14", "service@2026-11-07"],
  };
  const key = scheduleServiceAdditionDismissalKey(scope);
  expect(scheduleServiceAdditionDismissalKey({ ...scope, occurrenceIds: [...scope.occurrenceIds].reverse() })).toBe(key);
  expect(scheduleServiceAdditionDismissalKey({ ...scope, churchId: "church-b" })).not.toBe(key);
  expect(scheduleServiceAdditionDismissalKey({ ...scope, teamId: "team-b" })).not.toBe(key);
  expect(scheduleServiceAdditionDismissalKey({ ...scope, scheduleId: "schedule-b" })).not.toBe(key);
  expect(scheduleServiceAdditionDismissalKey({ ...scope, occurrenceIds: ["service@2026-11-21"] })).not.toBe(key);
});
