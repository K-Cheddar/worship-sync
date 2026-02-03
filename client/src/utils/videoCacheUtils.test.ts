import {
  extractVideoUrlsFromBox,
  extractVideoUrlsFromSlide,
  extractVideoUrlsFromItem,
} from "./videoCacheUtils";
import type { Box, ItemSlideType, DBItem, MediaType } from "../types";

describe("videoCacheUtils", () => {
  describe("extractVideoUrlsFromBox", () => {
    it("returns empty array when box has no video mediaInfo", () => {
      const box: Box = {
        id: "b1",
        background: "",
        excludeFromOverflow: false,
        brightness: 100,
        width: 100,
        height: 100,
      };
      expect(extractVideoUrlsFromBox(box)).toEqual([]);
    });

    it("returns empty array when mediaInfo type is not video", () => {
      const box: Box = {
        id: "b1",
        background: "",
        excludeFromOverflow: false,
        brightness: 100,
        width: 100,
        height: 100,
        mediaInfo: { type: "image", background: "https://img.jpg" } as MediaType,
      };
      expect(extractVideoUrlsFromBox(box)).toEqual([]);
    });

    it("returns Mux MP4 URL when source is mux and muxPlaybackId is set", () => {
      const box: Box = {
        id: "b1",
        background: "",
        excludeFromOverflow: false,
        brightness: 100,
        width: 100,
        height: 100,
        mediaInfo: {
          type: "video",
          background: "https://stream.mux.com/abc/hls.m3u8",
          source: "mux",
          muxPlaybackId: "playback123",
        } as MediaType,
      };
      expect(extractVideoUrlsFromBox(box)).toEqual([
        "https://stream.mux.com/playback123/highest.mp4",
      ]);
    });

    it("returns background URL when video but not Mux", () => {
      const box: Box = {
        id: "b1",
        background: "",
        excludeFromOverflow: false,
        brightness: 100,
        width: 100,
        height: 100,
        mediaInfo: {
          type: "video",
          background: "https://cdn.example.com/video.mp4",
        } as MediaType,
      };
      expect(extractVideoUrlsFromBox(box)).toEqual([
        "https://cdn.example.com/video.mp4",
      ]);
    });
  });

  describe("extractVideoUrlsFromSlide", () => {
    it("aggregates URLs from all boxes in slide", () => {
      const slide: ItemSlideType = {
        id: "s1",
        type: "Media",
        name: "",
        boxes: [
          {
            id: "b1",
            background: "",
            excludeFromOverflow: false,
            brightness: 100,
            width: 100,
            height: 100,
            mediaInfo: {
              type: "video",
              background: "https://v1.mp4",
            } as MediaType,
          },
          {
            id: "b2",
            background: "",
            excludeFromOverflow: false,
            brightness: 100,
            width: 100,
            height: 100,
            mediaInfo: {
              type: "video",
              source: "mux",
              muxPlaybackId: "p1",
              background: "https://mux.com/p1",
            } as MediaType,
          },
        ],
      };
      expect(extractVideoUrlsFromSlide(slide)).toEqual([
        "https://v1.mp4",
        "https://stream.mux.com/p1/highest.mp4",
      ]);
    });

    it("returns empty array for slide with no video boxes", () => {
      const slide: ItemSlideType = {
        id: "s1",
        type: "Media",
        name: "",
        boxes: [
          {
            id: "b1",
            background: "img",
            excludeFromOverflow: false,
            brightness: 100,
            width: 100,
            height: 100,
          },
        ],
      };
      expect(extractVideoUrlsFromSlide(slide)).toEqual([]);
    });
  });

  describe("extractVideoUrlsFromItem", () => {
    it("extracts from item.slides", () => {
      const item: DBItem = {
        name: "Item",
        type: "free",
        _id: "1",
        selectedArrangement: 0,
        shouldSendTo: { projector: false, monitor: false, stream: false },
        arrangements: [],
        slides: [
          {
            id: "s1",
            type: "Media",
            name: "",
            boxes: [
              {
                id: "b1",
                background: "",
                excludeFromOverflow: false,
                brightness: 100,
                width: 100,
                height: 100,
                mediaInfo: {
                  type: "video",
                  background: "https://item-video.mp4",
                } as MediaType,
              },
            ],
          },
        ],
      };
      expect(extractVideoUrlsFromItem(item)).toEqual([
        "https://item-video.mp4",
      ]);
    });

    it("extracts from item.arrangements[].slides", () => {
      const item: DBItem = {
        name: "Song",
        type: "song",
        _id: "1",
        selectedArrangement: 0,
        shouldSendTo: { projector: false, monitor: false, stream: false },
        arrangements: [
          {
            name: "Arr",
            id: "a1",
            formattedLyrics: [],
            songOrder: [],
            slides: [
              {
                id: "s1",
                type: "Media",
                name: "",
                boxes: [
                  {
                    id: "b1",
                    background: "",
                    excludeFromOverflow: false,
                    brightness: 100,
                    width: 100,
                    height: 100,
                    mediaInfo: {
                      type: "video",
                      background: "https://arr-video.mp4",
                    } as MediaType,
                  },
                ],
              },
            ],
          },
        ],
        slides: [],
      };
      expect(extractVideoUrlsFromItem(item)).toEqual(["https://arr-video.mp4"]);
    });

    it("returns empty array when item has no slides or arrangements", () => {
      const item = {
        name: "Item",
        type: "free",
        _id: "1",
        selectedArrangement: 0,
        shouldSendTo: { projector: false, monitor: false, stream: false },
        slides: [],
        arrangements: [],
      } as unknown as DBItem;
      expect(extractVideoUrlsFromItem(item)).toEqual([]);
    });
  });
});
