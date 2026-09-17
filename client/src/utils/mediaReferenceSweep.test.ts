import {
  PREFERENCES_POUCH_ID,
  QUICK_LINKS_POUCH_ID,
  type DBItem,
  type MediaType,
} from "../types";
import { sweepMediaReferencesBeforeDelete } from "./mediaReferenceSweep";

const videoInputMedia = (sourceId: string): MediaType => ({
  id: `local_input_${sourceId}`,
  name: "Booth camera",
  type: "video",
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "live",
  height: 1080,
  width: 1920,
  publicId: `local_input_${sourceId}`,
  background: `local-video-input://${encodeURIComponent(sourceId)}`,
  thumbnail: "",
  placeholderImage: "",
  source: "local",
  localVideoInput: {
    kind: "local-video-input",
    sourceId,
    label: "Booth camera",
  },
});

describe("sweepMediaReferencesBeforeDelete", () => {
  it("clears slide mediaSource for deleted live video inputs", async () => {
    const sourceId = "cam-1";
    const media = videoInputMedia(sourceId);
    const item: DBItem = {
      _id: "Live Cam Item",
      _rev: "1-abc",
      name: "Live Cam Item",
      type: "free",
      background: "",
      selectedArrangement: 0,
      arrangements: [],
      slides: [
        {
          id: "s1",
          type: "Section",
          name: "Section 1",
          mediaSource: {
            kind: "local-video-input",
            sourceId,
            label: "Booth camera",
          },
          boxes: [
            {
              words: "",
              background: "",
              fontSize: 40,
              width: 1920,
              height: 1080,
            },
            {
              words: "",
              background: "",
              fontSize: 40,
              width: 1920,
              height: 1080,
            },
          ],
        },
      ],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    };

    const put = jest.fn(async (doc: DBItem) => ({
      ok: true,
      id: doc._id,
      rev: "2-def",
    }));

    const db = {
      get: jest.fn(async (id: string) => {
        if (id === PREFERENCES_POUCH_ID) {
          return {
            _id: PREFERENCES_POUCH_ID,
            _rev: "1-prefs",
            preferences: {
              defaultSongBackground: { background: "song-bg" },
              defaultTimerBackground: { background: "" },
              defaultBibleBackground: { background: "bible-bg" },
              defaultFreeFormBackground: { background: "free-bg" },
            },
          };
        }
        if (id === QUICK_LINKS_POUCH_ID) {
          return {
            _id: QUICK_LINKS_POUCH_ID,
            _rev: "1-ql",
            quickLinks: [],
          };
        }
        const missing = new Error("not_found") as Error & {
          status: number;
          name: string;
        };
        missing.status = 404;
        missing.name = "not_found";
        throw missing;
      }),
      put,
      allDocs: jest.fn(async () => ({
        rows: [{ id: item._id, doc: item }],
      })),
    } as unknown as PouchDB.Database;

    const result = await sweepMediaReferencesBeforeDelete(
      db,
      new Set([media.id]),
      [media],
    );

    expect(result.ok).toBe(true);
    expect(put).toHaveBeenCalled();
    const saved = put.mock.calls[0][0] as DBItem;
    expect(saved.slides?.[0]?.mediaSource).toBeUndefined();
  });
});
