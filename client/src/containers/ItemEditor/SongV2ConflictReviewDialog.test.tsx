import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SongV2ConflictReviewDialog from "./SongV2ConflictReviewDialog";
import {
  buildSongV2RevisionSelection,
  loadSongV2ConflictComparisonDocuments,
  loadSongV2ConflictRevisionOptions,
  resolveSongV2ConflictReview,
  SongV2ConflictReviewStaleError,
  type SongV2ConflictRevisionOptions,
} from "../../utils/songV2ReplicationConflicts";
import { loadSongV2Snapshot, type SongV2Snapshot } from "../../utils/songPersistence";
import type {
  DBItem, SongV2ArrangementDocument, SongV2RootDocument, SongV2SlideDocument,
} from "../../types";

jest.mock("../../utils/songV2ReplicationConflicts", () => ({
  buildSongV2RevisionSelection: jest.fn(),
  loadSongV2ConflictComparisonDocuments: jest.fn(),
  loadSongV2ConflictRevisionOptions: jest.fn(),
  resolveSongV2ConflictReview: jest.fn(),
  SongV2ConflictReviewStaleError: class SongV2ConflictReviewStaleError extends Error {
    constructor(readonly songId: string) { super("stale review"); }
  },
}));

jest.mock("../../utils/songPersistence", () => ({
  loadSongV2Snapshot: jest.fn(),
}));

jest.mock("../../utils/overflow", () => ({
  formatSong: jest.fn((song: DBItem) => song),
}));

const DOC_ID = "song-v2:arrangement:song-1:arrangement-1";
const CURRENT_REV = "3-current";
const ALTERNATIVE_A = "3-branch-a";
const ALTERNATIVE_B = "3-branch-b";

const makeArrangementDocument = (revision: string, words: string): SongV2ArrangementDocument => ({
  _id: DOC_ID,
  _rev: revision,
  docType: "song-v2-arrangement",
  songId: "song-1",
  arrangementId: "arrangement-1",
  name: "Full Band",
  formattedLyrics: [{ id: "verse-1", name: "Verse 1", type: "Verse", words, slideSpan: 1 }],
  songOrder: [{ id: "verse-1", name: "Verse 1" }],
  slideIds: ["slide-1"],
});

const makeSong = (words: string): DBItem => ({
  _id: "song-1",
  type: "song",
  name: "Better",
  selectedArrangement: 0,
  shouldSendTo: { projector: true, monitor: true, stream: true },
  arrangements: [{
    id: "arrangement-1",
    name: "Full Band",
    formattedLyrics: words ? [{ id: "verse-1", name: "Verse 1", type: "Verse", words, slideSpan: 1 }] : [],
    songOrder: words ? [{ id: "verse-1", name: "Verse 1" }] : [],
    slides: [],
  }],
  slides: [],
}) as DBItem;

const makeSnapshot = (conflicts = true): SongV2Snapshot => ({
  root: {
    _id: "song-v2:root:song-1", _rev: "1-root", docType: "song-v2-root", songId: "song-1",
    songSchemaVersion: 2, name: "Better", selectedArrangement: 0, arrangementIds: ["arrangement-1"],
  } as SongV2RootDocument,
  arrangements: [makeArrangementDocument(CURRENT_REV, "It will get better")],
  slides: [] as SongV2SlideDocument[],
  hydrated: makeSong("It will get better"),
  ...(conflicts ? { conflicts: [{ documentId: DOC_ID, winningRevision: CURRENT_REV, revisions: [ALTERNATIVE_A, ALTERNATIVE_B] }] } : {}),
});

const optionEntry = (snapshot = makeSnapshot()): SongV2ConflictRevisionOptions => ({
  conflict: snapshot.conflicts![0],
  options: [
    { revision: CURRENT_REV, document: makeArrangementDocument(CURRENT_REV, "It will get better") },
    { revision: ALTERNATIVE_A, document: makeArrangementDocument(ALTERNATIVE_A, "It will get much better") },
    { revision: ALTERNATIVE_B, document: makeArrangementDocument(ALTERNATIVE_B, "It will get much brighter") },
  ],
});

const mockedBuildSelection = jest.mocked(buildSongV2RevisionSelection);
const mockedLoadComparisonDocuments = jest.mocked(loadSongV2ConflictComparisonDocuments);
const mockedLoadOptions = jest.mocked(loadSongV2ConflictRevisionOptions);
const mockedResolve = jest.mocked(resolveSongV2ConflictReview);
const mockedLoadSnapshot = jest.mocked(loadSongV2Snapshot);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("SongV2ConflictReviewDialog", () => {
  let snapshot: SongV2Snapshot;
  let onClose: jest.Mock;
  let onResolved: jest.Mock;
  let onConflictChanged: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    snapshot = makeSnapshot();
    onClose = jest.fn();
    onResolved = jest.fn();
    onConflictChanged = jest.fn();
    mockedLoadOptions.mockResolvedValue([optionEntry(snapshot)]);
    mockedLoadComparisonDocuments.mockResolvedValue({ arrangements: snapshot.arrangements, slides: [], missingArrangementIds: [], missingSlideIds: [] });
    mockedBuildSelection.mockImplementation(async (_db, _snapshot, _options, choices) => {
      const revision = choices[DOC_ID] ?? CURRENT_REV;
      const words = revision === CURRENT_REV ? "It will get better"
        : revision === ALTERNATIVE_A ? "It will get much better"
          : revision === ALTERNATIVE_B ? "It will get much brighter" : "";
      return { song: makeSong(words), sourceRevisions: { [DOC_ID]: revision } };
    });
    mockedResolve.mockResolvedValue({ song: makeSong("resolved"), conflictsRetired: true });
  });

  const dialogProps = (overrides: Partial<{
    db: PouchDB.Database;
    songId: string;
    snapshot: SongV2Snapshot | null;
    resolutionOwner: object;
    isOpen: boolean;
  }> = {}) => ({
    db: {} as PouchDB.Database,
    songId: "song-1",
    snapshot,
    resolutionOwner: {},
    isOpen: true,
    onClose,
    onResolved,
    onConflictChanged,
    ...overrides,
  });

  const renderDialog = (width = 1280, overrides: Parameters<typeof dialogProps>[0] = {}) => {
    window.innerWidth = width;
    return render(<SongV2ConflictReviewDialog {...dialogProps(overrides)} />);
  };

  it.each([[375, "mobile"], [1280, "desktop"]] as const)(
    "keeps alternatives in a compact vertical layout at %s px (%s)",
    async (width, _layout) => {
      renderDialog(width);
      const current = await screen.findByRole("radio", { name: "Keep currently saved version for Arrangement: Full Band" });
      expect(current).toBeChecked();
      expect(screen.getByRole("radio", { name: "Keep Alternative 1 for Arrangement: Full Band" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Keep Alternative 2 for Arrangement: Full Band" })).toBeInTheDocument();
      expect(screen.queryByText(DOC_ID)).not.toBeInTheDocument();
      expect(screen.queryByText(CURRENT_REV, { exact: false })).not.toBeInTheDocument();
      expect(screen.queryByText("Technical details")).not.toBeInTheDocument();
      expect(screen.queryByText(/unchanged sections/)).not.toBeInTheDocument();

      const alternatives = screen.getAllByRole("group", { name: /Alternative/ });
      expect(alternatives).toHaveLength(2);
      expect(alternatives[0]).toHaveClass("flex", "flex-col");
      expect(alternatives[0]).not.toHaveClass("grid-cols-2");
    },
  );

  it("keeps the saved reference fixed while inspecting and selecting alternatives independently", async () => {
    const user = userEvent.setup();
    renderDialog();
    const currentVersion = await screen.findByRole("radio", { name: "Keep currently saved version for Arrangement: Full Band" });
    const alternativeOne = screen.getByRole("radio", { name: "Keep Alternative 1 for Arrangement: Full Band" });
    const viewAlternativeTwo = screen.getByRole("button", { name: "View differences for Alternative 2 of Arrangement: Full Band" });

    expect(currentVersion).toBeChecked();
    expect(screen.getByText(/Viewing Alternative 1 against the currently saved version/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Added: much/)).toBeInTheDocument();
    expect(mockedBuildSelection).toHaveBeenCalledTimes(1);
    await user.click(viewAlternativeTwo);

    expect(currentVersion).toBeChecked();
    expect(alternativeOne).not.toBeChecked();
    expect(screen.getByText(/Viewing Alternative 2 against the currently saved version/)).toBeInTheDocument();
    expect(screen.getByLabelText("Differences for Arrangement: Full Band")).toHaveTextContent("brighter");
    expect(mockedBuildSelection).toHaveBeenCalledTimes(1);
    expect(mockedLoadComparisonDocuments).toHaveBeenCalledTimes(1);

    await user.click(alternativeOne);
    await waitFor(() => expect(alternativeOne).toBeChecked());
    expect(screen.getByText(/Viewing Alternative 2 against the currently saved version/)).toBeInTheDocument();
    expect(screen.getByText("Your selected version will:")).toBeInTheDocument();
    expect(screen.getByText("Use the changed lyrics in Full Band: Verse 1.")).toBeInTheDocument();
    expect(mockedLoadComparisonDocuments).toHaveBeenCalledTimes(1);
  });

  it("keeps manual text across version selection and saves it through the safe resolution path", async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByRole("radio", { name: "Keep currently saved version for Arrangement: Full Band" });
    await user.click(screen.getByRole("button", { name: "Edit final lyrics" }));
    const lyricsField = await screen.findByRole("textbox", { name: "Full Band Verse 1 lyrics" });
    await user.clear(lyricsField);
    await user.type(lyricsField, "Manual final line");

    await user.click(screen.getByRole("radio", { name: "Keep Alternative 1 for Arrangement: Full Band" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Full Band Verse 1 lyrics" })).toHaveValue("Manual final line"));
    expect(screen.getByText("Manual edits remain in your draft and will be applied when you save.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save resolution" }));
    await waitFor(() => expect(mockedResolve).toHaveBeenCalledTimes(1));
    const [, passedSnapshot, adopted, approved, sourceRevisions] = mockedResolve.mock.calls[0];
    expect(passedSnapshot).toBe(snapshot);
    expect(approved).toEqual(snapshot.conflicts);
    expect(sourceRevisions).toEqual({ [DOC_ID]: ALTERNATIVE_A });
    expect(adopted.arrangements[0].formattedLyrics[0].words).toBe("Manual final line");
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ name: "Better" }), expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not silently discard manual lyrics when the selected version removes their section", async () => {
    const user = userEvent.setup();
    mockedBuildSelection.mockImplementation(async (_db, _snapshot, _options, choices) => {
      const revision = choices[DOC_ID] ?? CURRENT_REV;
      return {
        song: revision === ALTERNATIVE_B ? makeSong("") : makeSong("It will get better"),
        sourceRevisions: { [DOC_ID]: revision },
      };
    });
    renderDialog();

    await screen.findByRole("radio", { name: "Keep currently saved version for Arrangement: Full Band" });
    await user.click(screen.getByRole("button", { name: "Edit final lyrics" }));
    const lyricsField = await screen.findByRole("textbox", { name: "Full Band Verse 1 lyrics" });
    await user.clear(lyricsField);
    await user.type(lyricsField, "Draft that must remain visible");
    await user.click(screen.getByRole("radio", { name: "Keep Alternative 2 for Arrangement: Full Band" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Some manual edits belong to sections missing from the selected version.");
    expect(screen.getByRole("button", { name: "Discard this edit" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save resolution" })).toBeDisabled();
    expect(mockedResolve).not.toHaveBeenCalled();
    expect(screen.getAllByText("Verse 1").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Hide lyric editor" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByRole("button", { name: "Discard this edit" })).toBeVisible();
  });

  it("reloads a stale review without changing the safe resolution behavior", async () => {
    const user = userEvent.setup();
    const latest = makeSnapshot();
    mockedResolve.mockRejectedValueOnce(new SongV2ConflictReviewStaleError("song-1"));
    mockedLoadSnapshot.mockResolvedValue(latest);
    renderDialog();

    await screen.findByRole("radio", { name: "Keep currently saved version for Arrangement: Full Band" });
    await user.click(screen.getByRole("button", { name: "Save resolution" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The song changed while you were reviewing. Compare the latest saved versions before saving again.");
    expect(onConflictChanged).toHaveBeenCalledWith(latest, expect.any(Object));
    expect(onResolved).not.toHaveBeenCalled();
    expect(mockedResolve).toHaveBeenCalledTimes(1);
    expect(mockedLoadComparisonDocuments).toHaveBeenCalledTimes(2);
  });

  it("finishes the original save but suppresses its result after switching items", async () => {
    const user = userEvent.setup();
    const ownerA = {};
    const ownerB = {};
    const dbA = { name: "church-a" } as PouchDB.Database;
    const pending = deferred<Awaited<ReturnType<typeof resolveSongV2ConflictReview>>>();
    mockedResolve.mockReturnValueOnce(pending.promise);
    const view = renderDialog(1280, { db: dbA, resolutionOwner: ownerA });

    await screen.findByRole("radio", { name: "Keep currently saved version for Arrangement: Full Band" });
    await user.click(screen.getByRole("button", { name: "Save resolution" }));
    await waitFor(() => expect(mockedResolve).toHaveBeenCalledTimes(1));
    expect(mockedResolve.mock.calls[0][0]).toBe(dbA);

    view.rerender(<SongV2ConflictReviewDialog {...dialogProps({
      db: dbA, songId: "song-2", resolutionOwner: ownerB,
    })} />);
    await act(async () => {
      pending.resolve({ song: makeSong("Resolved A"), conflictsRetired: true });
      await pending.promise;
    });

    expect(onResolved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("finishes the original database write but suppresses UI publication after a database switch", async () => {
    const user = userEvent.setup();
    const ownerA = {};
    const ownerB = {};
    const dbA = { name: "church-a" } as PouchDB.Database;
    const dbB = { name: "church-b" } as PouchDB.Database;
    const pending = deferred<Awaited<ReturnType<typeof resolveSongV2ConflictReview>>>();
    mockedResolve.mockReturnValueOnce(pending.promise);
    const view = renderDialog(1280, { db: dbA, resolutionOwner: ownerA });

    await screen.findByRole("radio", { name: "Keep currently saved version for Arrangement: Full Band" });
    await user.click(screen.getByRole("button", { name: "Save resolution" }));
    await waitFor(() => expect(mockedResolve).toHaveBeenCalledTimes(1));
    expect(mockedResolve.mock.calls[0][0]).toBe(dbA);

    view.rerender(<SongV2ConflictReviewDialog {...dialogProps({
      db: dbB, resolutionOwner: ownerB,
    })} />);
    await act(async () => {
      pending.resolve({ song: makeSong("Resolved A"), conflictsRetired: true });
      await pending.promise;
    });

    expect(onResolved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("allows a durable original save to settle after unmount without calling retired callbacks", async () => {
    const user = userEvent.setup();
    const ownerA = {};
    const dbA = { name: "church-a" } as PouchDB.Database;
    const pending = deferred<Awaited<ReturnType<typeof resolveSongV2ConflictReview>>>();
    mockedResolve.mockReturnValueOnce(pending.promise);
    const view = renderDialog(1280, { db: dbA, resolutionOwner: ownerA });

    await screen.findByRole("radio", { name: "Keep currently saved version for Arrangement: Full Band" });
    await user.click(screen.getByRole("button", { name: "Save resolution" }));
    await waitFor(() => expect(mockedResolve).toHaveBeenCalledTimes(1));
    expect(mockedResolve.mock.calls[0][0]).toBe(dbA);
    view.unmount();

    await act(async () => {
      pending.resolve({ song: makeSong("Resolved A"), conflictsRetired: true });
      await pending.promise;
    });

    expect(onResolved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers diagnostic identifiers only in the support section", async () => {
    const user = userEvent.setup();
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
    renderDialog();
    await screen.findByRole("radio", { name: "Keep currently saved version for Arrangement: Full Band" });
    expect(screen.queryByText(DOC_ID)).not.toBeInTheDocument();
    expect(screen.queryByText(CURRENT_REV)).not.toBeInTheDocument();

    await user.click(screen.getByText("Support information"));
    await user.click(screen.getByRole("button", { name: "Copy diagnostic information" }));
    expect(await screen.findByText("Diagnostic information copied.")).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(DOC_ID));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
  });
});
