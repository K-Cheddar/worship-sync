import {
  PREFERENCES_POUCH_ID,
  QUICK_LINKS_POUCH_ID,
  type DBItem,
  type MediaType,
} from "../types";
import {
  replaceMediaReferencesForReplacement,
  sweepMediaReferencesBeforeDelete,
} from "./mediaReferenceSweep";

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

describe("replaceMediaReferencesForReplacement", () => {
  it("migrates saved item, arrangement, preference, quick-link, and overlay references", async () => {
    const oldMedia = {
      id: "canva-image-1",
      name: "Welcome",
      type: "image",
      background: "https://cdn.example/old.png?signature=old",
      thumbnail: "https://cdn.example/old-thumb.png?x=1",
    } as MediaType;
    const newMedia = {
      ...oldMedia,
      background: "https://cdn.example/new.png",
      thumbnail: "https://cdn.example/new-thumb.png",
      publicId: "new-public-id",
    } as MediaType;
    const item = {
      _id: "item-1",
      type: "free",
      background: "https://cdn.example/old.png",
      slides: [
        {
          id: "slide-1",
          type: "Section",
          name: "Keep this label",
          boxes: [
            {
              words: "Keep this text",
              background: "https://cdn.example/old.png?cache=1",
              mediaInfo: { ...oldMedia },
              width: 1920,
              height: 1080,
            },
          ],
          monitorCurrentBandBoxes: [
            {
              words: "Keep monitor text",
              background: oldMedia.background,
              mediaInfo: { ...oldMedia },
              width: 1920,
              height: 540,
            },
          ],
        },
      ],
      arrangements: [
        {
          name: "Arrangement",
          slides: [
            {
              id: "arrangement-slide",
              type: "Section",
              name: "Arrangement slide",
              boxes: [
                {
                  background: oldMedia.background,
                  mediaInfo: { ...oldMedia },
                  width: 1920,
                  height: 1080,
                },
              ],
            },
          ],
        },
      ],
    };
    const preferences = {
      _id: PREFERENCES_POUCH_ID,
      _rev: "1-prefs",
      preferences: {
        defaultSongBackground: {
          background: oldMedia.background,
          mediaInfo: { ...oldMedia },
        },
        defaultTimerBackground: { background: "" },
        defaultBibleBackground: { background: "bible" },
        defaultFreeFormBackground: { background: "free" },
      },
    };
    const quickLinks = {
      _id: QUICK_LINKS_POUCH_ID,
      _rev: "1-quick-links",
      quickLinks: [
        {
          id: "ql-1",
          label: "Welcome",
          canDelete: true,
          presentationInfo: {
            type: "free",
            name: "Welcome",
            slide: {
              id: "quick-slide",
              type: "Section",
              name: "Quick slide",
              boxes: [
                {
                  background: oldMedia.background,
                  mediaInfo: { ...oldMedia },
                  width: 1920,
                  height: 1080,
                },
              ],
            },
            nextSlide: null,
            imageOverlayInfo: {
              id: "overlay-image",
              type: "image",
              imageUrl: oldMedia.background,
            },
          },
        },
      ],
    };
    const overlay = {
      _id: "overlay-1",
      _rev: "1-overlay",
      id: "overlay-1",
      type: "image",
      imageUrl: "https://cdn.example/old.png?overlay=1",
    };
    const docs = new Map<string, any>([
      [PREFERENCES_POUCH_ID, preferences],
      [QUICK_LINKS_POUCH_ID, quickLinks],
      [item._id, item],
      [overlay._id, overlay],
    ]);
    const put = jest.fn(async (doc: any) => {
      docs.set(doc._id, { ...doc, _rev: `${Number(doc._rev?.[0] || 1) + 1}-saved` });
      return { ok: true, id: doc._id, rev: docs.get(doc._id)._rev };
    });
    const db = {
      get: jest.fn(async (id: string) => docs.get(id)),
      put,
      allDocs: jest.fn(async () => ({
        rows: [...docs.values()].map((doc) => ({ id: doc._id, doc })),
      })),
    } as unknown as PouchDB.Database;

    const result = await replaceMediaReferencesForReplacement(db, {
      oldMedia,
      newMedia,
    });

    expect(result.ok).toBe(true);
    expect(result.rollbackStatus).toBe("not_needed");
    const savedItem = docs.get(item._id);
    expect(savedItem.background).toBe(newMedia.background);
    expect(savedItem.slides[0].boxes[0].background).toBe(newMedia.background);
    expect(savedItem.slides[0].boxes[0].mediaInfo).toEqual(newMedia);
    expect(savedItem.slides[0].boxes[0].words).toBe("Keep this text");
    expect(savedItem.arrangements[0].slides[0].boxes[0].mediaInfo).toEqual(
      newMedia,
    );
    expect(docs.get(PREFERENCES_POUCH_ID).preferences.defaultSongBackground).toEqual({
      background: newMedia.background,
      mediaInfo: newMedia,
    });
    expect(
      docs.get(QUICK_LINKS_POUCH_ID).quickLinks[0].presentationInfo.slide
        .boxes[0].mediaInfo,
    ).toEqual(newMedia);
    expect(
      docs.get(QUICK_LINKS_POUCH_ID).quickLinks[0].presentationInfo
        .imageOverlayInfo.imageUrl,
    ).toBe(newMedia.background);
    expect(docs.get(overlay._id).imageUrl).toBe(newMedia.background);
  });

  it("rolls back already-written documents when a later reference save fails", async () => {
    const oldMedia = {
      id: "old",
      background: "https://cdn.example/old.png",
    } as MediaType;
    const newMedia = {
      ...oldMedia,
      background: "https://cdn.example/new.png",
    } as MediaType;
    const preferences = {
      _id: PREFERENCES_POUCH_ID,
      _rev: "1-prefs",
      preferences: {
        defaultSongBackground: { background: oldMedia.background },
        defaultTimerBackground: { background: "" },
        defaultBibleBackground: { background: "" },
        defaultFreeFormBackground: { background: "" },
      },
    };
    const item = {
      _id: "item-rollback",
      type: "free",
      background: oldMedia.background,
      slides: [],
      arrangements: [],
    };
    const docs = new Map<string, any>([[PREFERENCES_POUCH_ID, preferences], [item._id, item]]);
    let putCount = 0;
    const db = {
      get: jest.fn(async (id: string) => docs.get(id)),
      allDocs: jest.fn(async () => ({ rows: [{ id: item._id, doc: item }] })),
      put: jest.fn(async (doc: any) => {
        putCount += 1;
        if (putCount === 2) throw new Error("conflict");
        docs.set(doc._id, doc);
        return { rev: "2-saved" };
      }),
    } as unknown as PouchDB.Database;

    const result = await replaceMediaReferencesForReplacement(db, {
      oldMedia,
      newMedia,
    });

    expect(result.ok).toBe(false);
    expect(result.rollbackStatus).toBe("complete");
    expect(docs.get(PREFERENCES_POUCH_ID).preferences.defaultSongBackground.background).toBe(
      oldMedia.background,
    );
  });

  it("reports uncertain rollback when restoring a written document fails", async () => {
    const oldMedia = {
      id: "old-uncertain",
      background: "https://cdn.example/old-uncertain.png",
    } as MediaType;
    const newMedia = {
      ...oldMedia,
      background: "https://cdn.example/new-uncertain.png",
    } as MediaType;
    const preferences = {
      _id: PREFERENCES_POUCH_ID,
      _rev: "1-prefs",
      preferences: {
        defaultSongBackground: { background: oldMedia.background },
        defaultTimerBackground: { background: "" },
        defaultBibleBackground: { background: "" },
        defaultFreeFormBackground: { background: "" },
      },
    };
    const item = {
      _id: "item-uncertain",
      type: "free",
      background: oldMedia.background,
      slides: [],
      arrangements: [],
    };
    const docs = new Map<string, any>([
      [PREFERENCES_POUCH_ID, preferences],
      [item._id, item],
    ]);
    let putCount = 0;
    const db = {
      get: jest.fn(async (id: string) => docs.get(id)),
      allDocs: jest.fn(async () => ({ rows: [{ id: item._id, doc: item }] })),
      put: jest.fn(async (doc: any) => {
        putCount += 1;
        if (putCount === 2) throw new Error("conflict");
        if (putCount === 3) throw new Error("rollback conflict");
        docs.set(doc._id, doc);
        return { rev: "2-saved" };
      }),
    } as unknown as PouchDB.Database;

    const result = await replaceMediaReferencesForReplacement(db, {
      oldMedia,
      newMedia,
    });

    expect(result.ok).toBe(false);
    expect(result.rollbackStatus).toBe("uncertain");
  });
});
