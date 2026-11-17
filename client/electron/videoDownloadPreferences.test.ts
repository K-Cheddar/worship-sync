import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VideoDownloadPreferencesStore } from "./videoDownloadPreferences";

describe("VideoDownloadPreferencesStore", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "worshipsync-video-preferences-"));
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));

  it("starts with both options off and persists selections per computer", async () => {
    const filePath = join(root, "preferences.json");
    const store = new VideoDownloadPreferencesStore(filePath);
    await expect(store.get()).resolves.toEqual({
      saveOutsideWorshipSync: false,
      uploadToCloud: false,
    });

    await store.update({
      saveOutsideWorshipSync: true,
      uploadToCloud: true,
      lastDirectory: join(root, "videos"),
    });

    const reopened = new VideoDownloadPreferencesStore(filePath);
    await expect(reopened.get()).resolves.toEqual({
      saveOutsideWorshipSync: true,
      uploadToCloud: true,
      lastDirectory: join(root, "videos"),
    });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      saveOutsideWorshipSync: true,
      uploadToCloud: true,
    });
  });

  it("updates one option without discarding other saved choices", async () => {
    const store = new VideoDownloadPreferencesStore(join(root, "preferences.json"));
    await store.update({
      saveOutsideWorshipSync: true,
      uploadToCloud: true,
      lastDirectory: join(root, "remembered-folder"),
    });
    await store.update({ uploadToCloud: false });

    await expect(store.get()).resolves.toEqual({
      saveOutsideWorshipSync: true,
      uploadToCloud: false,
      lastDirectory: join(root, "remembered-folder"),
    });
  });
});
