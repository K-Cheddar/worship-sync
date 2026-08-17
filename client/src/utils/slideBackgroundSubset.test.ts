import type { ItemSlideType } from "../types";
import { mapSlidesUpdateBox0ById } from "./slideBackgroundSubset";

describe("mapSlidesUpdateBox0ById", () => {
  const slides: ItemSlideType[] = [
    {
      id: "s0",
      type: "Title",
      name: "T",
      boxes: [
        { width: 100, height: 100, background: "old0" },
        { width: 100, height: 50 },
      ],
    },
    {
      id: "s1",
      type: "Verse",
      name: "V",
      boxes: [
        {
          width: 100,
          height: 100,
          background: "old1",
          mediaInfo: { x: 1 } as any,
        },
        { width: 100, height: 50 },
      ],
    },
  ];

  it("updates only matching ids on box 0", () => {
    const next = mapSlidesUpdateBox0ById(slides, new Set(["s1"]), {
      background: "new",
      mediaInfo: undefined,
    });
    expect(next[0].boxes[0].background).toBe("old0");
    expect(next[1].boxes[0].background).toBe("new");
    expect(next[1].boxes[0].mediaInfo).toBeUndefined();
    expect(next[1].boxes[1]).toEqual(slides[1].boxes[1]);
  });

  it("stores a live input as the media layer and preserves text boxes", () => {
    const localVideoInput = {
      kind: "local-video-input" as const,
      sourceId: "camera-1",
      label: "Sanctuary camera",
      fit: "cover" as const,
      audioEnabled: false,
    };
    const next = mapSlidesUpdateBox0ById(slides, new Set(["s1"]), {
      background: "local-video-input://camera-1",
      mediaInfo: {
        id: "input-1",
        type: "video",
        localVideoInput,
      } as any,
    });

    expect(next[1].mediaSource).toEqual(localVideoInput);
    expect(next[1].boxes[0].background).toBe("local-video-input://camera-1");
    expect(next[1].boxes[1]).toBe(slides[1].boxes[1]);
  });
});
