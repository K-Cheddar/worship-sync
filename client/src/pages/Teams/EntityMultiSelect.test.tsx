import { fireEvent, render, screen } from "@testing-library/react";
import EntityMultiSelect, {
  type EntityMultiSelectOption,
} from "./EntityMultiSelect";

const options: EntityMultiSelectOption[] = [
  { id: "p1", label: "Lead Coordinator", sublabel: "Coordinators", groupId: "t1" },
  { id: "p2", label: "Assistant Coordinator", sublabel: "Coordinators", groupId: "t1" },
  { id: "p3", label: "Producer", sublabel: "Media", groupId: "t2" },
  { id: "p4", label: "Director", sublabel: "Media", groupId: "t2" },
  { id: "p5", label: "Singer", sublabel: "Worship Elements", groupId: "t3" },
];

const groups = [
  { id: "t1", label: "Coordinators" },
  { id: "t2", label: "Media" },
  { id: "t3", label: "Worship Elements" },
];

const renderSelect = ({
  value = [],
  defaultGroupIds = [],
  selectGroups = groups,
  selectOptions = options,
  onChange = jest.fn(),
}: {
  value?: string[];
  defaultGroupIds?: string[];
  selectGroups?: typeof groups;
  selectOptions?: EntityMultiSelectOption[];
  onChange?: jest.Mock;
} = {}) => {
  const view = render(
    <EntityMultiSelect
      label="Positions"
      options={selectOptions}
      groups={selectGroups}
      groupFilterLabel="Filter positions by team"
      allGroupsLabel="All teams"
      searchThreshold={2}
      value={value}
      onChange={onChange}
      defaultGroupIds={defaultGroupIds}
    />,
  );
  return { ...view, onChange };
};

const optionNames = () => screen.getAllByRole("checkbox").map((option) => option.textContent);
const filter = (name: string) => screen.getByRole("button", { name });
const expectPressed = (name: string, pressed: boolean) =>
  expect(filter(name)).toHaveAttribute("aria-pressed", String(pressed));

describe("EntityMultiSelect team filter", () => {
  it("defaults to All teams and shows all options when there are no default groups", () => {
    renderSelect();
    expectPressed("All teams", true);
    expect(optionNames()).toHaveLength(options.length);
  });

  it("shows the actual single default team chip as active", () => {
    renderSelect({ defaultGroupIds: ["t2"] });
    expectPressed("All teams", false);
    expectPressed("Media", true);
    expect(optionNames()).toEqual(["ProducerMedia", "DirectorMedia"]);
  });

  it("shows multiple default teams as active and displays their union without a synthetic chip", () => {
    renderSelect({ defaultGroupIds: ["t2", "t3"] });
    expectPressed("All teams", false);
    expectPressed("Media", true);
    expectPressed("Worship Elements", true);
    expect(optionNames()).toEqual(["ProducerMedia", "DirectorMedia", "SingerWorship Elements"]);
    expect(screen.queryByRole("button", { name: "Selected teams" })).not.toBeInTheDocument();
  });

  it("toggles a default team off into an explicit filter and can add another team", () => {
    renderSelect({ defaultGroupIds: ["t2", "t3"] });
    fireEvent.click(filter("Media"));
    expectPressed("Media", false);
    expectPressed("Worship Elements", true);
    expect(optionNames()).toEqual(["SingerWorship Elements"]);

    fireEvent.click(filter("Coordinators"));
    expectPressed("Coordinators", true);
    expectPressed("Worship Elements", true);
    expect(optionNames()).toEqual([
      "Lead CoordinatorCoordinators",
      "Assistant CoordinatorCoordinators",
      "SingerWorship Elements",
    ]);
  });

  it("clears explicit filters with All teams and lets a team narrow All teams", () => {
    renderSelect({ defaultGroupIds: ["t2"] });
    fireEvent.click(filter("All teams"));
    expectPressed("All teams", true);
    expect(groups.map(({ label }) => filter(label).getAttribute("aria-pressed"))).toEqual([
      "false", "false", "false",
    ]);
    expect(optionNames()).toHaveLength(options.length);

    fireEvent.click(filter("Worship Elements"));
    expectPressed("All teams", false);
    expectPressed("Worship Elements", true);
    expect(optionNames()).toEqual(["SingerWorship Elements"]);
  });

  it("treats removing the final explicit team as All teams while retaining the override", () => {
    const { rerender } = renderSelect({ defaultGroupIds: ["t2"] });
    fireEvent.click(filter("Media"));
    expectPressed("All teams", true);
    expect(optionNames()).toHaveLength(options.length);

    rerender(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t3"]}
        value={[]}
        onChange={jest.fn()}
        allGroupsLabel="All teams"
      />,
    );
    expectPressed("All teams", true);
    expect(optionNames()).toHaveLength(options.length);
  });

  it("reacts to default group changes until a filter is manually changed", () => {
    const { rerender } = renderSelect({ defaultGroupIds: ["t1"] });
    expect(optionNames()).toHaveLength(2);
    rerender(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t2", "t3"]}
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );
    expectPressed("Coordinators", false);
    expectPressed("Media", true);
    expectPressed("Worship Elements", true);
    expect(optionNames()).toHaveLength(3);
  });

  it("keeps manual multi-team filters when the default groups later change", () => {
    const { rerender } = renderSelect({ defaultGroupIds: ["t1", "t2"] });
    fireEvent.click(filter("Coordinators"));
    expect(optionNames()).toEqual(["ProducerMedia", "DirectorMedia"]);
    rerender(
      <EntityMultiSelect
        label="Positions"
        options={options}
        groups={groups}
        defaultGroupIds={["t3"]}
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );
    expectPressed("Coordinators", false);
    expectPressed("Media", true);
    expect(optionNames()).toEqual(["ProducerMedia", "DirectorMedia"]);
  });

  it("drops stale explicit groups and resumes the reactive default", () => {
    const { rerender } = renderSelect();
    fireEvent.click(filter("Media"));
    fireEvent.click(filter("Worship Elements"));
    rerender(
      <EntityMultiSelect
        label="Positions"
        options={options.filter((option) => option.groupId !== "t2" && option.groupId !== "t3")}
        groups={[groups[0]]}
        defaultGroupIds={["t1"]}
        allGroupsLabel="All teams"
        value={[]}
        onChange={jest.fn()}
      />,
    );
    expect(optionNames()).toEqual(["Lead CoordinatorCoordinators", "Assistant CoordinatorCoordinators"]);
  });

  it("keeps search scoped to the active multi-team union", () => {
    renderSelect({ defaultGroupIds: ["t2", "t3"] });
    fireEvent.change(screen.getByPlaceholderText("Search positions…"), {
      target: { value: "coordinator" },
    });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText("Search positions…"), {
      target: { value: "producer" },
    });
    expect(optionNames()).toEqual(["ProducerMedia"]);
  });

  it("selects all in the active multi-team union without changing hidden selections", () => {
    const { onChange } = renderSelect({ value: ["p1", "p5"], defaultGroupIds: ["t2", "t3"] });
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(onChange).toHaveBeenCalledWith(["p1", "p5", "p3", "p4"]);
  });

  it("clears only selected options in the active multi-team union", () => {
    const { onChange } = renderSelect({
      value: ["p1", "p3", "p4", "p5"],
      defaultGroupIds: ["t2", "t3"],
    });
    expect(screen.getByText("(4 selected)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenCalledWith(["p1"]);
  });

  it("keeps selected archived options enabled and unselected archived options disabled in scope", () => {
    renderSelect({
      selectOptions: [
        ...options,
        { id: "p6", label: "Archived Media", groupId: "t2", archived: true },
        { id: "p7", label: "Archived Worship", groupId: "t3", archived: true },
      ],
      defaultGroupIds: ["t2", "t3"],
      value: ["p6"],
    });
    expect(screen.getByRole("checkbox", { name: /Archived Media/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Archived Media/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Archived Worship/ })).toBeDisabled();
    expect(screen.getByText("(1 selected)")).toBeInTheDocument();
  });

  it("hides filter chips when only one position-owning team exists", () => {
    renderSelect({
      selectOptions: options.filter((option) => option.groupId === "t1"),
      selectGroups: [groups[0]],
    });
    expect(screen.queryByRole("button", { name: "All teams" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Coordinators" })).not.toBeInTheDocument();
  });
});
