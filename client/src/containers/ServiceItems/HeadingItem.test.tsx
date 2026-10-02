import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import HeadingItem from "./HeadingItem";
import type { ServiceItem } from "../../types";

const heading: ServiceItem = {
  name: "Worship",
  _id: "heading-1",
  type: "heading",
  listId: "list-heading-1",
};

const defaultProps = {
  item: heading,
  index: 0,
  selectedItemListId: "",
  insertPointIndex: -1,
  selectedListIds: new Set<string>(),
  isCollapsed: false,
  onToggleCollapse: jest.fn(),
  onItemClick: jest.fn(),
};

const renderWithDnd = (ui: ReactElement) =>
  render(
    <DndContext onDragEnd={() => {}}>
      <SortableContext
        items={[heading.listId]}
        strategy={verticalListSortingStrategy}
      >
        <ul>{ui}</ul>
      </SortableContext>
    </DndContext>
  );

describe("HeadingItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls onItemClick with listId when the row is clicked", () => {
    renderWithDnd(<HeadingItem {...defaultProps} />);
    const row = screen.getByRole("listitem");
    fireEvent.click(row);
    expect(defaultProps.onItemClick).toHaveBeenCalledWith(
      heading.listId,
      expect.any(Object)
    );
  });

  it("does not call onItemClick when collapse is clicked", () => {
    renderWithDnd(<HeadingItem {...defaultProps} />);
    fireEvent.click(screen.getByTitle(/collapse|expand/i));
    expect(defaultProps.onItemClick).not.toHaveBeenCalled();
    expect(defaultProps.onToggleCollapse).toHaveBeenCalled();
  });

  it("deletes the heading from its row without selecting it again", () => {
    const onDelete = jest.fn();
    renderWithDnd(
      <HeadingItem {...defaultProps} onDelete={onDelete} canMutateOutline />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete heading Worship" }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(defaultProps.onItemClick).not.toHaveBeenCalled();
  });

  it("hides the heading delete button when outline mutation is disabled", () => {
    renderWithDnd(
      <HeadingItem {...defaultProps} onDelete={jest.fn()} canMutateOutline={false} />,
    );

    expect(screen.queryByRole("button", { name: "Delete heading Worship" })).not.toBeInTheDocument();
  });

  it("exposes data-list-id for outline row targeting", () => {
    renderWithDnd(<HeadingItem {...defaultProps} />);
    expect(screen.getByRole("listitem")).toHaveAttribute(
      "data-list-id",
      heading.listId
    );
  });
});
