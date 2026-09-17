import type { DBItem, ItemSlideType } from "../types";
import { collectLocalVideoListWarmSourceIds } from "./collectLocalVideoListWarmSourceIds";
import { resolveLocalVideoInputBinding } from "./localVideoInput";

jest.mock("./localVideoInput", () => ({
  isDesktopCaptureKind:
    jest.requireActual("./localVideoInput").isDesktopCaptureKind,
  resolveLocalVideoInputBinding: jest.fn(),
}));

const mockResolveBinding = jest.mocked(resolveLocalVideoInputBinding);

const camSlide = (sourceId: string, id = "s1"): ItemSlideType => ({
  type: "Section",
  name: "Cam",
  id,
  boxes: [],
  mediaSource: {
    kind: "local-video-input",
    sourceId,
    label: `Cam ${sourceId}`,
  },
});

describe("collectLocalVideoListWarmSourceIds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveBinding.mockImplementation((sourceId) => {
      if (sourceId === "screen-1") {
        return {
          sourceId,
          deviceId: "screen:1",
          deviceLabel: "Screen",
          captureKind: "screen",
        };
      }
      if (sourceId.startsWith("source-")) {
        return {
          sourceId,
          deviceId: `device-${sourceId}`,
          deviceLabel: "USB Capture",
        };
      }
      return undefined;
    });
  });

  it("collects hardware inputs from outline backgrounds and open slides", () => {
    expect(
      collectLocalVideoListWarmSourceIds({
        itemList: [
          {
            _id: "a",
            listId: "1",
            type: "free",
            background: "local-video-input://source-1",
          },
          {
            _id: "b",
            listId: "2",
            type: "free",
            background: "https://cdn.example.com/img.jpg",
          },
          {
            _id: "c",
            listId: "3",
            type: "free",
            background: "local-video-input://source%2D2",
          },
        ],
        openItem: {
          _id: "b",
          listId: "2",
          type: "free",
          slides: [camSlide("source-3")],
        },
      }),
    ).toEqual(["source-1", "source-2", "source-3"]);
  });

  it("collects hardware inputs from list item slides via docsById", () => {
    const docsById = new Map<string, DBItem>([
      [
        "song-1",
        {
          _id: "song-1",
          _rev: "1",
          name: "Song",
          type: "song",
          background: "",
          selectedArrangement: 0,
          arrangements: [
            {
              id: "arr-1",
              name: "Default",
              formattedLyrics: [],
              songOrder: [],
              slides: [camSlide("source-4", "s4")],
            },
          ],
          slides: [],
          shouldSendTo: { projector: true, monitor: true, stream: true },
        },
      ],
      [
        "free-1",
        {
          _id: "free-1",
          _rev: "1",
          name: "Announcement",
          type: "free",
          background: "",
          selectedArrangement: 0,
          arrangements: [],
          slides: [
            camSlide("source-5", "s5"),
            {
              type: "Section",
              name: "Still",
              id: "s6",
              boxes: [
                {
                  words: "",
                  background: "local-video-input://source-6",
                  fontSize: 40,
                  width: 1920,
                  height: 1080,
                },
              ],
            },
          ],
          shouldSendTo: { projector: true, monitor: true, stream: true },
        },
      ],
    ]);

    expect(
      collectLocalVideoListWarmSourceIds({
        itemList: [
          {
            _id: "song-1",
            listId: "l1",
            type: "song",
            background: "https://cdn.example.com/thumb.jpg",
          },
          {
            _id: "free-1",
            listId: "l2",
            type: "free",
          },
        ],
        openItem: null,
        docsById,
      }),
    ).toEqual(["source-4", "source-5", "source-6"]);
  });

  it("prefers open item slides over stale docs for the active list row", () => {
    const docsById = new Map<string, DBItem>([
      [
        "free-1",
        {
          _id: "free-1",
          _rev: "1",
          name: "Announcement",
          type: "free",
          background: "",
          selectedArrangement: 0,
          arrangements: [],
          slides: [camSlide("source-stale")],
          shouldSendTo: { projector: true, monitor: true, stream: true },
        },
      ],
    ]);

    expect(
      collectLocalVideoListWarmSourceIds({
        itemList: [{ _id: "free-1", listId: "l1", type: "free" }],
        openItem: {
          _id: "free-1",
          listId: "l1",
          type: "free",
          slides: [camSlide("source-fresh")],
        },
        docsById,
      }),
    ).toEqual(["source-fresh"]);
  });

  it("skips desktop shares and unbound sources", () => {
    expect(
      collectLocalVideoListWarmSourceIds({
        itemList: [
          {
            _id: "a",
            listId: "1",
            type: "free",
            background: "local-video-input://screen-1",
          },
          {
            _id: "b",
            listId: "2",
            type: "free",
            background: "local-video-input://missing",
          },
        ],
        openItem: null,
      }),
    ).toEqual([]);
  });
});
