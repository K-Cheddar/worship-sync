import type { ServiceItem } from "../types";
import { reconcileOutlineItems } from "./outlineSync";

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
});
