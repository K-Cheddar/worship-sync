import { selectUnifiedItemLibrary, selectItemEntries } from "./itemLibrarySelectors";
import { allDocsSlice } from "./allDocsSlice";
import type { RootState } from "./store";
import type { DBItem } from "../types";
import { itemDocumentToLibraryEntry } from "../utils/itemLibrary";

it("derives every library category from document metadata and excludes Bible/headings from browsing", () => {
  const docs = [
    { _id: "song", type: "song", name: "Song", background: "current" },
    { _id: "custom", type: "free", name: "Custom", localImage: { id: "image" }, localVideoFile: { id: "video" } },
    { _id: "timer", type: "timer", name: "Timer" },
    { _id: "bible", type: "bible", name: "Bible" },
    { _id: "heading", type: "heading", name: "Heading" },
  ] as DBItem[];
  const state = { allDocs: allDocsSlice.reducer(undefined, allDocsSlice.actions.hydrateItemCache(docs)) } as RootState;
  expect(selectUnifiedItemLibrary(state).map((item) => item._id)).toEqual(["custom", "song", "timer"]);
  expect(selectUnifiedItemLibrary(state)[0]).toMatchObject({ localImage: { id: "image" }, localVideoFile: { id: "video" } });
  expect(selectUnifiedItemLibrary(state)[1]).toMatchObject({ name: "Song", background: "current" });
  expect(selectItemEntries(state)).toHaveLength(5);
  expect(selectUnifiedItemLibrary(state)).toBe(selectUnifiedItemLibrary(state));
});

it("keeps the unified library stable when Bible, heading, and service-time documents change", () => {
  const initialState = allDocsSlice.reducer(undefined, allDocsSlice.actions.hydrateItemCache([
    { _id: "song", type: "song", name: "Song" },
    { _id: "custom", type: "free", name: "Custom" },
    { _id: "timer", type: "timer", name: "Timer" },
  ] as DBItem[]));
  const initialRoot = { allDocs: initialState } as RootState;
  const initialLibrary = selectUnifiedItemLibrary(initialRoot);
  const initialEntries = selectItemEntries(initialRoot);

  const nextState = allDocsSlice.reducer(initialState, allDocsSlice.actions.applyItemDocumentChanges([
    { id: "bible", doc: { _id: "bible", type: "bible", name: "Bible" } as DBItem },
    { id: "heading", doc: { _id: "heading", type: "heading", name: "Heading" } as DBItem },
    { id: "service-time", doc: { _id: "service-time", type: "service-time", name: "Service" } as DBItem },
  ]));
  const nextRoot = { allDocs: nextState } as RootState;

  expect(selectUnifiedItemLibrary(nextRoot)).toBe(initialLibrary);
  expect(selectItemEntries(nextRoot)).not.toBe(initialEntries);
  expect(selectItemEntries(nextRoot)).toHaveLength(6);
});

it("reuses unchanged projections and skips sorting when only hidden content changes", () => {
  const initialState = allDocsSlice.reducer(undefined, allDocsSlice.actions.hydrateItemCache([
    { _id: "custom", type: "free", name: "Custom", background: "same" },
  ] as DBItem[]));
  const initialRoot = { allDocs: initialState } as RootState;
  const initialLibrary = selectUnifiedItemLibrary(initialRoot);
  const initialEntry = initialLibrary[0];

  const nextState = allDocsSlice.reducer(initialState, allDocsSlice.actions.applyItemDocumentChange({
    id: "custom",
    doc: { _id: "custom", type: "free", name: "Custom", background: "same", slides: [{ id: "new-slide" }], _rev: "2-b" } as unknown as DBItem,
  }));
  const nextLibrary = selectUnifiedItemLibrary({ allDocs: nextState } as RootState);

  expect(nextLibrary).toBe(initialLibrary);
  expect(nextLibrary[0]).toBe(initialEntry);
});

it("treats omitted cache categories as empty lists", () => {
  const state = {
    allDocs: { allSongDocs: [{ _id: "song", type: "song", name: "Song" } as DBItem] },
  } as RootState;
  expect(selectUnifiedItemLibrary(state).map((entry) => entry._id)).toEqual(["song"]);
  expect(selectItemEntries(state).map((entry) => entry._id)).toEqual(["song"]);
});

it.each([
  { type: "image", referenceKey: "localImage", reference: { id: "image", cloudUrl: "https://images.test/current.jpg" }, expected: "https://images.test/current.jpg" },
  { type: "video", referenceKey: "localVideoFile", reference: { id: "video" }, expected: "https://images.test/poster.jpg" },
])("preserves persisted local $type references and thumbnail metadata from slides", ({ type, referenceKey, reference, expected }) => {
  const document = {
    _id: "media-item", name: "Media item", type: "free", background: "local-source",
    slides: [{ boxes: [{ mediaInfo: { type, [referenceKey]: reference, placeholderImage: "https://images.test/poster.jpg" } }] }],
  } as unknown as DBItem;
  const entry = itemDocumentToLibraryEntry(document);
  expect(entry[referenceKey as "localImage" | "localVideoFile"]).toEqual(reference);
  expect(entry.background).toBe(expected);
});

it("uses a song's first slide box background for its outline thumbnail", () => {
  const document = {
    _id: "song-with-slide-background",
    name: "Song with slide background",
    type: "song",
    selectedArrangement: 0,
    arrangements: [{ slides: [{ boxes: [{ background: "https://images.test/song.jpg" }] }] }],
  } as unknown as DBItem;

  expect(itemDocumentToLibraryEntry(document).background).toBe(
    "https://images.test/song.jpg",
  );
});
