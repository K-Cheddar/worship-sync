import type { RootState } from "./store";
import { selectControllerItem } from "./controllerItemSelection";
import { requestSelectedSlideNavigation } from "./slideNavigationSlice";
import { setSelectedSlide } from "./itemSlice";

describe("selectControllerItem slide navigation", () => {
  it("signals reveal intent when an external caller selects a slide on the active item", async () => {
    const state = {
      allDocs: { session: 1 },
      undoable: {
        present: {
          itemList: { selectedItemListId: "row-1" },
          item: { _id: "item-1", type: "free", listId: "row-1" },
        },
      },
    } as unknown as RootState;
    const dispatch = jest.fn();

    await selectControllerItem({ _id: "item-1", listId: "row-1" }, undefined, 2)(
      dispatch,
      () => state,
    );

    expect(dispatch).toHaveBeenCalledWith(setSelectedSlide(2));
    expect(dispatch).toHaveBeenCalledWith(requestSelectedSlideNavigation());
  });
});
