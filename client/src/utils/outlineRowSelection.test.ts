import { getOutlineRowSelectionState } from "./outlineRowSelection";

describe("getOutlineRowSelectionState", () => {
  it("marks row selected when listId matches selectedItemListId and no multi-select", () => {
    const { isSelected, isInsertPoint } = getOutlineRowSelectionState(
      "a",
      0,
      new Set(),
      "a",
      0
    );
    expect(isSelected).toBe(true);
    expect(isInsertPoint).toBe(true);
  });

  it("prefers multi-select membership over single selection", () => {
    const { isSelected } = getOutlineRowSelectionState(
      "b",
      1,
      new Set(["b", "c"]),
      "a",
      0
    );
    expect(isSelected).toBe(true);
  });
});
