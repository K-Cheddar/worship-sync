import type { MediaType } from "../types";
import { commitCanvaMediaReplacement } from "./canvaMediaReplacement";
import type { CanvaMediaReplacementTransactionArgs } from "./canvaMediaReplacement";

const media = (overrides: Partial<MediaType> = {}) =>
  ({
    id: "media-1",
    name: "Welcome",
    folderId: "folder-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    path: "",
    format: "png",
    height: 1080,
    width: 1920,
    publicId: "old-public-id",
    type: "image",
    background: "https://cdn.example/old.png",
    thumbnail: "https://cdn.example/old-thumb.png",
    source: "cloudinary",
    ...overrides,
  }) as MediaType;

const createArgs = (overrides: Partial<Parameters<typeof commitCanvaMediaReplacement>[0]> = {}) => {
  const oldMedia = media();
  const newMedia = media({
    background: "https://cdn.example/new.png",
    thumbnail: "https://cdn.example/new-thumb.png",
    publicId: "new-public-id",
    updatedAt: "2026-01-03T00:00:00.000Z",
  });
  const events: string[] = [];
  const appliedLists: MediaType[][] = [];
  return {
    oldMedia,
    newMedia,
    currentList: [oldMedia],
    folders: [],
    replaceReferences: async (replacement: { oldMedia: MediaType; newMedia: MediaType }) => {
      events.push(
        replacement.oldMedia.publicId === oldMedia.publicId &&
          replacement.newMedia.publicId === newMedia.publicId
          ? "references"
          : "rollback-references",
      );
      return { ok: true, rollbackStatus: "not_needed" };
    },
    flushMedia: async () => {
      events.push("media");
      return { ok: true };
    },
    deleteProvider: async (row: MediaType) => {
      events.push(row.publicId === oldMedia.publicId ? "old-provider" : "new-provider");
      return true;
    },
    applyList: (list: MediaType[]) => appliedLists.push(list),
    applyLiveReferences: () => events.push("live"),
    onCleanupFailure: () => events.push("cleanup-retry"),
    events,
    appliedLists,
    ...overrides,
  } as CanvaMediaReplacementTransactionArgs & {
    events: string[];
    appliedLists: MediaType[][];
  };
};

test("persists references and Media before deleting the superseded image", async () => {
  const args = createArgs();

  await commitCanvaMediaReplacement(args);

  expect(args.events).toEqual(["references", "live", "media", "old-provider"]);
  expect(args.appliedLists[0][0]).toMatchObject({
    id: "media-1",
    background: "https://cdn.example/new.png",
    publicId: "new-public-id",
    name: "Welcome",
    folderId: "folder-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
});

test("does not delete the old provider when Media persistence fails", async () => {
  const args = createArgs({
    flushMedia: async () => {
      args.events.push("media");
      return { ok: false, error: new Error("pouch failure") };
    },
  });

  await expect(commitCanvaMediaReplacement(args)).rejects.toThrow(
    "Could not save the refreshed Canva media.",
  );
  expect(args.events).toEqual([
    "references",
    "live",
    "media",
    "rollback-references",
    "live",
    "new-provider",
  ]);
  expect(args.appliedLists.at(-1)).toEqual(args.currentList);
  expect(args.events).not.toContain("old-provider");
});

test("keeps a refreshed Mux rendition active when old-asset cleanup fails", async () => {
  const args = createArgs({
    oldMedia: media({
      type: "video",
      format: "m3u8",
      source: "mux",
      muxAssetId: "old-mux-asset",
      muxPlaybackId: "old-playback",
    }),
    newMedia: media({
      type: "video",
      format: "m3u8",
      source: "mux",
      muxAssetId: "new-mux-asset",
      muxPlaybackId: "new-playback",
      background: "https://stream.mux.com/new-playback.m3u8",
    }),
    deleteProvider: async (row: MediaType) => {
      args.events.push(row.muxAssetId === "old-mux-asset" ? "old-provider" : "new-provider");
      return row.muxAssetId !== "old-mux-asset";
    },
  });

  await commitCanvaMediaReplacement(args);

  expect(args.events).toContain("old-provider");
  expect(args.events).toContain("cleanup-retry");
  expect(args.appliedLists[0][0].muxAssetId).toBe("new-mux-asset");
});

test("cleans up the new provider when reference rollback succeeds", async () => {
  const args = createArgs({
    replaceReferences: async (replacement: { oldMedia: MediaType; newMedia: MediaType }) => {
      args.events.push(
        replacement.oldMedia.publicId === args.oldMedia.publicId
          ? "references"
          : "rollback-references",
      );
      return {
        ok: false,
        rollbackStatus: "complete",
        message: "reference conflict",
      };
    },
  });

  await expect(commitCanvaMediaReplacement(args)).rejects.toThrow(
    "reference conflict",
  );
  expect(args.events).toContain("new-provider");
  expect(args.events).not.toContain("old-provider");
});

test("retains the new provider when reference rollback is uncertain", async () => {
  const args = createArgs({
    replaceReferences: async () => ({
      ok: false,
      rollbackStatus: "uncertain" as const,
      message: "reference rollback failed",
    }),
  });

  await expect(commitCanvaMediaReplacement(args)).rejects.toThrow(
    "reconciliation is required",
  );
  expect(args.events).not.toContain("new-provider");
  expect(args.events).not.toContain("old-provider");
});

test("retains the new provider when reverse reference migration is uncertain", async () => {
  let callCount = 0;
  const args = createArgs({
    flushMedia: async () => ({ ok: false, error: new Error("pouch failure") }),
    replaceReferences: async (replacement: { oldMedia: MediaType; newMedia: MediaType }) => {
      callCount += 1;
      args.events.push(callCount === 1 ? "references" : "rollback-references");
      return callCount === 1
        ? { ok: true, rollbackStatus: "not_needed" as const }
        : {
            ok: false,
            rollbackStatus: "uncertain" as const,
            message: "reverse rollback failed",
          };
    },
  });

  await expect(commitCanvaMediaReplacement(args)).rejects.toThrow(
    "reconciliation is required",
  );
  expect(args.events).not.toContain("new-provider");
  expect(args.events).not.toContain("old-provider");
  expect(args.appliedLists.at(-1)).toEqual(args.currentList);
});
