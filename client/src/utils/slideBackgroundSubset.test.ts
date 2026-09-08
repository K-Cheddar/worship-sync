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

  it("sets and clears slide mediaSource when provided", () => {
    const withSource = mapSlidesUpdateBox0ById(slides, new Set(["s0"]), {
      background: "",
      mediaSource: {
        kind: "local-video-input",
        sourceId: "local_video_1",
        label: "Screen",
        captureKind: "screen",
      },
    });
    expect(withSource[0].mediaSource?.sourceId).toBe("local_video_1");

    const cleared = mapSlidesUpdateBox0ById(withSource, new Set(["s0"]), {
      background: "https://example.com/a.png",
      mediaSource: null,
    });
    expect(cleared[0].mediaSource).toBeUndefined();
    expect(cleared[0].boxes[0].background).toBe("https://example.com/a.png");
  });
});
