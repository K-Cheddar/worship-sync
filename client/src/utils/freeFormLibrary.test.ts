import type { DBItem, ServiceItem } from "../types";
import { reconcileFreeFormLibraryIndex } from "./freeFormLibrary";

const existingIndexItem: ServiceItem = {
  _id: "custom-existing",
  name: "Custom existing",
  type: "free",
  listId: "custom-existing",
  background: "existing-background",
};

const freeDoc = (overrides: Partial<DBItem> = {}): DBItem =>
  ({
    _id: "custom-1",
    name: "Welcome Slides",
    type: "free",
    background: "blue",
    slides: [{ id: "slide-1" }, { id: "slide-2" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  }) as DBItem;

describe("reconcileFreeFormLibraryIndex", () => {
  it("restores missing custom items without replacing existing index entries", () => {
    const current = [existingIndexItem];
    const recovered = reconcileFreeFormLibraryIndex(current, [freeDoc()]);

    expect(recovered).toEqual([
      existingIndexItem,
      expect.objectContaining({
        _id: "custom-1",
        name: "Welcome Slides",
        type: "free",
        background: "blue",
      }),
    ]);
    expect(reconcileFreeFormLibraryIndex(recovered, [freeDoc()])).toBe(recovered);
  });

  it("does not replace a newer row already in the library index", () => {
    const newerItem = { ...existingIndexItem, name: "Newer name" };

    expect(
      reconcileFreeFormLibraryIndex([newerItem], [
        freeDoc({ _id: newerItem._id, name: "Older name" }),
      ]),
    ).toEqual([newerItem]);
  });

  it("ignores invalid or non-custom durable documents", () => {
    const current: ServiceItem[] = [];

    expect(
      reconcileFreeFormLibraryIndex(current, [
        freeDoc({ _id: "missing-slides", slides: undefined }),
        freeDoc({ _id: "not-custom", type: "song" }),
        freeDoc({ _id: "missing-name", name: " " }),
      ]),
    ).toBe(current);
  });
});
