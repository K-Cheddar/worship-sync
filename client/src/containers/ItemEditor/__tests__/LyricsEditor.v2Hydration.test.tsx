import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DBItem } from "../../../types";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import LyricsEditor from "../LyricsEditor";
import * as persistence from "../../../utils/songPersistence";

jest.mock("../../../hooks", () => ({
  useDispatch: () => jest.fn(),
  useSelector: (selector: (state: unknown) => unknown) => selector({ undoable: { present: { item: { type: "song", isLyricsEditorOpen: false } } } }),
}));
jest.mock("../LyricsEditorPanel", () => ({
  __esModule: true,
  default: ({ song, onSaveLyrics }: { song: DBItem; onSaveLyrics?: (payload: { baselineSong: DBItem; arrangements: DBItem["arrangements"]; selectedArrangement: number }) => Promise<void> }) => (
    <div>
      <span>{song.name}: {song.arrangements[0].slides.length} authored slides</span>
      <button onClick={() => { void onSaveLyrics?.({ baselineSong: song, arrangements: song.arrangements, selectedArrangement: 0 }).catch(() => undefined); }}>Save hydrated lyrics</button>
    </div>
  ),
}));
const fullSong = (id = "song-1"): DBItem => ({
  _id: id, type: "song", name: id, selectedArrangement: 0, slides: [],
  arrangements: [{ id: "a", name: "Master", formattedLyrics: [], songOrder: [],
    monitorLayout: { currentFontSizePx: 30, nextFontSizePx: 28 },
    slides: [{ id: "s", type: "Verse", name: "Verse", boxes: [{ id: "box", words: "Authored text", width: 1920, height: 1080 }] }],
  }],
} as unknown as DBItem);
const projection = (id = "song-1") => {
  const docs = persistence.serializeSongToV2Documents(fullSong(id));
  return persistence.buildSongV2LibraryProjection(docs.root, docs.arrangements);
};
const editor = (db: PouchDB.Database, song: DBItem, save?: (payload: { baselineSong: DBItem; arrangements: DBItem["arrangements"]; selectedArrangement: number }) => Promise<void>) => (
  <ControllerInfoContext.Provider value={{ db } as never}>
    <LyricsEditor song={song} isOpen onClose={jest.fn()} onSaveLyrics={save} />
  </ControllerInfoContext.Provider>
);

describe("library lyrics editor exact v2 hydration", () => {
  afterEach(() => jest.restoreAllMocks());

  it("loads slides before initializing the draft and passes that exact song as the save baseline", async () => {
    const docs = persistence.serializeSongToV2Documents(fullSong());
    const documents = new Map([docs.root, ...docs.arrangements, ...docs.slides].map((doc) => [doc._id, doc]));
    const db = {
      get: jest.fn(async (id: string) => documents.get(id)),
      allDocs: jest.fn(async ({ keys }: { keys: string[] }) => ({ rows: keys.map((id) => ({ doc: documents.get(id) })) })),
    } as unknown as PouchDB.Database;
    const librarySong = projection();
    const save = jest.fn().mockResolvedValue(undefined);
    render(editor(db, librarySong, save));
    expect(screen.queryByRole("button", { name: "Save hydrated lyrics" })).not.toBeInTheDocument();
    await screen.findByText("song-1: 1 authored slides");
    fireEvent.click(screen.getByRole("button", { name: "Save hydrated lyrics" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      baselineSong: expect.objectContaining({ docType: "song-v2-root", arrangements: [expect.objectContaining({ slides: fullSong().arrangements[0].slides })] }),
      arrangements: expect.arrayContaining([expect.objectContaining({ slides: fullSong().arrangements[0].slides })]),
      selectedArrangement: 0,
    })));
    expect(db.get).toHaveBeenCalledWith(docs.root._id);
    expect(documents.get(docs.slides[0]._id)).toEqual(docs.slides[0]);
  });

  it("ignores a stale hydration after switching songs", async () => {
    let resolveOld!: (song: DBItem) => void;
    const oldLoad = new Promise<DBItem>((resolve) => { resolveOld = resolve; });
    const newSong = { ...fullSong("new"), docType: "song-v2-root" as const };
    jest.spyOn(persistence, "loadSong").mockImplementation(async (_db, id) => id === "old" ? oldLoad : newSong);
    const db = {} as PouchDB.Database;
    const view = render(editor(db, projection("old")));
    view.rerender(editor(db, projection("new")));
    await screen.findByText("new: 1 authored slides");
    await act(async () => { resolveOld(fullSong("old")); });
    expect(screen.queryByText("old: 1 authored slides")).not.toBeInTheDocument();
    expect(screen.getByText("new: 1 authored slides")).toBeInTheDocument();
  });

  it("can close during loading and ignores that request after reopening the same song", async () => {
    let resolveOld!: (song: DBItem) => void;
    const pending = new Promise<DBItem>((resolve) => { resolveOld = resolve; });
    const loaded = { ...fullSong(), docType: "song-v2-root" as const };
    jest.spyOn(persistence, "loadSong").mockReturnValueOnce(pending).mockResolvedValueOnce(loaded);
    const db = {} as PouchDB.Database;
    const librarySong = projection();
    const onClose = jest.fn();
    const view = render(<ControllerInfoContext.Provider value={{ db } as never}><LyricsEditor song={librarySong} isOpen onClose={onClose} /></ControllerInfoContext.Provider>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading lyrics editor");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(<ControllerInfoContext.Provider value={{ db } as never}><LyricsEditor song={librarySong} isOpen={false} onClose={onClose} /></ControllerInfoContext.Provider>);
    view.rerender(editor(db, librarySong));
    await screen.findByText("song-1: 1 authored slides");
    await act(async () => { resolveOld({ ...fullSong(), name: "Stale" }); });
    expect(screen.queryByText("Stale: 1 authored slides")).not.toBeInTheDocument();
  });

  it("shows a recoverable error without opening an empty draft when hydration fails", async () => {
    jest.spyOn(persistence, "loadSong").mockRejectedValue(new Error("Missing slide"));
    render(editor({} as PouchDB.Database, projection()));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this song");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save hydrated lyrics" })).not.toBeInTheDocument();
  });
});
