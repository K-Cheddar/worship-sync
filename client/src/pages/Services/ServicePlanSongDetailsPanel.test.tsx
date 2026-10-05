import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ServicePlanSongDetailsPanel from "./ServicePlanSongDetailsPanel";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import * as songPersistence from "../../utils/songPersistence";
import type { DBItem } from "../../types";

jest.mock("../../hooks", () => ({ useDispatch: () => jest.fn() }));
jest.mock("../../components/SongSections/SongArrangementSectionsPanel", () => () => null);
jest.mock("../../components/ItemDetailsModal/ItemDetailsModal", () => ({
  ItemDetailsEditorFields: ({ onSave }: { onSave: (payload: { name: string }) => void }) => (
    <button type="button" onClick={() => onSave({ name: "Updated song" })}>
      Save details patch
    </button>
  ),
}));
jest.mock("../../containers/ItemEditor/LyricsEditor", () => ({
  __esModule: true,
  default: ({
    isOpen,
    song,
    onSaveLyrics,
  }: {
    isOpen: boolean;
    song: DBItem;
    onSaveLyrics: (patch: { baselineSong: DBItem; arrangements: DBItem["arrangements"]; selectedArrangement: number }) => void;
  }) => isOpen ? (
    <button
      type="button"
      onClick={() => onSaveLyrics({
        baselineSong: song,
        arrangements: song.arrangements,
        selectedArrangement: 0,
      })}
    >
      Save lyrics patch
    </button>
  ) : null,
}));

describe("ServicePlanSongDetailsPanel song persistence", () => {
  afterEach(() => jest.restoreAllMocks());

  const song = {
    _id: "song-1",
    type: "song",
    name: "Living Hope",
    selectedArrangement: 0,
    arrangements: [{
      id: "arr-1",
      name: "Master",
      formattedLyrics: [],
      songOrder: [],
      slides: [],
    }],
    slides: [],
  } as unknown as DBItem;

  const renderPanel = (db: object) => render(
    <ControllerInfoContext.Provider value={{ db } as never}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <ServicePlanSongDetailsPanel song={song} canEdit />
      </GlobalInfoContext.Provider>
    </ControllerInfoContext.Provider>,
  );

  it("loads and saves detail patches through songPersistence", async () => {
    const db = {};
    const saved = { ...song, name: "Updated song" };
    jest.spyOn(songPersistence, "loadSong").mockResolvedValue(song);
    const save = jest.spyOn(songPersistence, "saveSong").mockResolvedValue(saved);
    renderPanel(db);

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.click(screen.getByRole("button", { name: "Save details patch" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(songPersistence.loadSong).toHaveBeenCalledWith(db, song._id);
    expect(save).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ name: "Updated song" }),
      song,
    );
  });

  it("loads and saves lyric patches through songPersistence", async () => {
    const db = {};
    jest.spyOn(songPersistence, "loadSong").mockResolvedValue(song);
    const save = jest.spyOn(songPersistence, "saveSong").mockResolvedValue(song);
    renderPanel(db);

    fireEvent.click(screen.getByRole("button", { name: "Edit lyrics" }));
    fireEvent.click(screen.getByRole("button", { name: "Save lyrics patch" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(songPersistence.loadSong).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        arrangements: song.arrangements,
        selectedArrangement: 0,
      }),
      song,
    );
  });
});
