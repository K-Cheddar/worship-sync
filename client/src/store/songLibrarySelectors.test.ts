import type { DBItem } from "../types";
import type { RootState } from "./store";
import { selectSongLibrary } from "./songLibrarySelectors";

const songDoc = (id: string, name: string): DBItem =>
  ({ _id: id, name, type: "song" }) as DBItem;


const createState = ({
  documents = [],
  isLoading = false,
}: {
  documents?: DBItem[];
  isLoading?: boolean;
} = {}) =>
  ({

    allDocs: {
      allSongDocs: documents,
      isInitialized: !isLoading,
    },
  }) as unknown as RootState;

describe("selectSongLibrary", () => {
  it("derives the song library from cached documents", () => {
    const state = createState({
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

  it("remains loading until the document snapshot is available", () => {
    expect(selectSongLibrary(createState({ isLoading: true }))).toMatchObject({
      songs: [],
      isLoading: true,
    });
  });
});
