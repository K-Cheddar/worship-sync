import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import PeriodRangeFilter from "./PeriodRangeFilter";
import type { SchedulePeriodPreset } from "./schedulePeriodUtils";

const originalMatchMedia = window.matchMedia;
const setDesktop = (matches: boolean) => {
  window.matchMedia = jest.fn().mockImplementation((media: string) => ({
    matches,
    media,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
};

const renderFilter = (onPresetChange = jest.fn()) => render(
  <PeriodRangeFilter
    preset="upcoming"
    range={{ start: "2026-09-29", end: "2026-10-31" }}
    onPresetChange={onPresetChange}
    onCustomRangeChange={jest.fn()}
  />,
);

describe("PeriodRangeFilter", () => {
  beforeEach(() => setDesktop(false));
  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
  });

  it("shows compact preset choices on narrow screens", async () => {
    const user = userEvent.setup();
    renderFilter();
    await user.click(screen.getByRole("button", { name: "Date range" }));

    expect(screen.getByRole("button", { name: "Upcoming" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "This month" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "This month" }));
    expect(screen.queryByRole("button", { name: "Upcoming" })).not.toBeInTheDocument();
  });

  it("shows segmented preset buttons on desktop and keeps Custom date entry", async () => {
    const user = userEvent.setup();
    setDesktop(true);
    const ControlledFilter = () => {
      const [preset, setPreset] = useState<SchedulePeriodPreset>("upcoming");
      const [range, setRange] = useState({ start: "2026-09-29", end: "2026-10-31" });
      return (
        <PeriodRangeFilter
          preset={preset}
          range={range}
          onPresetChange={setPreset}
          onCustomRangeChange={({ startDate, endDate }) => setRange({ start: startDate, end: endDate })}
        />
      );
    };
    render(<ControlledFilter />);

    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByRole("textbox", { name: "Date range" })).toBeInTheDocument();
  });
});
