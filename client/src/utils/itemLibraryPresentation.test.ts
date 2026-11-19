import type { DBItem, ServiceItem } from "../types";
import {
  formatItemAuditDate,
  getItemLibraryAuditDisplay,
  getItemLibrarySourceIndices,
  parseItemAuditDate,
  sortItemLibraryResults,
} from "./itemLibraryPresentation";

const item = (id: string, name: string, matchRank = 0): ServiceItem & { matchRank: number } => ({
  _id: id, name, type: "free", listId: id, matchRank,
});

describe("item library audit presentation and sorting", () => {
  it("preserves original row action indices after sorting, including duplicate IDs, in one pass", () => {
    const source = Array.from({ length: 20_000 }, (_, index) => ({
      _id: index === 20 ? "duplicate-id" : `item-${index}`,
      name: `Item ${String(20_000 - index).padStart(5, "0")}`,
    }));
    source[21] = { ...source[21], _id: "duplicate-id" };
    const sorted = [...source].sort((left, right) => left.name.localeCompare(right.name));
    const sourceWithoutLinearLookup = new Proxy(source, {
      get(target, property, receiver) {
        if (property === "indexOf") throw new Error("Repeated linear lookup is not allowed.");
        return Reflect.get(target, property, receiver);
      },
    });
    const indices = getItemLibrarySourceIndices(sourceWithoutLinearLookup);

    expect(indices.size).toBe(source.length);
    expect(indices.get(sorted[0])).toBe(source.length - 1);
    expect(indices.get(sorted[9])).toBe(source.length - 10);
    expect(indices.get(source[20])).toBe(20);
    expect(indices.get(source[21])).toBe(21);
  });
  it("formats valid dates locally and renders missing or invalid audit values with a dash", () => {
    const timestamp = "2026-11-18T02:30:00.000Z";
    expect(formatItemAuditDate(timestamp)).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(Date.parse(timestamp)),
    );
    expect(formatItemAuditDate("not a date")).toBe("—");
    expect(formatItemAuditDate("2026-02-31T00:00:00.000Z")).toBe("—");
    expect(parseItemAuditDate(1_795_000_000_000)).toBeNull();
    expect(getItemLibraryAuditDisplay(undefined)).toEqual({
      updatedAt: "—",
      updatedBy: "—",
    });
    expect(getItemLibraryAuditDisplay({
      _id: "legacy", name: "Legacy", type: "free", createdAt: "invalid", updatedAt: "", updatedBy: "  ",
    } as DBItem)).toEqual({ updatedAt: "—", updatedBy: "—" });
    expect(getItemLibraryAuditDisplay({
      _id: "legacy-unknown", name: "Legacy", type: "free", updatedAt: "2026-11-18", updatedBy: " Unknown ",
    } as DBItem)).toEqual({
      updatedAt: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(2026, 10, 18)),
      updatedBy: "—",
    });
  });

  it("sorts audit fields in either direction, keeps unknowns last, and breaks ties by name then ID", () => {
    const items = [item("id-z", "Same"), item("id-b", "Beta"), item("id-a", "Same"), item("id-c", "Alpha")];
    const docs = new Map<string, DBItem>([
      ["id-z", { _id: "id-z", name: "Same", type: "free", updatedAt: "invalid", createdAt: "2026-01-01", updatedBy: "unknown" } as DBItem],
      ["id-b", { _id: "id-b", name: "Beta", type: "free", updatedAt: "2026-03-01", createdAt: "2026-03-01", updatedBy: "Alex" } as DBItem],
      ["id-a", { _id: "id-a", name: "Same", type: "free", updatedAt: "2026-03-01", createdAt: "2026-02-01", updatedBy: "Alex" } as DBItem],
      ["id-c", { _id: "id-c", name: "Alpha", type: "free", updatedAt: "2026-01-01", createdAt: "invalid", updatedBy: "" } as DBItem],
    ]);

    expect(sortItemLibraryResults(items, docs, "updatedAt", "descending").map(({ _id }) => _id))
      .toEqual(["id-b", "id-a", "id-c", "id-z"]);
    expect(sortItemLibraryResults(items, docs, "createdAt", "ascending").map(({ _id }) => _id))
      .toEqual(["id-z", "id-a", "id-b", "id-c"]);
    expect(sortItemLibraryResults(items, docs, "updatedBy", "ascending").map(({ _id }) => _id))
      .toEqual(["id-b", "id-a", "id-c", "id-z"]);
    expect(sortItemLibraryResults(items, docs, "updatedBy", "descending").map(({ _id }) => _id))
      .toEqual(["id-b", "id-a", "id-c", "id-z"]);
    expect(sortItemLibraryResults(items, docs, "name", "ascending").map(({ _id }) => _id))
      .toEqual(["id-c", "id-b", "id-a", "id-z"]);
  });

  it("sorts by relevance and uses stable name/ID tie breakers", () => {
    const items = [item("b", "Zebra", 10), item("c", "Alpha", 10), item("a", "Alpha", 0)];
    expect(sortItemLibraryResults(items, new Map(), "relevance", "descending").map(({ _id }) => _id))
      .toEqual(["c", "b", "a"]);
  });

});
