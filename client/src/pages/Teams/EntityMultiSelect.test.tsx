import { fireEvent, render, screen } from "@testing-library/react";
import EntityMultiSelect, {
  type EntityMultiSelectOption,
} from "./EntityMultiSelect";

const options: EntityMultiSelectOption[] = [
  { id: "p1", label: "Lead Coordinator", sublabel: "Coordinators", groupId: "t1" },
  { id: "p2", label: "Assistant Coordinator", sublabel: "Coordinators", groupId: "t1" },
  { id: "p3", label: "Producer", sublabel: "Media", groupId: "t2" },
  { id: "p4", label: "Director", sublabel: "Media", groupId: "t2" },
];

const groups = [
  { id: "t1", label: "Coordinators" },
  { id: "t2", label: "Media" },
];

const renderSelect = (value: string[] = []) => {
  const onChange = jest.fn();
  render(
    <EntityMultiSelect
      label="Positions"
      options={options}
      groups={groups}
      groupFilterLabel="Filter positions by team"
      allGroupsLabel="All teams"
      searchThreshold={2}
      value={value}
      onChange={onChange}
    />,
  );
  return { onChange };
};

const optionNames = () =>
  screen.getAllByRole("checkbox").map((option) => option.textContent);

describe("EntityMultiSelect team filter", () => {
  it("lists every option until a team chip is chosen", () => {
    renderSelect();
    expect(optionNames()).toEqual([
      "Lead CoordinatorCoordinators",
      "Assistant CoordinatorCoordinators",
      "ProducerMedia",
      "DirectorMedia",
    ]);
  });

  it("filters the list to the chosen team and back again", () => {
    renderSelect();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    expect(optionNames()).toEqual(["ProducerMedia", "DirectorMedia"]);

    fireEvent.click(screen.getByRole("button", { name: "All teams" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });

  it("keeps the search box scoped to the chosen team", () => {
    renderSelect();
    fireEvent.click(screen.getByRole("button", { name: "Coordinators" }));
    fireEvent.change(screen.getByPlaceholderText("Search positions…"), {
      target: { value: "coordinator" },
    });
    expect(optionNames()).toEqual([
      "Lead CoordinatorCoordinators",
      "Assistant CoordinatorCoordinators",
    ]);
  });

  it("hides the chips when there is only one team", () => {
    render(
      <EntityMultiSelect
        label="Positions"
        options={options.filter((option) => option.groupId === "t1")}
        groups={[groups[0]]}
        value={[]}
        onChange={jest.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "All teams" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Coordinators" }),
    ).not.toBeInTheDocument();
  });

  it("selects all within the chosen team without touching other teams", () => {
    const { onChange } = renderSelect(["p3"]);
    fireEvent.click(screen.getByRole("button", { name: "Coordinators" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(onChange).toHaveBeenCalledWith(["p3", "p1", "p2"]);
  });

  it("clears only the chosen team when all of its options are selected", () => {
    const { onChange } = renderSelect(["p1", "p2", "p3"]);
    fireEvent.click(screen.getByRole("button", { name: "Coordinators" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenCalledWith(["p3"]);
  });

  it("defaults to the union of all selected groups", () => {
    render(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t1", "t2"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );

    expect(optionNames()).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Selected teams" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "All teams" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("resolves an empty default group set to All teams", () => {
    render(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={[]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );

    expect(optionNames()).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Selected teams" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All teams" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("updates the default union when selected groups change", () => {
    const { rerender } = render(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t1"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );

    expect(optionNames()).toEqual([
      "Lead CoordinatorCoordinators",
      "Assistant CoordinatorCoordinators",
    ]);
    rerender(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t1", "t2"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );
    expect(optionNames()).toHaveLength(4);
    rerender(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={[]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );
    expect(optionNames()).toHaveLength(4);
    expect(screen.getByRole("button", { name: "All teams" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps an explicit All teams scope when defaults change", () => {
    const { rerender } = render(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t1"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "All teams" }));

    rerender(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t2"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );

    expect(optionNames()).toHaveLength(4);
    expect(screen.getByRole("button", { name: "All teams" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps an explicit team scope when defaults change", () => {
    const { rerender } = render(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t1"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Media" }));

    rerender(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t1", "t2"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );

    expect(optionNames()).toEqual(["ProducerMedia", "DirectorMedia"]);
    expect(screen.getByRole("button", { name: "Media" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("falls back to the default scope when an explicit group disappears", () => {
    const { rerender } = render(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t1"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    rerender(
      <EntityMultiSelect
        label="Positions"
        options={options.filter((option) => option.groupId === "t1")}
        groups={[groups[0]]}
        defaultGroupIds={["t1"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );

    expect(optionNames()).toEqual([
      "Lead CoordinatorCoordinators",
      "Assistant CoordinatorCoordinators",
    ]);
    expect(screen.getByRole("button", { name: "Selected teams" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("selects and clears only the default group set", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t1"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={["p3"]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(onChange).toHaveBeenLastCalledWith(["p3", "p1", "p2"]);
    onChange.mockClear();
    rerender(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t1"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        value={["p1", "p2", "p3"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenLastCalledWith(["p3"]);
  });

  it("searches inside the default scope and keeps selected archived options visible", () => {
    render(
      <EntityMultiSelect
        label="Positions"
        options={[
          ...options,
          { id: "p5", label: "Archived Vocal", groupId: "t1", archived: true },
          { id: "p6", label: "Archived Media", groupId: "t2", archived: true },
          { id: "p7", label: "Archived Backup Vocal", groupId: "t1", archived: true },
        ]}
        groups={groups}
        defaultGroupIds={["t1"]}
        defaultGroupsLabel="Selected teams"
        allGroupsLabel="All teams"
        searchThreshold={2}
        value={["p5"]}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /Archived Vocal/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Archived Vocal/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Archived Backup Vocal/ })).toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: /Archived Media/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search positions…"), {
      target: { value: "media" },
    });
    expect(screen.queryByRole("checkbox", { name: /Producer/ })).not.toBeInTheDocument();
  });
});
