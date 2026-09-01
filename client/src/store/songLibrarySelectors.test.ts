import type { DBItem, ServiceItem } from "../types";
import type { RootState } from "./store";
import { selectSongLibrary } from "./songLibrarySelectors";

const songDoc = (id: string, name: string): DBItem =>
  ({ _id: id, name, type: "song" }) as DBItem;

const songItem = (id: string, name: string): ServiceItem => ({
  _id: id,
  name,
  type: "song",
  listId: "",
  background: "",
});

const createState = ({
  items = [],
  documents = [],
  isLoading = false,
}: {
  items?: ServiceItem[];
  documents?: DBItem[];
  isLoading?: boolean;
} = {}) =>
  ({
    allItems: {
      list: items,
      isAllItemsLoading: isLoading,
    },
    allDocs: {
      allSongDocs: documents,
    },
  }) as RootState;

describe("selectSongLibrary", () => {
  it("returns one complete library when the lightweight index is partial", () => {
    const state = createState({
      items: [songItem("song-new", "New Song")],
      documents: [
        songDoc("song-old", "Amazing Grace"),
        songDoc("song-new", "New Song"),
      ],
      isLoading: true,
    });

    const library = selectSongLibrary(state);

    expect(library.songs.map((song) => song._id)).toEqual([
      "song-old",
      "song-new",
    ]);
    expect(library.documents).toBe(state.allDocs.allSongDocs);
    expect(library.isLoading).toBe(false);
    expect(selectSongLibrary(state)).toBe(library);
  });

  it("remains loading only while neither source has songs", () => {
    expect(selectSongLibrary(createState({ isLoading: true }))).toMatchObject({
      songs: [],
      isLoading: true,
    });
  });
});
