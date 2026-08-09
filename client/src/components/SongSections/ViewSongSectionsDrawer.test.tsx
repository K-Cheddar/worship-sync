import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import allDocsReducer from "../../store/allDocsSlice";
import allItemsReducer from "../../store/allItemsSlice";
import {
  createMockControllerContext,
  createMockGlobalContext,
  createMockPouchDB,
} from "../../test/mocks";
import type { DBItem } from "../../types";
import { deleteSongAudioWithRetry, uploadSongAudio } from "../../api/auth";
import ViewSongSectionsDrawer from "./ViewSongSectionsDrawer";

jest.mock("../../api/auth", () => ({
  deleteSongAudioWithRetry: jest.fn(),
  getSongAudioUrl: jest.fn(),
  uploadSongAudio: jest.fn(),
}));

const mockDeleteSongAudio = jest.mocked(deleteSongAudioWithRetry);
const mockUploadSongAudio = jest.mocked(uploadSongAudio);

const song = {
  _id: "song-1",
  name: "Living Hope",
  type: "song",
  selectedArrangement: 0,
  arrangements: [
    {
      id: "arrangement-1",
      name: "Default",
      formattedLyrics: [
        {
          id: "verse-1",
          type: "Verse",
          name: "Verse 1",
          words: "How great the chasm",
          slideSpan: 1,
        },
      ],
      songOrder: [{ id: "verse-1", name: "Verse 1" }],
      slides: [],
    },
  ],
  slides: [],
  shouldSendTo: { projector: true, monitor: true, stream: true },
  songMetadata: {
    source: "manual",
    trackName: "Living Hope",
    artistName: "Phil Wickham",
    albumName: "Living Hope",
    importedAt: "2026-08-06T12:00:00.000Z",
  },
  songAudio: {
    id: "reference",
    key: "churches/church-1/songs/song-1/reference.mp3",
    fileName: "living-hope-reference.mp3",
    contentType: "audio/mpeg",
    sizeBytes: 3 * 1024 * 1024,
    uploadedAt: "2026-08-06T12:00:00.000Z",
  },
  songLinks: [
    { id: "link-1", label: "Tutorial", url: "https://example.com/tutorial" },
  ],
} as DBItem;

const renderDrawer = ({
  access = "full",
  db = createMockPouchDB(),
  drawerSong = song,
}: {
  access?: "full" | "music" | "view";
  db?: ReturnType<typeof createMockPouchDB>;
  drawerSong?: DBItem;
} = {}) => {
  const store = configureStore({
    reducer: {
      allDocs: allDocsReducer,
      allItems: allItemsReducer,
    },
  });
  render(
    <Provider store={store}>
      <ControllerInfoContext.Provider
        value={createMockControllerContext({ db }) as never}
      >
        <GlobalInfoContext.Provider
          value={createMockGlobalContext({ access }) as never}
        >
          <ViewSongSectionsDrawer song={drawerSong} isOpen onClose={jest.fn()} />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    </Provider>,
  );
  return { store };
};

describe("ViewSongSectionsDrawer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteSongAudio.mockResolvedValue({ success: true });
  });

  it("shows song resources above lyrics and arrangements", () => {
    renderDrawer();

    expect(
      screen.getByRole("heading", { name: "Song details — Living Hope" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Phil Wickham")).toBeInTheDocument();
    expect(screen.getByText("living-hope-reference.mp3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tutorial" })).toHaveAttribute(
      "href",
      "https://example.com/tutorial",
    );
    expect(screen.getByText("Lyrics and arrangements")).toBeInTheDocument();
    expect(screen.getByText("Verse 1")).toBeInTheDocument();
  });

  it("saves the same song details available from the controller editor", async () => {
    const get = jest.fn().mockResolvedValue({ ...song, _rev: "1-old" });
    const put = jest.fn().mockResolvedValue({ ok: true, id: song._id, rev: "2-new" });
    const db = createMockPouchDB({ get, put });
    const { store } = renderDrawer({ db });

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Song name/i), {
      target: { value: "Living Hope (Acoustic)" },
    });
    fireEvent.change(screen.getByLabelText(/Artist/i), {
      target: { value: "Phil Wickham and team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: "song-1",
          _rev: "1-old",
          name: "Living Hope (Acoustic)",
          songMetadata: expect.objectContaining({
            artistName: "Phil Wickham and team",
          }),
          songLinks: song.songLinks,
          songAudio: song.songAudio,
        }),
      );
    });
    expect(store.getState().allDocs.allSongDocs[0]).toEqual(
      expect.objectContaining({
        _id: "song-1",
        _rev: "2-new",
        name: "Living Hope (Acoustic)",
      }),
    );
    expect(store.getState().allItems.list[0]).toEqual(
      expect.objectContaining({
        _id: "song-1",
        name: "Living Hope (Acoustic)",
      }),
    );
  });

  it("keeps the details drawer read-only for view access", () => {
    renderDrawer({ access: "view" });

    expect(
      screen.queryByRole("button", { name: "Edit details" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Phil Wickham")).toBeInTheDocument();
  });

  it("opens edit details for songs that have no saved links", () => {
    const songWithoutLinks = { ...song, songLinks: undefined };
    renderDrawer({ drawerSong: songWithoutLinks });

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));

    expect(screen.getByLabelText(/Song name/i)).toHaveValue("Living Hope");
    expect(screen.getByRole("button", { name: "Add link" })).toBeInTheDocument();
  });

  it("keeps MP3 metadata available when storage deletion fails", async () => {
    const put = jest.fn();
    const db = createMockPouchDB({
      get: jest.fn().mockResolvedValue({ ...song, _rev: "1-old" }),
      put,
    });
    mockDeleteSongAudio.mockRejectedValue(new Error("R2 is unavailable."));
    renderDrawer({ db });

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove MP3" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "R2 is unavailable.",
    );
    expect(mockDeleteSongAudio).toHaveBeenCalledWith({
      churchId: "church-1",
      songId: "song-1",
      audio: song.songAudio,
    });
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByText("living-hope-reference.mp3")).toBeInTheDocument();
  });

  it("does not delete the overwritten attachment when replacement metadata fails to persist", async () => {
    const replacementAudio = {
      ...song.songAudio!,
      fileName: "replacement.mp3",
      sizeBytes: 4 * 1024 * 1024,
      uploadedAt: "2026-08-09T12:00:00.000Z",
    };
    mockUploadSongAudio.mockResolvedValue(replacementAudio);
    const db = createMockPouchDB({
      get: jest.fn().mockResolvedValue({ ...song, _rev: "1-old" }),
      put: jest.fn().mockRejectedValue(new Error("Database unavailable.")),
    });
    renderDrawer({ db });

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByLabelText("Choose MP3"), {
      target: {
        files: [
          new File([new Uint8Array([1, 2, 3])], "replacement.mp3", {
            type: "audio/mpeg",
          }),
        ],
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Database unavailable.",
    );
    expect(mockUploadSongAudio).toHaveBeenCalledWith({
      churchId: "church-1",
      songId: "song-1",
      file: expect.any(File),
      previousAudio: song.songAudio,
    });
    expect(mockDeleteSongAudio).not.toHaveBeenCalled();
  });

  it("clears MP3 metadata only after storage deletion succeeds", async () => {
    const operations: string[] = [];
    mockDeleteSongAudio.mockImplementation(async () => {
      operations.push("delete");
      return { success: true };
    });
    const db = createMockPouchDB({
      get: jest.fn().mockResolvedValue({ ...song, _rev: "1-old" }),
      put: jest.fn().mockImplementation(async () => {
        operations.push("persist");
        return { ok: true, id: song._id, rev: "2-new" };
      }),
    });
    renderDrawer({ db });

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove MP3" }));

    await waitFor(() => expect(operations).toEqual(["delete", "persist"]));
  });
});
