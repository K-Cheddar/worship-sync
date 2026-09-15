import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import ServiceItem from "./ServiceItem";
import type { ServiceItem as ServiceItemType } from "../../types";

jest.mock("../../hooks", () => ({
  useDispatch: () => jest.fn(),
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ media: { list: [] } }),
}));

jest.mock("../../hooks/useLiveRemainingSeconds", () => ({
  useLiveRemainingSeconds: () => undefined,
}));

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (url?: string) => url,
}));

jest.mock("../../context/activeController", () => ({
  useControllerBasePath: () => "/controller",
}));

const item: ServiceItemType = {
  name: "Welcome Slides",
  _id: "item-1",
  type: "free",
  listId: "list-item-1",
};

const defaultProps = {
  isActive: false,
  item,
  index: 0,
  selectedItemListId: "",
  insertPointIndex: -1,
  selectedListIds: new Set<string>(),
  initialItems: [item.listId],
  onItemClick: jest.fn(),
  canMutateOutline: true,
};

const renderWithProviders = (ui: ReactElement) =>
  render(
    <MemoryRouter>
      <DndContext onDragEnd={() => { }}>
        <SortableContext
          items={[item.listId]}
          strategy={verticalListSortingStrategy}
        >
          <ul>{ui}</ul>
        </SortableContext>
      </DndContext>
    </MemoryRouter>
  );

describe("ServiceItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a per-row delete button in edit mode", () => {
    renderWithProviders(<ServiceItem {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /delete welcome slides/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /welcome slides/i })).toBeInTheDocument();
  });

  it("does not render a per-row delete button in present mode", () => {
    renderWithProviders(
      <ServiceItem {...defaultProps} canMutateOutline={false} />
    );
    expect(
      screen.queryByRole("button", { name: /delete welcome slides/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /welcome slides/i })).toBeInTheDocument();
  });

  it("exposes data-list-id for outline row targeting", () => {
    renderWithProviders(<ServiceItem {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Welcome Slides" })).toHaveAttribute(
      "data-list-id",
      item.listId
    );
  });
});
