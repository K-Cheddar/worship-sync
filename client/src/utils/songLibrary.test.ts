import type { DBItem, ServiceItem } from "../types";
import { mergeSongLibraryItems } from "./songLibrary";

const songDoc = (id: string, name: string): DBItem =>
  ({ _id: id, name, type: "song", background: `${id}.jpg` }) as DBItem;

const songItem = (id: string, name: string): ServiceItem => ({
  _id: id,
  name,
  type: "song",
  listId: "",
  background: `${id}-indexed.jpg`,
});

describe("mergeSongLibraryItems", () => {
  it("keeps document-backed songs when the allItems index is partial", () => {
    const songs = mergeSongLibraryItems(
      [songItem("new-song", "New Song")],
      [
        songDoc("old-song", "Amazing Grace"),
        songDoc("new-song", "New Song"),
      ],
    );

    expect(songs).toEqual([
      expect.objectContaining({ _id: "old-song", name: "Amazing Grace" }),
      expect.objectContaining({
        _id: "new-song",
        name: "New Song",
        background: "new-song-indexed.jpg",
      }),
    ]);
  });

  it("ignores non-song rows and derives song rows from documents", () => {
    const songs = mergeSongLibraryItems(
      [
        {
          _id: "timer-1",
          name: "Countdown",
          type: "timer",
          listId: "",
          background: "",
        },
      ],
      [songDoc("song-1", "Living Hope")],
    );

    expect(songs).toEqual([
      expect.objectContaining({
        _id: "song-1",
        name: "Living Hope",
        listId: "song-1",
      }),
    ]);
  });
});
