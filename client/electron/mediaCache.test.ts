import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { MediaCacheManager } from "./mediaCache";

const mockGetPath = jest.fn();

jest.mock("electron", () => ({
  app: {
    getPath: (...args: string[]) => mockGetPath(...args),
  },
}));

describe("MediaCacheManager cleanupUnusedMedia", () => {
  let tempRoot: string;

  beforeEach(() => {
    jest.restoreAllMocks();
    tempRoot = fs.mkdtempSync(join(os.tmpdir(), "worship-sync-media-cache-"));
    mockGetPath.mockReturnValue(tempRoot);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("keeps the cache entry when a file cannot be deleted yet", async () => {
    const manager = new MediaCacheManager();
    const localPath = join(tempRoot, "media-cache", "busy.mp4");
    fs.writeFileSync(localPath, "video");

    manager["cacheIndex"].set("https://cdn.example.com/busy.mp4", {
      url: "https://cdn.example.com/busy.mp4",
      localPath,
      lastUsed: Date.now(),
      contentType: "video/mp4",
    });

    manager["cleanupFile"] = jest.fn(() => false);

    await manager.cleanupUnusedMedia(new Set());

    expect(manager.getAllCachedUrls()).toEqual([
      "https://cdn.example.com/busy.mp4",
    ]);
  });
});
