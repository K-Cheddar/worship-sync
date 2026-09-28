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
    readPersistedMedia: async () => ({ list: [oldMedia], folders: [] }),
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

  expect(args.events).toEqual(["references", "media", "live", "old-provider"]);
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
  expect(args.events).toEqual(["references", "media", "rollback-references", "new-provider"]);
  expect(args.appliedLists.at(-1)).toEqual(args.currentList);
  expect(args.events).not.toContain("old-provider");
});

test("reverts references and keeps a newer Media revision when the target changes before commit", async () => {
  const args = createArgs({ canCommit: () => false });

  await expect(commitCanvaMediaReplacement(args)).rejects.toThrow(
    "Media changed while Canva was refreshing this page.",
  );
  expect(args.events).toEqual(["references", "rollback-references", "new-provider"]);
  expect(args.events).not.toContain("media");
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
  expect(args.events).not.toContain("live");
});

test("reconciles a Media write that committed despite a failed acknowledgement", async () => {
  const args = createArgs({
    flushMedia: async () => ({ ok: false, error: new Error("write acknowledgement lost") }),
    readPersistedMedia: async () => ({ list: [args.newMedia], folders: [] }),
  });

  await expect(commitCanvaMediaReplacement(args)).resolves.toBeUndefined();
  expect(args.events).toEqual([
    "references", "rollback-references", "references", "live", "old-provider",
  ]);
  expect(args.appliedLists.at(-1)).toEqual([args.newMedia]);
});

test("keeps both provider assets and preserves concurrent Media changes during rollback", async () => {
  const newerMedia = media({
    background: "https://cdn.example/newer.png",
    publicId: "newer-public-id",
    updatedAt: "2026-01-04T00:00:00.000Z",
  });
  const concurrentUpload = media({ id: "ordinary-upload", publicId: "upload-public-id" });
  let liveList: MediaType[] = [media()];
  const args = createArgs({
    applyList: (list: MediaType[]) => {
      args.appliedLists.push(list);
      liveList = list;
    },
    getCurrentList: () => liveList,
    flushMedia: async () => ({ ok: false, error: new Error("write conflict") }),
    replaceReferences: async (replacement: { oldMedia: MediaType; newMedia: MediaType }) => {
      args.events.push(replacement.oldMedia.publicId === args.oldMedia.publicId ? "references" : "rollback-references");
      return replacement.oldMedia.publicId === args.oldMedia.publicId
        ? { ok: true, rollbackStatus: "not_needed" as const }
        : { ok: false, rollbackStatus: "uncertain" as const, message: "rollback conflict" };
    },
    readPersistedMedia: async () => ({ list: [newerMedia, concurrentUpload], folders: [] }),
  });

  await expect(commitCanvaMediaReplacement(args)).rejects.toThrow("both provider assets were kept");

  expect(args.appliedLists.at(-1)).toEqual([newerMedia, concurrentUpload]);
  expect(args.events).not.toContain("old-provider");
  expect(args.events).not.toContain("new-provider");
  expect(args.events).not.toContain("live");
});

test("does not delete either asset when a newer Media revision lands during persistence", async () => {
  const newerMedia = media({
    background: "https://cdn.example/newer.png",
    publicId: "newer-public-id",
    updatedAt: "2026-01-04T00:00:00.000Z",
  });
  const ordinaryUpload = media({ id: "ordinary-upload", publicId: "upload-public-id" });
  let liveList: MediaType[] = [media()];
  const args = createArgs({
    applyList: (list: MediaType[]) => {
      args.appliedLists.push(list);
      liveList = list;
    },
    getCurrentList: () => liveList,
    flushMedia: async () => {
      liveList = [newerMedia, ordinaryUpload];
      return { ok: true };
    },
  });

  await expect(commitCanvaMediaReplacement(args)).rejects.toThrow("Both provider assets were kept");
  expect(liveList).toEqual([newerMedia, ordinaryUpload]);
  expect(args.events).not.toContain("old-provider");
  expect(args.events).not.toContain("new-provider");
});
