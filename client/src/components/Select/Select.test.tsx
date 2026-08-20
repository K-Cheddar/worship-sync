import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Option } from "../../types";
import Select from "./Select";

const renderSelect = (options: React.ComponentProps<typeof Select>["options"]) =>
  render(
    <Select
      label="Open schedule"
      value="s-1"
      onChange={jest.fn()}
      options={options}
    />,
  );

describe("Select", () => {
  it("renders grouped options under a heading that labels them", async () => {
    const user = userEvent.setup();
    renderSelect([
      { label: "August 2026", value: "s-1", group: "Media" },
      { label: "September 2026", value: "s-2", group: "Media" },
      { label: "August 2026", value: "s-3", group: "Music" },
    ]);

    await user.click(screen.getByRole("combobox"));

    const media = within(await screen.findByRole("group", { name: "Media" }));
    expect(media.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "August 2026",
      "September 2026",
    ]);

    const music = within(screen.getByRole("group", { name: "Music" }));
    expect(music.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "August 2026",
    ]);
  });

  it("renders a flat list when no option carries a group", async () => {
    const user = userEvent.setup();
    renderSelect([
      { label: "August 2026", value: "s-1" },
      { label: "September 2026", value: "s-2" },
    ]);

    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByRole("option", { name: "August 2026" })).toBeInTheDocument();
    expect(screen.queryAllByRole("group")).toHaveLength(0);
  });

  // Radix rejects an empty-string item value, but "" is how callers spell
  // "no filter" (an "All teams" choice). Rendering it used to throw and take
  // the whole page down to its error boundary.
  it("renders an option whose value is empty as the current selection", async () => {
    const user = userEvent.setup();
    render(
      <Select
        label="Filter schedules by team"
        value=""
        onChange={jest.fn()}
        options={[
          { label: "All teams", value: "" },
          { label: "Media", value: "team-1" },
        ]}
      />,
    );

    expect(screen.getByRole("combobox")).toHaveTextContent("All teams");
    await user.click(screen.getByRole("combobox"));
    expect(
      await screen.findByRole("option", { name: "All teams" }),
    ).toBeInTheDocument();
  });

  it("reports an empty-valued option back to the caller as empty", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <Select
        label="Filter schedules by team"
        value="team-1"
        onChange={onChange}
        options={[
          { label: "All teams", value: "" },
          { label: "Media", value: "team-1" },
        ]}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "All teams" }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  // An async options list (e.g. saved plans still loading) starts empty, so
  // `value` cannot match anything yet — Radix must not be left uncontrolled
  // for that first render only to flip to controlled once options land, or
  // React logs "Select is changing from uncontrolled to controlled."
  it("stays controlled across an initial render with no matching option", () => {
    // Radix's useControllableState reports this via console.warn, not
    // console.error — easy to mis-spy on and get a false-positive pass.
    const consoleWarn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    try {
      const { rerender } = render(
        <Select
          label="Service plan"
          value="plan-2"
          onChange={jest.fn()}
          options={[] as Option[]}
        />,
      );
      rerender(
        <Select
          label="Service plan"
          value="plan-2"
          onChange={jest.fn()}
          options={[{ label: "Sunday plan", value: "plan-2" }]}
        />,
      );

      const warnedAboutControlledState = consoleWarn.mock.calls.some((call) =>
        String(call[0]).includes("changing from uncontrolled to controlled"),
      );
      expect(warnedAboutControlledState).toBe(false);
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("selects a grouped option by value", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <Select
        label="Open schedule"
        value="s-1"
        onChange={onChange}
        options={[
          { label: "August 2026", value: "s-1", group: "Media" },
          { label: "August 2026", value: "s-3", group: "Music" },
        ]}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    const music = within(await screen.findByRole("group", { name: "Music" }));
    await user.click(music.getByRole("option", { name: "August 2026" }));

    expect(onChange).toHaveBeenCalledWith("s-3");
  });
});
