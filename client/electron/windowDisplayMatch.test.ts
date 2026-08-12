import {
  findDisplayByBounds,
  findDisplayById,
  pickFallbackDisplay,
} from "./windowDisplayMatch";

const displays = [
  { id: 10, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 20, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
  { id: 30, bounds: { x: 3840, y: 0, width: 1280, height: 720 } },
];

describe("windowDisplayMatch", () => {
  it("findDisplayById returns the matching display", () => {
    expect(findDisplayById(displays, 20)?.id).toBe(20);
    expect(findDisplayById(displays, 99)).toBeUndefined();
    expect(findDisplayById(displays, undefined)).toBeUndefined();
  });

  it("findDisplayByBounds remaps after display IDs change", () => {
    const remapped = [
      { id: 101, bounds: displays[0].bounds },
      { id: 202, bounds: displays[1].bounds },
    ];
    expect(
      findDisplayByBounds(remapped, {
        x: 1920,
        y: 0,
        width: 1920,
        height: 1080,
      })?.id,
    ).toBe(202);
  });

  it("pickFallbackDisplay prefers secondary screens by window type", () => {
    expect(pickFallbackDisplay(displays, "projector", displays[0]).id).toBe(20);
    expect(pickFallbackDisplay(displays, "monitor", displays[0]).id).toBe(30);
    expect(pickFallbackDisplay(displays, "board", displays[0]).id).toBe(30);
    expect(
      pickFallbackDisplay([displays[0]], "projector", displays[0]).id,
    ).toBe(10);
  });
});
