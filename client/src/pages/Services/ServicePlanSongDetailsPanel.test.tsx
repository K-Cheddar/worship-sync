import { applyItemDocumentChange } from "../../store/allDocsSlice";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, useSelector } from "react-redux";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import allDocsReducer from "../../store/allDocsSlice";
import itemLibraryUiReducer from "../../store/itemLibraryUiSlice";
import {
  createMockControllerContext,
  createMockGlobalContext,
  createMockPouchDB,
} from "../../test/mocks";
import type { DBItem } from "../../types";
import ServicePlanSongDetailsPanel from "./ServicePlanSongDetailsPanel";

jest.mock("../../containers/ItemEditor/LyricsEditor", () => ({
  __esModule: true,
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div role="dialog" aria-label="Lyrics editor">
        <button type="button" onClick={onClose}>Close lyrics editor</button>
      </div>
    ) : null,
}));

jest.mock("../../components/SongSections/SongArrangementSectionsPanel", () => ({
  __esModule: true,
  default: () => <div>Lyrics and arrangements</div>,
}));

const song = {
  _id: "song-1",
  _rev: "1-old",
  name: "Living Hope",
  type: "song",
  selectedArrangement: 0,
  arrangements: [],
  slides: [],
  shouldSendTo: { projector: true, monitor: true, stream: true },
  songMetadata: {
    source: "manual",
    trackName: "Living Hope",
    artistName: "Phil Wickham",
    albumName: "Living Hope",
    key: "A",
    importedAt: "2026-08-06T12:00:00.000Z",
  },
} as DBItem;

const getLegacySong = (document: DBItem = song) => jest.fn(async (id: string) => {
  if (id === document._id) return { ...document };
  throw Object.assign(new Error(`missing ${id}`), { status: 404, name: "not_found" });
});

const StoreBackedPanel = ({
  fallbackSong,
  onEditingChange,
}: {
  fallbackSong: DBItem;
  onEditingChange: (isEditing: boolean) => void;
}) => {
  const currentSong = useSelector(
    (state: { allDocs: { allSongDocs: DBItem[] } }) =>
      state.allDocs.allSongDocs.find((item) => item._id === fallbackSong._id) ??
      fallbackSong,
  );
  return (
    <ServicePlanSongDetailsPanel
      song={currentSong}
      canEdit
      onEditingChange={onEditingChange}
    />
  );
};

const renderPanel = (
  db: ReturnType<typeof createMockPouchDB>,
  onEditingChange = jest.fn(),
) => {
  const store = configureStore({
    reducer: {
      allDocs: allDocsReducer,
      itemLibraryUi: itemLibraryUiReducer,
    },
  });
  const originalPut = db.put;
  db.put = jest.fn(async (doc: any) => {
    const result = await originalPut(doc);
    store.dispatch(applyItemDocumentChange({ id: doc._id, doc: { ...doc, _rev: result.rev } }));
    return result;
  }) as typeof db.put;
  render(
    <Provider store={store}>
      <ControllerInfoContext.Provider
        value={createMockControllerContext({ db }) as never}
      >
        <GlobalInfoContext.Provider
          value={createMockGlobalContext({ churchId: "church-1" }) as never}
        >
          <StoreBackedPanel
            fallbackSong={song}
            onEditingChange={onEditingChange}
          />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    </Provider>,
  );
  return { onEditingChange, store };
};

describe("ServicePlanSongDetailsPanel", () => {
  it("exits edit mode, updates visible details, and notifies its parent after saving", async () => {
    const put = jest.fn().mockResolvedValue({ ok: true, id: song._id, rev: "2-new" });
    const db = createMockPouchDB({
      get: getLegacySong(),
      put,
    });
    const { onEditingChange } = renderPanel(db);

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByLabelText(/Song name/i), {
      target: { value: "Living Hope (Acoustic)" },
    });
    fireEvent.change(screen.getByLabelText(/Artist/i), {
      target: { value: "Phil Wickham and team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Living Hope (Acoustic)",
          songMetadata: expect.objectContaining({
            artistName: "Phil Wickham and team",
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(onEditingChange).toHaveBeenLastCalledWith(false),
    );
    expect(screen.queryByLabelText(/Song name/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Living Hope (Acoustic)" })).toBeInTheDocument();
    expect(screen.getByText("Phil Wickham and team")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("keeps the entered values and edit mode after a rejected save", async () => {
    const db = createMockPouchDB({
      get: getLegacySong(),
      put: jest.fn().mockRejectedValue(new Error("Database unavailable.")),
    });
    const { onEditingChange } = renderPanel(db);

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByLabelText(/Song name/i), {
      target: { value: "Pending song name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Database unavailable.",
    );
    expect(screen.getByLabelText(/Song name/i)).toHaveValue("Pending song name");
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
  });

  it("still opens the separate lyrics editor from the details panel", () => {
    renderPanel(createMockPouchDB());

    fireEvent.click(screen.getByRole("button", { name: "Edit lyrics" }));

    expect(screen.getByRole("dialog", { name: "Lyrics editor" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Lyrics and arrangements" }),
    ).toBeInTheDocument();
  });
});
