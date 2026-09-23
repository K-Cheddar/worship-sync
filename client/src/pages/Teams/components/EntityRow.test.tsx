import { fireEvent, render, screen } from "@testing-library/react";
import EntityRow from "./EntityRow";

describe("EntityRow", () => {
  it("shows a top-end header badge when the row is not clickable", () => {
    render(
      <EntityRow
        title="Fall Volunteers"
        subtitle="Sep 1 – Sep 30"
        canEdit={false}
        headerBadge={<span>Open</span>}
        headerBadgePlacement="top-end"
      />,
    );

    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("opens from the card surface without hijacking nested actions", () => {
    const onTitleClick = jest.fn();
    const onDragHandle = jest.fn();

    render(
      <EntityRow
        title="Fall Volunteers"
        subtitle="Sep 1 – Sep 30"
        onTitleClick={onTitleClick}
        dragHandle={
          <button type="button" onClick={onDragHandle}>
            Drag handle
          </button>
        }
      />,
    );

    fireEvent.click(screen.getByTestId("entity-row"));
    expect(onTitleClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Drag handle" }));
    expect(onDragHandle).toHaveBeenCalledTimes(1);
    expect(onTitleClick).toHaveBeenCalledTimes(1);
  });
});
