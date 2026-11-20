import type { ServiceItem } from "../types";
import { Cloudinary } from "@cloudinary/url-gen";
import { createOutlineMoveIntent, getOutlineItemConflicts, outlineBackgroundsEqual, reconcileOutlineItems } from "./outlineSync";
import { formatItemList } from "./formatItemList";
import { CLOUDINARY_CLOUD_NAME } from "./cloudinaryConfig";

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

  it("treats the generated Cloudinary display URL and its stored ID as the same background", () => {
    const baseline = [
      { ...row("row-a", "Video"), type: "video", background: "media/sermon-thumbnail" },
      row("row-b", "Song"),
    ];
    const formattedBaseline = formatItemList(
      baseline,
      new Cloudinary({ cloud: { cloudName: CLOUDINARY_CLOUD_NAME } }),
    );
    const local = [formattedBaseline[1]];
    const remote = JSON.parse(JSON.stringify(baseline)) as ServiceItem[];

    const result = reconcileOutlineItems(formattedBaseline, local, remote);

    expect(formattedBaseline[0].background).not.toBe(baseline[0].background);
    expect(result).toEqual({ kind: "merged", items: [remote[1]], remoteItems: remote });
  });

  it("keeps matching public IDs from other Cloudinary accounts distinct", () => {
    const baseline = [{ ...row("row-a", "Video"), type: "video", background: "media/sermon-thumbnail" }];
    const formattedBaseline = formatItemList(
      baseline,
      new Cloudinary({ cloud: { cloudName: CLOUDINARY_CLOUD_NAME } }),
    );
    const generated = formattedBaseline[0].background as string;
    const otherAccount = generated.replace(
      `/res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/`,
      "/res.cloudinary.com/another-account/",
    );
    const remote = [{ ...baseline[0], background: otherAccount }];

    expect(outlineBackgroundsEqual("media/sermon-thumbnail", generated)).toBe(true);
    expect(outlineBackgroundsEqual("media/sermon-thumbnail", otherAccount)).toBe(false);
    expect(reconcileOutlineItems(formattedBaseline, [], remote).kind).toBe("conflict");
  });

  it("treats missing optional JSON values as persisted equivalents without ignoring media fields", () => {
    const localVideoFile = {
      id: "local-video",
      ownerDeviceId: "device-a",
      ownerLabel: "Controller A",
      fileName: "sermon.mp4",
      contentType: "video/mp4",
      storagePolicy: "local-only" as const,
      contentRevision: "revision-1",
    };
    const baseline = [{
      ...row("row-a", "Local video"),
      type: "video",
      background: "media/sermon-thumbnail",
      localVideoFile: { ...localVideoFile, cloudUrl: undefined },
    }];
    const formattedBaseline = formatItemList(
      baseline,
      new Cloudinary({ cloud: { cloudName: CLOUDINARY_CLOUD_NAME } }),
    );
    const local: ServiceItem[] = [];
    const remote = JSON.parse(JSON.stringify(baseline)) as ServiceItem[];
    const result = reconcileOutlineItems(formattedBaseline, local, remote);

    expect(result.kind).toBe("merged");
    expect(result.items).toEqual([]);

    const editedRemote = [{
      ...remote[0],
      localVideoFile: { ...localVideoFile, contentRevision: "revision-2" },
    }];
    expect(reconcileOutlineItems(formattedBaseline, local, editedRemote).kind).toBe("conflict");
  });

  it("keeps a meaningful remote background edit in delete-edit review", () => {
    const baseline = [{ ...row("row-a", "Video"), type: "video", background: "media/old-thumbnail" }];
    const formattedBaseline = formatItemList(
      baseline,
      new Cloudinary({ cloud: { cloudName: CLOUDINARY_CLOUD_NAME } }),
    );
    const remote = [{ ...baseline[0], background: "media/new-thumbnail" }];

    expect(reconcileOutlineItems(formattedBaseline, [], remote).kind).toBe("conflict");
    expect(getOutlineItemConflicts(formattedBaseline, [], remote)).toEqual([
      expect.objectContaining({ reason: "delete-edit", listId: "row-a" }),
    ]);

    const transformedRemote = [{
      ...baseline[0],
      background: "https://res.cloudinary.com/portable-media/image/upload/c_fill/v1/media/old-thumbnail",
    }];
    expect(reconcileOutlineItems(formattedBaseline, [], transformedRemote).kind).toBe("conflict");
  });

  it("merges edits to separate fields on the same row", () => {
    const baseline = [{ ...row("row-a", "Video"), background: "old-background" }];
    const local = [{ ...baseline[0], name: "Local title" }];
    const remote = [{ ...baseline[0], background: "remote-background" }];

    expect(reconcileOutlineItems(baseline, local, remote)).toEqual({
      kind: "merged",
      items: [{ ...baseline[0], name: "Local title", background: "remote-background" }],
      remoteItems: remote,
    });
  });

  it("merges a same-field edit when both controllers choose the same value", () => {
    const baseline = [row("row-a", "Base")];
    const local = [{ ...baseline[0], name: "Shared edit" }];
    const remote = [{ ...baseline[0], name: "Shared edit" }];

    expect(reconcileOutlineItems(baseline, local, remote)).toEqual({
      kind: "merged", items: remote, remoteItems: remote,
    });
  });

  it("merges deletion of the same unchanged row from both controllers", () => {
    const baseline = [row("row-a", "A"), row("row-b", "B")];
    const local = [baseline[1]];
    const remote = [baseline[1]];

    expect(reconcileOutlineItems(baseline, local, remote)).toEqual({
      kind: "merged", items: local, remoteItems: remote,
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

  it("merges independent row moves instead of comparing complete sequences", () => {
    const base = ["a", "b", "c", "d", "e"].map(id => row(id, id.toUpperCase()));
    const local = [base[1], base[0], base[2], base[3], base[4]];
    const remote = [base[0], base[1], base[2], base[4], base[3]];

    const result = reconcileOutlineItems(base, local, remote);

    expect(result.kind).toBe("merged");
    expect(result.items.map(item => item.listId)).toEqual(["b", "a", "c", "e", "d"]);
  });

  it("rebases a recorded local destination over an independent saved move", () => {
    const base = ["a", "b", "c", "d", "e"].map(id => row(id, id.toUpperCase()));
    const local = [base[1], base[0], base[2], base[3], base[4]];
    const remote = [base[0], base[1], base[2], base[4], base[3]];
    const intent = createOutlineMoveIntent({ outlineId: "outline", ownerKey: "owner",
      resultingItems: local, movedIds: ["b"] })!;

    expect(reconcileOutlineItems(base, local, remote, undefined, [intent]).items.map(item => item.listId))
      .toEqual(["b", "a", "c", "e", "d"]);
  });

  it("does not resurrect a locally deleted row as a move anchor", () => {
    const base = ["a", "b", "c", "d"].map(id => row(id, id.toUpperCase()));
    const local = [base[2], base[0], base[3]];
    const intent = createOutlineMoveIntent({ outlineId: "outline", ownerKey: "owner",
      resultingItems: local, movedIds: ["c"] })!;

    const result = reconcileOutlineItems(base, local, base, undefined, [intent]);

    expect(result.kind).toBe("merged");
    expect(result.items.map(item => item.listId)).toEqual(["c", "a", "d"]);
  });

  it("keeps remote additions while excluding locally deleted move anchors", () => {
    const base = ["a", "b", "c", "d", "e"].map(id => row(id, id.toUpperCase()));
    const added = row("remote", "Remote addition");
    const remote = [base[0], base[1], added, base[2], base[3], base[4]];
    const local = [base[4], base[0], base[2]];
    const intent = createOutlineMoveIntent({ outlineId: "outline", ownerKey: "owner",
      resultingItems: local, movedIds: ["e"] })!;

    const result = reconcileOutlineItems(base, local, remote, undefined, [intent]);

    expect(result.kind).toBe("merged");
    expect(result.items.map(item => item.listId)).toEqual(["e", "a", "remote", "c"]);
    expect(result.items.map(item => item.listId)).not.toContain("b");
  });

  it("combines multiple local deletions and a survivor reorder", () => {
    const base = ["a", "b", "c", "d", "e", "f"].map(id => row(id, id.toUpperCase()));
    const local = [base[4], base[0], base[2]];
    const intent = createOutlineMoveIntent({ outlineId: "outline", ownerKey: "owner",
      resultingItems: local, movedIds: ["e"] })!;

    const result = reconcileOutlineItems(base, local, base, undefined, [intent]);

    expect(result.kind).toBe("merged");
    expect(result.items.map(item => item.listId)).toEqual(["e", "a", "c"]);
  });

  it("asks for an order choice when a legacy multi-row reorder has no safe move inference", () => {
    const base = ["a", "b", "c", "d", "e"].map(id => row(id, id.toUpperCase()));
    const local = [base[2], base[3], base[0], base[1], base[4]];
    const remote = [base[0], base[4], base[1], base[2], base[3]];
    const conflicts = getOutlineItemConflicts(base, local, remote);
    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "order", orderAmbiguous: true }),
    ]));
  });

  it("treats an already-satisfied move destination as idempotent", () => {
    const base = ["a", "b", "c", "d"].map(id => row(id, id.toUpperCase()));
    const moved = [base[0], base[2], base[1], base[3]];

    const result = reconcileOutlineItems(base, moved, moved);

    expect(result.kind).toBe("merged");
    expect(result.items.map(item => item.listId)).toEqual(["a", "c", "b", "d"]);
  });

  it("flags an incompatible destination for the same moved row", () => {
    const base = ["a", "b", "c", "d"].map(id => row(id, id.toUpperCase()));
    const local = [base[1], base[0], base[2], base[3]];
    const remote = [base[0], base[2], base[3], base[1]];

    expect(reconcileOutlineItems(base, local, remote).kind).toBe("conflict");
    expect(getOutlineItemConflicts(base, local, remote)).toEqual([
      expect.objectContaining({ key: "order", reason: "order", movedIds: expect.arrayContaining(["a", "b", "c", "d"]) }),
    ]);
  });

  it("keeps a multi-row drag together while rebasing an independent remote move", () => {
    const base = ["a", "b", "c", "d", "e"].map(id => row(id, id.toUpperCase()));
    const local = [base[0], base[3], base[4], base[1], base[2]];
    const remote = [base[1], base[0], base[2], base[3], base[4]];
    const intent = createOutlineMoveIntent({ outlineId: "outline", ownerKey: "owner",
      resultingItems: local, movedIds: ["d", "e"] })!;

    const result = reconcileOutlineItems(base, local, remote, undefined, [intent]);

    expect(result.kind).toBe("merged");
    expect(result.items.map(item => item.listId)).toEqual(["d", "e", "b", "a", "c"]);
    expect(result.items.slice(0, 2).map(item => item.listId)).toEqual(["d", "e"]);
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

  it.each(["local", "remote"] as const)("protects a moved row from a concurrent deletion and honors %s", (choice) => {
    const base = ["a", "b", "c", "d"].map(id => row(id, id.toUpperCase()));
    const local = [base[1], base[0], base[2], base[3]];
    const remote = [base[0], base[2], base[3]];
    const intent = createOutlineMoveIntent({ outlineId: "outline", ownerKey: "owner",
      resultingItems: local, movedIds: ["b"] })!;
    const conflicts = getOutlineItemConflicts(base, local, remote, [intent]);

    expect(conflicts).toEqual([expect.objectContaining({
      reason: "delete-edit", listId: "b", movedIds: ["b"], localDestination: intent,
    })]);
    const result = reconcileOutlineItems(base, local, remote, () => choice, [intent]);
    expect(result.kind).toBe("merged");
    expect(result.items.some(item => item.listId === "b")).toBe(choice === "local");
  });

  it("reviews the latest destination when one row is moved more than once", () => {
    const base = ["a", "b", "c", "d"].map(id => row(id, id.toUpperCase()));
    const firstMove = [base[1], base[0], base[2], base[3]];
    const latestMove = [base[0], base[2], base[3], base[1]];
    const intents = [firstMove, latestMove].map(resultingItems => createOutlineMoveIntent({
      outlineId: "outline", ownerKey: "owner", resultingItems, movedIds: ["b"],
    })!);
    const conflicts = getOutlineItemConflicts(base, latestMove, [base[0], base[2], base[3]], intents);

    expect(conflicts).toEqual([expect.objectContaining({ localDestination: intents[1] })]);
    const result = reconcileOutlineItems(base, latestMove, [base[0], base[2], base[3]],
      () => "local", intents);
    expect(result.items.map(item => item.listId)).toEqual(["a", "c", "d", "b"]);
  });

  it.each(["local", "remote"] as const)("protects a uniquely inferred saved move from a local deletion and honors %s", (choice) => {
    const base = ["a", "b", "c", "d", "e"].map(id => row(id, id.toUpperCase()));
    const local = [base[0], base[1], base[3], base[4]];
    const remote = [base[2], base[0], base[1], base[3], base[4]];
    const conflicts = getOutlineItemConflicts(base, local, remote);

    expect(conflicts).toEqual([expect.objectContaining({
      reason: "delete-edit", listId: "c", movedIds: ["c"], remoteMoved: true,
    })]);
    const result = reconcileOutlineItems(base, local, remote, () => choice);
    expect(result.kind).toBe("merged");
    expect(result.items.some(item => item.listId === "c")).toBe(choice === "remote");
  });

  it("combines independent deletion and saved move when the moved row is unambiguous", () => {
    const base = ["a", "b", "c", "d", "e"].map(id => row(id, id.toUpperCase()));
    const local = [base[0], base[1], base[2], base[4]];
    const remote = [base[1], base[0], base[2], base[3], base[4]];

    const result = reconcileOutlineItems(base, local, remote);

    expect(result.kind).toBe("merged");
    expect(result.items.map(item => item.listId)).toEqual(["b", "a", "c", "e"]);
  });

  it.each(["local", "remote"] as const)("requires an explicit reorder choice and keeps insertions for %s", (choice) => {
    const base = [row("a", "A"), row("b", "B"), row("c", "C")];
    const local = [base[1], base[0], base[2], row("d", "Closing")];
    const remote = [base[0], base[2], base[1], row("e", "Extra")];
    expect(reconcileOutlineItems(base, local, remote).kind).toBe("conflict");
    expect(getOutlineItemConflicts(base, local, remote)).toEqual([
      expect.objectContaining({ key: "order", reason: "order", movedIds: expect.any(Array) }),
    ]);
    const result = reconcileOutlineItems(base, local, remote, () => choice);
    expect(result.kind).toBe("merged");
    expect(result.items.filter((item) => ["a", "b", "c"].includes(item.listId)))
      .toEqual((choice === "local" ? local : remote).slice(0, 3));
    expect(result.items).toEqual(expect.arrayContaining([row("d", "Closing"), row("e", "Extra")]));
  });
});
