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
          onNavigate={() => {
            setPreset("custom");
            setRange({ start: "2026-09-01", end: "2026-09-30" });
          }}
        />
      );
    };
    render(<ControlledFilter />);

    await user.click(screen.getByRole("button", { name: "Range preset: Upcoming" }));
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByRole("button", { name: "Range preset: Custom" })).toBeInTheDocument();
    const customRangeInput = screen.getByRole("textbox", { name: "Custom date range" });
    expect(customRangeInput).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Range preset: Custom" })).toBeInTheDocument();

    await user.click(customRangeInput);
    expect(screen.getByRole("grid")).toBeInTheDocument();
    await user.click(screen.getByText("8", { selector: "button" }));
    await user.click(await screen.findByText("12", { selector: "button" }));
    expect(customRangeInput).toHaveValue("09/08/2026 – 09/12/2026");
  });

  it("keeps one compact editable range input between the paging arrows", async () => {
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
          onNavigate={() => {
            setPreset("custom");
            setRange({ start: "2026-09-01", end: "2026-09-30" });
          }}
        />
      );
    };
    render(<ControlledFilter />);

    await user.click(screen.getByRole("button", { name: "Custom" }));
    const customRangeInput = screen.getByRole("textbox", { name: "Custom date range" });
    const previous = screen.getByRole("button", { name: "Previous period" });
    const next = screen.getByRole("button", { name: "Next period" });
    expect(screen.getAllByRole("textbox", { name: "Custom date range" })).toHaveLength(1);
    expect(previous.compareDocumentPosition(customRangeInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(customRangeInput.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Date range" })).not.toBeInTheDocument();
    await user.click(customRangeInput);
    expect(await screen.findByRole("grid")).toBeInTheDocument();
  });

  it("supports segmented keyboard editing in the compact field", async () => {
    const user = userEvent.setup();
    setDesktop(true);
    const onCustomRangeChange = jest.fn();
    render(
      <RangeSelector
        preset="custom"
        range={{ start: "2026-09-29", end: "2026-10-31" }}
        onPresetChange={jest.fn()}
        onCustomRangeChange={onCustomRangeChange}
        onNavigate={jest.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Custom date range" });
    await user.click(input);
    await user.keyboard("{ArrowUp}");
    expect(onCustomRangeChange).toHaveBeenLastCalledWith({
      startDate: "2026-10-29",
      endDate: "2026-10-31",
    });
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
    expect(screen.getByRole("textbox", { name: "Custom date range" })).toHaveValue("09/01/2026 – 09/30/2026");

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
