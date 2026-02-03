import { sortNamesInList, sortList } from "./sort";

describe("sort", () => {
  describe("sortNamesInList", () => {
    it("returns same value when list is null or undefined", () => {
      expect(sortNamesInList(undefined as any)).toBeUndefined();
      expect(sortNamesInList(null as any)).toBeNull();
    });

    it("returns new array sorted by name (case-insensitive)", () => {
      const list = [
        { name: "Charlie", id: 1 },
        { name: "alpha", id: 2 },
        { name: "Beta", id: 3 },
      ];
      const result = sortNamesInList(list);
      expect(result).not.toBe(list);
      expect(result).toEqual([
        { name: "alpha", id: 2 },
        { name: "Beta", id: 3 },
        { name: "Charlie", id: 1 },
      ]);
    });

    it("sorts numerically when names contain numbers", () => {
      const list = [
        { name: "Item 10" },
        { name: "Item 2" },
        { name: "Item 1" },
      ];
      const result = sortNamesInList(list);
      expect(result[0].name).toBe("Item 1");
      expect(result[1].name).toBe("Item 2");
      expect(result[2].name).toBe("Item 10");
    });

    it("does not mutate original array", () => {
      const list = [{ name: "B" }, { name: "A" }];
      sortNamesInList(list);
      expect(list[0].name).toBe("B");
    });
  });

  describe("sortList", () => {
    it("returns new array of strings sorted", () => {
      const list = ["Charlie", "alpha", "Beta"];
      const result = sortList(list);
      expect(result).not.toBe(list);
      expect(result).toEqual(["alpha", "Beta", "Charlie"]);
    });

    it("sorts numerically", () => {
      const list = ["Item 10", "Item 2", "Item 1"];
      const result = sortList(list);
      expect(result).toEqual(["Item 1", "Item 2", "Item 10"]);
    });

    it("returns list when sort throws (e.g. invalid items)", () => {
      const list = [{ toUpperCase: undefined }, "b"] as any;
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = sortList(list);
      expect(result).toEqual(list);
      consoleSpy.mockRestore();
    });
  });
});
