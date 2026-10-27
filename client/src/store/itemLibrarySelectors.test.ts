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
