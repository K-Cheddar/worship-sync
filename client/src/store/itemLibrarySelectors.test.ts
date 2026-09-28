import { selectUnifiedItemLibrary } from "./itemLibrarySelectors";
import type { RootState } from "./store";
import type { DBItem, ServiceItem } from "../types";

const item = (id: string, type: string, name = id): ServiceItem =>
  ({ _id: id, type, name, listId: id }) as ServiceItem;

const doc = (id: string, name = id): DBItem =>
  ({ _id: id, type: "song", name }) as DBItem;

describe("selectUnifiedItemLibrary", () => {
  it("combines the existing categories, restores songs from documents, and deduplicates IDs", () => {
    const state = {
      allItems: {
        list: [
          item("shared-song", "song", "Indexed Song"),
          item("custom", "free", "Custom"),
          item("timer", "timer", "Timer"),
          item("ignored", "bible", "Bible"),
        ],
        isAllItemsLoading: false,
      },
      allDocs: {
        allSongDocs: [
          doc("shared-song", "Document Song"),
          doc("recovered-song", "Recovered Song"),
        ],
        allFreeFormDocs: [],
        allTimerDocs: [],
        allBibleDocs: [],
      },
    } as unknown as RootState;

    expect(selectUnifiedItemLibrary(state).map(({ _id }) => _id)).toEqual([
      "custom",
      "shared-song",
      "recovered-song",
      "timer",
    ]);
    expect(
      selectUnifiedItemLibrary(state).find(({ _id }) => _id === "shared-song")
        ?.name,
    ).toBe("Indexed Song");
  });
});
