import type { ServiceItem } from "../types";
import { getOutlineItemConflicts, reconcileOutlineItems } from "./outlineSync";

const row = (listId: string, name: string, type = "song"): ServiceItem => ({
  _id: `${listId}-doc`,
  listId,
  name,
  type,
});

describe("reconcileOutlineItems", () => {
  it("merges independent edits on different outline rows and retains occurrence IDs", () => {
    const baseline = [row("row-a", "A"), row("row-b", "B")];
    const local = [row("row-a", "A local"), baseline[1]];
    const remote = [baseline[0], row("row-b", "B remote")];

    expect(reconcileOutlineItems(baseline, local, remote)).toEqual({
      kind: "merged",
      items: [row("row-a", "A local"), row("row-b", "B remote")],
      remoteItems: remote,
    });
  });

  it("combines independent insertions using their surrounding row identities", () => {
    const baseline = [row("row-a", "A"), row("row-b", "B")];
    const local = [baseline[0], row("row-local", "Local"), baseline[1]];
    const remote = [baseline[0], row("row-remote", "Remote"), baseline[1]];
    const result = reconcileOutlineItems(baseline, local, remote);

    expect(result.kind).toBe("merged");
    expect(result.items.map((item) => item.listId)).toEqual([
      "row-a",
      "row-remote",
      "row-local",
      "row-b",
    ]);
  });

  it("preserves local and remote drafts when the same row field conflicts", () => {
    const baseline = [row("row-a", "A")];
    const local = [row("row-a", "Local")];
    const remote = [row("row-a", "Remote")];

    expect(reconcileOutlineItems(baseline, local, remote)).toEqual({
      kind: "conflict",
      items: local,
      remoteItems: remote,
    });
  });

  it("flags concurrent reorders and keeps the local sequence visible", () => {
    const baseline = [row("row-a", "A"), row("row-b", "B"), row("row-c", "C")];
    const local = [baseline[1], baseline[0], baseline[2]];
    const remote = [baseline[0], baseline[2], baseline[1]];
    const result = reconcileOutlineItems(baseline, local, remote);

    expect(result.kind).toBe("conflict");
    expect(result.items.map((item) => item.listId)).toEqual(["row-b", "row-a", "row-c"]);
    expect(result.remoteItems.map((item) => item.listId)).toEqual(["row-a", "row-c", "row-b"]);
  });

  it("merges a remote row edit with a local reorder", () => {
    const baseline = [row("row-a", "A"), row("row-b", "B")];
    const local = [baseline[1], baseline[0]];
    const remote = [baseline[0], row("row-b", "B remote")];
    const result = reconcileOutlineItems(baseline, local, remote);

    expect(result).toEqual({
      kind: "merged",
      items: [row("row-b", "B remote"), row("row-a", "A")],
      remoteItems: remote,
    });
  });

  it.each(["local", "remote"] as const)("keeps independent row fields, insertions and removals when choosing %s", (choice) => {
    const base = [row("a", "Welcome"), row("b", "Scripture"), row("c", "Prayer")];
    const left = [{ ...base[0], name: "Welcome A" }, { ...base[1], background: "new background" }];
    const right = [{ ...base[0], name: "Welcome B", background: "welcome background" }, base[1], base[2], row("d", "Closing Song")];
    const conflicts = getOutlineItemConflicts(base, left, right);
    expect(conflicts).toEqual([expect.objectContaining({ listId: "a", field: "name" })]);
    const result = reconcileOutlineItems(base, left, right, () => choice);
    expect(result.kind).toBe("merged");
    expect(result.items).toEqual([
      { ...base[0], name: choice === "local" ? "Welcome A" : "Welcome B", background: "welcome background" },
      { ...base[1], background: "new background" }, row("d", "Closing Song"),
    ]);
  });

  it.each(["local", "remote"] as const)("requires an explicit delete-versus-edit choice and honors %s", (choice) => {
    const base = [row("a", "Welcome"), row("b", "Scripture")];
    const local = [base[1], row("c", "Closing")];
    const remote = [{ ...base[0], name: "Edited welcome" }, base[1]];
    expect(reconcileOutlineItems(base, local, remote).kind).toBe("conflict");
    expect(getOutlineItemConflicts(base, local, remote)).toEqual([expect.objectContaining({ reason: "delete-edit", listId: "a" })]);
    const result = reconcileOutlineItems(base, local, remote, () => choice);
    expect(result.kind).toBe("merged");
    expect(result.items.some((item) => item.listId === "a")).toBe(choice === "remote");
    expect(result.items).toContainEqual(row("c", "Closing"));
  });

  it.each(["local", "remote"] as const)("requires an explicit reorder choice and keeps insertions for %s", (choice) => {
    const base = [row("a", "A"), row("b", "B"), row("c", "C")];
    const local = [base[1], base[0], base[2], row("d", "Closing")];
    const remote = [base[0], base[2], base[1], row("e", "Extra")];
    expect(reconcileOutlineItems(base, local, remote).kind).toBe("conflict");
    expect(getOutlineItemConflicts(base, local, remote)).toEqual([{ key: "order", reason: "order" }]);
    const result = reconcileOutlineItems(base, local, remote, () => choice);
    expect(result.kind).toBe("merged");
    expect(result.items.filter((item) => ["a", "b", "c"].includes(item.listId)))
      .toEqual((choice === "local" ? local : remote).slice(0, 3));
    expect(result.items).toEqual(expect.arrayContaining([row("d", "Closing"), row("e", "Extra")]));
  });
});
