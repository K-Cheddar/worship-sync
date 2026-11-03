import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { TeamSchedule, TeamService } from "../../../api/authTypes";
import ScheduleServiceChanges from "./ScheduleServiceChanges";

it("explains an identity collision between identically named services without substituting saved staffing", async () => {
  const user = userEvent.setup();
  const services: TeamService[] = ["old", "new"].map((id) => ({
    id, serviceId: id, name: "Worship", timerType: "countdown", reccurence: "one_time",
    dateTimeISO: "2026-11-07T15:00:00.000Z", positionRequirements: [{ positionId: "vocal", count: 1 }],
  }));
  const schedule: TeamSchedule = {
    scheduleId: "saved", churchId: "church", teamId: "team", name: "November",
    startDate: "2026-11-01", endDate: "2026-11-30", serviceIds: ["old"],
    occurrences: [{ occurrenceId: "old@legacy", serviceId: "old", name: "Worship", startsAt: services[0].dateTimeISO! }],
    assignments: { "old@legacy": { "vocal::0": { primaryMemberId: "member" } } },
    microphoneAssignments: { "old@legacy": { "vocal::0": ["mic"] } },
  };
  const before = JSON.stringify(schedule);
  const viewSaved = jest.fn();
  render(<MemoryRouter><ScheduleServiceChanges
    churchId="church" teamId="team" range={{ start: "2026-11-01", end: "2026-11-30" }} timeZone="America/New_York"
    services={services} positions={[{ positionId: "vocal", churchId: "church", teamId: "team", name: "Vocal" }]}
    schedules={[schedule]} onViewSaved={viewSaved} onManageSchedules={jest.fn()}
  /></MemoryRouter>);
  await user.click(screen.getByText("Compare service changes"));
  expect(screen.getByText("Identity needs review")).toBeInTheDocument();
  expect(screen.getByText(/Service IDs: old/)).toBeInTheDocument();
  expect(screen.getByText(/Service IDs: new/)).toBeInTheDocument();
  expect(JSON.stringify(schedule)).toBe(before);
  await user.click(screen.getByRole("button", { name: "View saved version" }));
  expect(viewSaved).toHaveBeenCalledWith("saved");
});
