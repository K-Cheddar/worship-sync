import { render, screen } from "@testing-library/react";
import ScheduleStaffingSummary from "./ScheduleStaffingSummary";

describe("ScheduleStaffingSummary", () => {
  it("shows services, filled and open positions, and compact progress", () => {
    render(<ScheduleStaffingSummary serviceCount={6} filled={56} required={57} staffingStarted />);

    const summary = screen.getByRole("status", { name: "Schedule staffing summary" });
    expect(summary).toHaveTextContent("6Services");
    expect(summary).toHaveTextContent("56 / 57Positions filled");
    expect(summary).toHaveTextContent("1Position open");
    expect(screen.getByRole("progressbar", { name: "Staffing completion" })).toHaveAttribute("aria-valuenow", "56");
    expect(screen.getByRole("progressbar", { name: "Staffing completion" })).toHaveAttribute("aria-valuemax", "57");
    expect(summary).toHaveClass("grid-cols-2", "min-w-0", "sm:flex", "sm:flex-wrap");
  });

  it("shows a completed state when every required position is filled", () => {
    render(<ScheduleStaffingSummary serviceCount={1} filled={2} required={2} staffingStarted />);

    expect(screen.getByRole("status", { name: "Schedule staffing summary" })).toHaveTextContent("0Positions open");
    expect(screen.getByRole("progressbar", { name: "Staffing completion" })).toHaveAttribute("aria-valuetext", "2 of 2 positions filled");
    expect(screen.getByText("0")).toHaveClass("text-emerald-300");
  });

  it("does not present an unpersisted preview as zero saved assignments", () => {
    render(<ScheduleStaffingSummary serviceCount={2} filled={0} required={5} staffingStarted={false} />);

    const summary = screen.getByRole("status", { name: "Schedule staffing summary" });
    expect(summary).toHaveTextContent("Staffing not started");
    expect(summary).toHaveTextContent("—Staffing not started");
    expect(summary).toHaveTextContent("—Positions open");
    expect(screen.queryByTestId("open-position-icon")).not.toBeInTheDocument();
    expect(screen.queryByTestId("completed-staffing-icon")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("replaces every total when the selected schedule changes", () => {
    const { rerender } = render(
      <ScheduleStaffingSummary serviceCount={6} filled={4} required={6} staffingStarted />,
    );
    rerender(<ScheduleStaffingSummary serviceCount={2} filled={2} required={2} staffingStarted />);

    const summary = screen.getByRole("status", { name: "Schedule staffing summary" });
    expect(summary).toHaveTextContent(/2\s*Services/);
    expect(summary).toHaveTextContent("2 / 2");
    expect(summary).toHaveTextContent("0Positions open");
    expect(summary).not.toHaveTextContent("6");
  });

  it("avoids 0 / 0 progress when there are no positions or visible services", () => {
    const { rerender } = render(<ScheduleStaffingSummary serviceCount={1} filled={0} required={0} staffingStarted />);
    expect(screen.getByRole("status", { name: "Schedule staffing summary" })).toHaveTextContent("No positions required");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();

    rerender(<ScheduleStaffingSummary serviceCount={0} filled={0} required={0} staffingStarted />);
    expect(screen.queryByRole("status", { name: "Schedule staffing summary" })).not.toBeInTheDocument();
  });
});
