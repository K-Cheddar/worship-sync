import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import RangeSelector from "./RangeSelector";
import type { RangePreset } from "../rangeSelection";

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
  <RangeSelector
    preset="upcoming"
    range={{ start: "2026-09-29", end: "2026-10-31" }}
    onPresetChange={onPresetChange}
    onCustomRangeChange={jest.fn()}
  />,
);

describe("RangeSelector", () => {
  beforeEach(() => setDesktop(false));
  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
  });

  it("shows compact preset choices on narrow screens", async () => {
    const user = userEvent.setup();
    renderFilter();
    await user.click(screen.getByRole("button", { name: "Range preset: Upcoming" }));

    expect(screen.getByRole("button", { name: "Upcoming" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "This month" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "This month" }));
    expect(screen.queryByRole("button", { name: "Upcoming" })).not.toBeInTheDocument();
  });

  it("distinguishes the mobile preset button from the selected Custom range", async () => {
    const user = userEvent.setup();
    const ControlledFilter = () => {
      const [preset, setPreset] = useState<RangePreset>("upcoming");
      const [range, setRange] = useState({ start: "2026-09-29", end: "2026-10-31" });
      return (
        <RangeSelector
          preset={preset}
          range={range}
          onPresetChange={setPreset}
          onCustomRangeChange={({ startDate, endDate }) => setRange({ start: startDate, end: endDate })}
        />
      );
    };
    render(<ControlledFilter />);

    await user.click(screen.getByRole("button", { name: "Range preset: Upcoming" }));
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByRole("button", { name: "Range preset: Custom" })).toBeInTheDocument();
    const customRangeButton = screen.getByRole("button", {
      name: "Custom date range: Sep 29, 2026 – Oct 31, 2026",
    });
    expect(customRangeButton).toBeInTheDocument();

    await user.click(customRangeButton);
    expect(screen.getByRole("grid")).toBeInTheDocument();
    await user.click(screen.getByText("8", { selector: "button" }));
    await user.click(screen.getByText("12", { selector: "button" }));
    expect(screen.getByRole("button", {
      name: "Custom date range: Sep 8, 2026 – Sep 12, 2026",
    })).toBeInTheDocument();
  });

  it("shows the existing date range as the Custom picker trigger without a second input row", async () => {
    const user = userEvent.setup();
    setDesktop(true);
    const ControlledFilter = () => {
      const [preset, setPreset] = useState<RangePreset>("upcoming");
      const [range, setRange] = useState({ start: "2026-09-29", end: "2026-10-31" });
      return (
        <RangeSelector
          preset={preset}
          range={range}
          onPresetChange={setPreset}
          onCustomRangeChange={({ startDate, endDate }) => setRange({ start: startDate, end: endDate })}
        />
      );
    };
    render(<ControlledFilter />);

    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByRole("button", { name: "Custom date range: Sep 29, 2026 – Oct 31, 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Custom date range/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Custom date range: Sep 29, 2026 – Oct 31, 2026" }));
    expect(screen.getByRole("grid")).toBeInTheDocument();
    await user.click(screen.getByText("8", { selector: "button" }));
    await user.click(screen.getByText("12", { selector: "button" }));
    expect(screen.getByRole("button", { name: "Custom date range: Sep 8, 2026 – Sep 12, 2026" })).toHaveTextContent(
      "Sep 8, 2026 – Sep 12, 2026",
    );
  });

  it("marks shifted pages Custom and recalculates when Upcoming is selected again", async () => {
    const user = userEvent.setup();
    setDesktop(true);
    const ControlledFilter = () => {
      const [preset, setPreset] = useState<RangePreset>("upcoming");
      const [range, setRange] = useState({ start: "2026-10-01", end: "2026-10-31" });
      return (
        <RangeSelector
          preset={preset}
          range={range}
          onPresetChange={(nextPreset) => {
            setPreset(nextPreset);
            if (nextPreset === "upcoming") {
              setRange({ start: "2026-12-01", end: "2026-12-31" });
            }
          }}
          onCustomRangeChange={jest.fn()}
          onNavigate={() => {
            setPreset("custom");
            setRange({ start: "2026-09-01", end: "2026-09-30" });
          }}
        />
      );
    };
    render(<ControlledFilter />);

    expect(screen.getByRole("button", { name: "Upcoming" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Previous period" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next period" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous period" }));
    expect(screen.getByRole("button", { name: "Upcoming" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Sep 1, 2026 – Sep 30, 2026")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Upcoming" }));
    expect(screen.getByText("Dec 1, 2026 – Dec 31, 2026")).toBeInTheDocument();
  });

  it("keeps subtle paging available for fixed presets", () => {
    setDesktop(true);
    render(
      <RangeSelector
        preset="thisMonth"
        range={{ start: "2026-09-01", end: "2026-09-30" }}
        onPresetChange={jest.fn()}
        onCustomRangeChange={jest.fn()}
        onNavigate={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous period" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next period" })).toBeInTheDocument();
  });

  it("keeps the resolved date and status in one summary", () => {
    setDesktop(true);
    render(
      <RangeSelector
        preset="upcoming"
        range={{ start: "2026-09-30", end: "2026-10-31" }}
        summary="6 services · Staffing not started"
        onPresetChange={jest.fn()}
        onCustomRangeChange={jest.fn()}
      />,
    );

    expect(
      screen.getByText("Sep 30, 2026 – Oct 31, 2026 · 6 services · Staffing not started"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sep 1, 2026 – Oct 31, 2026")).not.toBeInTheDocument();
  });
});
