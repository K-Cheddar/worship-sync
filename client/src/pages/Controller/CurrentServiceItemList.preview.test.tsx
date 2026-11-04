import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import CurrentServiceItemList from "./CurrentServiceItemList";

jest.mock("../../utils/formatItemList", () => ({
  formatItemList: (items: unknown[]) => items,
}));

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: () => undefined,
}));

const makeItem = (index: number) => ({
  listId: `active-row-${index}`,
  _id: `active-item-${index}`,
  name: `Active item ${index}`,
  type: "song",
});

it("renders the active 20-item Presentation outline in the Workspace preview", async () => {
  const itemListsDoc = {
    _id: "ItemLists",
    itemLists: [
      { _id: "active-list", name: "Active", controllerScope: "presentation" },
      { _id: "saved-list", name: "Saved", controllerScope: "presentation" },
      { _id: "aux-list", name: "Aux", controllerScope: "aux-a" },
    ],
    activeList: { _id: "active-list", name: "Active" },
    selectedIdByScope: {
      presentation: "saved-list",
      "aux-a": "aux-list",
    },
  };
  const db = {
    get: jest.fn(async (id: string) =>
      id === "ItemLists"
        ? itemListsDoc
        : {
            _id: id,
            items:
              id === "active-list"
                ? Array.from({ length: 20 }, (_, index) => makeItem(index + 1))
                : [
                    { ...makeItem(1), listId: "saved-row-1", name: "Saved item 1" },
                    { ...makeItem(2), listId: "saved-row-2", name: "Saved item 2" },
                  ],
          },
    ),
    put: jest.fn(),
  };

  render(
    <ControllerInfoContext.Provider
      value={{
        db,
        cloud: {} as never,
        updater: new EventTarget(),
        bootstrapReady: true,
      } as never}
    >
      <CurrentServiceItemList activeListId="active-row-20" />
    </ControllerInfoContext.Provider>,
  );

  await waitFor(() =>
    expect(screen.getAllByRole("listitem")).toHaveLength(20),
  );
  expect(screen.getByText("Active item 1")).toBeInTheDocument();
  expect(screen.getByText("Active item 20")).toBeInTheDocument();
  expect(screen.queryByText("Saved item 1")).not.toBeInTheDocument();
  expect(db.get).not.toHaveBeenCalledWith("saved-list");
  expect(db.put).not.toHaveBeenCalled();
  expect(within(screen.getAllByRole("listitem")[19]).getByText("Live"))
    .toBeInTheDocument();
});
