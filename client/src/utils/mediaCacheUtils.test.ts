import {
  extractMediaUrlsFromBackgrounds,
  getMediaUrlsFromMediaDoc,
} from "./mediaCacheUtils";
import type { MediaType } from "../types";

describe("mediaCacheUtils", () => {
  describe("extractMediaUrlsFromBackgrounds", () => {
    it("returns empty array for empty backgrounds", () => {
      expect(extractMediaUrlsFromBackgrounds([])).toEqual([]);
    });

    it("returns Mux MP4 URL for video with source mux and muxPlaybackId", () => {
      const backgrounds: MediaType[] = [
        {
          id: "1",
          path: "",
          createdAt: "",
          updatedAt: "",
          format: "",
          height: 0,
          width: 0,
          name: "",
          publicId: "",
          type: "video",
          background: "https://stream.mux.com/abc/hls.m3u8",
          thumbnail: "",
          source: "mux",
          muxPlaybackId: "playback123",
        } as MediaType,
      ];
      expect(extractMediaUrlsFromBackgrounds(backgrounds)).toEqual([
        "https://stream.mux.com/playback123/highest.mp4",
      ]);
    });

    it("returns background URL for video with http(s) background when not Mux", () => {
      const backgrounds: MediaType[] = [
        {
          id: "1",
          path: "",
          createdAt: "",
          updatedAt: "",
          format: "",
          height: 0,
          width: 0,
          name: "",
          publicId: "",
          type: "video",
          background: "https://cdn.example.com/video.mp4",
          thumbnail: "",
        } as MediaType,
      ];
      expect(extractMediaUrlsFromBackgrounds(backgrounds)).toEqual([
        "https://cdn.example.com/video.mp4",
      ]);
    });

    it("includes placeholderImage for video when http(s)", () => {
      const backgrounds: MediaType[] = [
        {
          id: "1",
          path: "",
          createdAt: "",
          updatedAt: "",
          format: "",
          height: 0,
          width: 0,
          name: "",
          publicId: "",
          type: "video",
          background: "https://stream.mux.com/abc/highest.mp4",
          thumbnail: "",
          source: "mux",
          muxPlaybackId: "p1",
          placeholderImage: "https://image.mux.com/p1/thumbnail.png",
        } as MediaType,
      ];
      expect(extractMediaUrlsFromBackgrounds(backgrounds)).toEqual([
        "https://stream.mux.com/p1/highest.mp4",
        "https://image.mux.com/p1/thumbnail.png",
      ]);
    });

    it("returns background URL for image with http(s) background", () => {
      const backgrounds: MediaType[] = [
        {
          id: "1",
          path: "",
          createdAt: "",
          updatedAt: "",
          format: "",
          height: 0,
          width: 0,
          name: "",
          publicId: "",
          type: "image",
          background: "https://res.cloudinary.com/example/image.jpg",
          thumbnail: "",
        } as MediaType,
      ];
      expect(extractMediaUrlsFromBackgrounds(backgrounds)).toEqual([
        "https://res.cloudinary.com/example/image.jpg",
      ]);
    });

    it("skips items without http(s) background", () => {
      const backgrounds: MediaType[] = [
        {
          id: "1",
          path: "backgrounds/cloudinary-id",
          createdAt: "",
          updatedAt: "",
          format: "",
          height: 0,
          width: 0,
          name: "",
          publicId: "",
          type: "image",
          background: "backgrounds/cloudinary-id",
          thumbnail: "",
        } as MediaType,
      ];
      expect(extractMediaUrlsFromBackgrounds(backgrounds)).toEqual([]);
    });

    it("aggregates URLs from multiple backgrounds", () => {
      const backgrounds: MediaType[] = [
        {
          id: "1",
          type: "video",
          background: "https://v1.mp4",
          source: "mux",
          muxPlaybackId: "p1",
        } as MediaType,
        {
          id: "2",
          type: "image",
          background: "https://img.jpg",
        } as MediaType,
      ];
      expect(extractMediaUrlsFromBackgrounds(backgrounds)).toEqual([
        "https://stream.mux.com/p1/highest.mp4",
        "https://img.jpg",
      ]);
    });
  });

  describe("getMediaUrlsFromMediaDoc", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("returns unique media urls from media doc list", async () => {
      const db = {
        get: jest.fn().mockResolvedValue({
          list: [
            {
              id: "1",
              type: "video",
              background: "https://video.example.com/a.mp4",
            },
            {
              id: "2",
              type: "image",
              background: "https://images.example.com/b.jpg",
            },
            {
              id: "3",
              type: "video",
              source: "mux",
              muxPlaybackId: "abc123",
            },
            {
              id: "4",
              type: "image",
              background: "https://images.example.com/b.jpg",
            },
          ],
        }),
      } as unknown as PouchDB.Database;

      const urls = await getMediaUrlsFromMediaDoc(db);

      expect(db.get).toHaveBeenCalledWith("media");
      expect(Array.from(urls)).toEqual([
        "https://video.example.com/a.mp4",
        "https://images.example.com/b.jpg",
        "https://stream.mux.com/abc123/highest.mp4",
      ]);
    });

    it("returns empty set for missing media doc without warning", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const db = {
        get: jest.fn().mockRejectedValue({ status: 404 }),
      } as unknown as PouchDB.Database;

      const urls = await getMediaUrlsFromMediaDoc(db);

      expect(urls.size).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns and returns empty set for unexpected db errors", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const db = {
        get: jest.fn().mockRejectedValue(new Error("boom")),
      } as unknown as PouchDB.Database;

      const urls = await getMediaUrlsFromMediaDoc(db);

      expect(urls.size).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to load media doc for media cache:",
        expect.any(Error),
      );
    });
  });
});
