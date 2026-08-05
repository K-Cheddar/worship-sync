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
});
