import * as fs from "node:fs";
import * as os from "node:os";
import { Readable } from "node:stream";
import { join } from "node:path";
import {
  MEDIA_CACHE_MAX_URLS_PER_REQUEST,
  MediaCacheManager,
} from "./mediaCache";
import { safeHttpGet } from "./safeHttp";

const mockGetPath = jest.fn();

jest.mock("electron", () => ({
  app: {
    getPath: (...args: string[]) => mockGetPath(...args),
  },
}));

jest.mock("./safeHttp", () => ({
  safeHttpGet: jest.fn(),
}));

const safeHttpGetMock = jest.mocked(safeHttpGet);

type MockResponse = Readable & {
  statusCode?: number;
  headers: Record<string, string>;
};

const makeResponse = (
  chunks: string[],
  headers: Record<string, string> = {},
): MockResponse => {
  const response = Readable.from(chunks.map((chunk) => Buffer.from(chunk))) as MockResponse;
  response.statusCode = 200;
  response.headers = headers;
  return response;
};

describe("MediaCacheManager download limits", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(join(os.tmpdir(), "worship-sync-media-cache-download-"));
    mockGetPath.mockReturnValue(tempRoot);
    safeHttpGetMock.mockReset();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("rejects a response whose declared Content-Length is oversized before writing", async () => {
    const manager = new MediaCacheManager({ maxFileSizeBytes: 4 });
    const response = makeResponse(["12345"], { "content-length": "5" });
    safeHttpGetMock.mockResolvedValue({ response, url: "https://cdn.example.com/video.mp4" });

    await expect(manager.downloadMedia("https://cdn.example.com/video.mp4")).resolves.toBeNull();

    expect(response.destroyed).toBe(true);
    expect(manager.getAllCachedUrls()).toEqual([]);
    expect(fs.readdirSync(join(tempRoot, "media-cache"))).toEqual([]);
  });

  it("rejects an oversized streamed response when Content-Length is absent", async () => {
    const manager = new MediaCacheManager({ maxFileSizeBytes: 4 });
    const response = makeResponse(["12", "345"]);
    safeHttpGetMock.mockResolvedValue({ response, url: "https://cdn.example.com/video.mp4" });

    await expect(manager.downloadMedia("https://cdn.example.com/video.mp4")).resolves.toBeNull();

    expect(manager.getAllCachedUrls()).toEqual([]);
    expect(fs.readdirSync(join(tempRoot, "media-cache"))).toEqual([]);
  });

  it("cleans the partial file and never indexes an incomplete download", async () => {
    const manager = new MediaCacheManager({ maxFileSizeBytes: 4 });
    const response = makeResponse(["1234", "5"]);
    safeHttpGetMock.mockResolvedValue({ response, url: "https://cdn.example.com/video.mp4" });

    await expect(manager.downloadMedia("https://cdn.example.com/video.mp4")).resolves.toBeNull();

    const localPath = join(
      tempRoot,
      "media-cache",
      manager["getMediaFileName"]("https://cdn.example.com/video.mp4"),
    );
    expect(fs.existsSync(localPath)).toBe(false);
    expect(manager.getMediaCacheMap()).toEqual({});
  });

  it("still caches a normal media download at the configured limit", async () => {
    const manager = new MediaCacheManager({ maxFileSizeBytes: 4 });
    const response = makeResponse(["1234"], { "content-length": "4" });
    safeHttpGetMock.mockResolvedValue({ response, url: "https://cdn.example.com/video.mp4" });

    const localPath = await manager.downloadMedia("https://cdn.example.com/video.mp4");

    expect(localPath).not.toBeNull();
    expect(fs.readFileSync(localPath!, "utf8")).toBe("1234");
    expect(manager.getAllCachedUrls()).toEqual([
      "https://cdn.example.com/video.mp4",
    ]);
  });

  it("rejects an ensure request above the URL batch limit", async () => {
    const manager = new MediaCacheManager();
    const urls = Array.from(
      { length: MEDIA_CACHE_MAX_URLS_PER_REQUEST + 1 },
      (_, index) => `https://cdn.example.com/${index}.mp4`,
    );

    await expect(manager.ensureMediaCached(urls)).rejects.toThrow(
      `limited to ${MEDIA_CACHE_MAX_URLS_PER_REQUEST} URLs`,
    );
  });
});
