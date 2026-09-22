import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext as AppGlobalInfoContext } from "../context/globalInfo";
import ResourcesPage from "./Resources";
import type { DBItem } from "../types";
import type { ChurchResource } from "../types/churchResource";
import {
  deleteChurchResource,
  deleteSongAudioWithRetry,
  getChurchResourceUrl,
  getSongAudioUrl,
  listChurchResources,
  updateChurchResource,
  uploadChurchResource,
} from "../api/auth";
import { updateAllDocs } from "../utils/dbUtils";

jest.mock("../components/AppPageShell/AppWorkspaceShell", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock("../api/auth", () => ({
  deleteChurchResource: jest.fn(),
  deleteSongAudioWithRetry: jest.fn(),
  getChurchResourceUrl: jest.fn(),
  getSongAudioUrl: jest.fn(),
  listChurchResources: jest.fn(),
  updateChurchResource: jest.fn(),
  uploadChurchResource: jest.fn(),
}));

jest.mock("../utils/dbUtils", () => ({
  updateAllDocs: jest.fn(),
}));

jest.mock("../utils/persistSongAudioAttachment", () => ({
  deleteSongAudioBeforeClearingMetadata: jest.fn(),
  persistSongAudioAttachment: jest.fn(),
}));

jest.mock("../store/store", () => ({
  broadcastItemUpdate: jest.fn(),
}));

let mockState: {
  allDocs: { allSongDocs: DBItem[] };
  undoable: { present: { preferences: { scrollbarWidth: number } } };
};
let mockSongDocs: DBItem[];
let mockResources: ChurchResource[];
let mockDb: { allDocs: jest.Mock };
let mockDispatch: jest.Mock;

jest.mock("../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

const mockUpdateAllDocs = jest.mocked(updateAllDocs);
const mockListChurchResources = jest.mocked(listChurchResources);
const mockGetSongAudioUrl = jest.mocked(getSongAudioUrl);

const song = (withAudio = true): DBItem => ({
  _id: "song-1",
  name: "Trust and Obey",
  type: "song",
  ...(withAudio
    ? {
      songAudio: {
        id: "audio-1",
        key: "churches/church-1/songs/song-1/audio-1.mp3",
        fileName: "rehearsal.mp3",
        contentType: "audio/mpeg" as const,
        sizeBytes: 200,
        uploadedAt: "2026-09-21T00:00:00.000Z",
      },
    }
    : {}),
} as DBItem);

const resource = {
  id: "resource-1",
  churchId: "church-1",
  name: "Guidelines.pdf",
  kind: "document" as const,
  storage: {
    key: "churches/church-1/files/resource-1/original",
    fileName: "Guidelines.pdf",
    contentType: "application/pdf",
    sizeBytes: 100,
    uploadedAt: "2026-09-21T00:00:00.000Z",
  },
  createdAt: "2026-09-21T00:00:00.000Z",
  createdBy: "user-1",
  updatedAt: "2026-09-21T00:00:00.000Z",
  updatedBy: "user-1",
} satisfies ChurchResource;

const renderPage = (access: "full" | "music" | "view" | "member" = "full") =>
  render(
    <AppGlobalInfoContext.Provider value={{ churchId: "church-1", churchName: "Church", access } as never}>
      <ControllerInfoContext.Provider value={{ db: mockDb } as never}>
        <ResourcesPage />
      </ControllerInfoContext.Provider>
    </AppGlobalInfoContext.Provider>,
  );

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

describe("Resources page", () => {
  beforeEach(() => {
    mockSongDocs = [song()];
    mockResources = [];
    mockState = {
      allDocs: { allSongDocs: [] },
      undoable: { present: { preferences: { scrollbarWidth: 0 } } },
    };
    mockDb = { allDocs: jest.fn() };
    mockDispatch = jest.fn((action: { type?: string; payload?: DBItem[] }) => {
      if (action.type === "allDocs/updateAllSongDocs") {
        mockState.allDocs.allSongDocs = action.payload || [];
      }
    });
    mockListChurchResources.mockResolvedValue({ success: true, resources: [] });
    mockGetSongAudioUrl.mockResolvedValue({ url: "https://audio.test/rehearsal.mp3", expiresAt: "2026-09-22T00:00:00.000Z" });
    mockUpdateAllDocs.mockImplementation(async (dispatch, _db, shouldApply) => {
      if (shouldApply && !shouldApply()) return false;
      mockState.allDocs.allSongDocs = mockSongDocs;
      dispatch({ type: "allDocs/updateAllSongDocs", payload: mockSongDocs });
      return true;
    });
    jest.mocked(deleteChurchResource).mockReset();
    jest.mocked(deleteSongAudioWithRetry).mockReset();
    jest.mocked(getChurchResourceUrl).mockReset();
    jest.mocked(updateChurchResource).mockReset();
    jest.mocked(uploadChurchResource).mockReset();
  });

  it("shows a pre-existing song MP3 on a fresh direct route with no ChurchResources", async () => {
    renderPage();

    expect(await screen.findByText("rehearsal.mp3")).toBeInTheDocument();
    expect(screen.getByText("Song attachment - Trust and Obey")).toBeInTheDocument();
    expect(mockUpdateAllDocs).toHaveBeenCalledWith(
      mockDispatch,
      mockDb,
      expect.any(Function),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Documents" }));
    expect(screen.getByText("No resources match this view.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("button", { name: /rehearsal\.mp3/i }));
    await waitFor(() => expect(mockGetSongAudioUrl).toHaveBeenCalledWith(expect.objectContaining({ songId: "song-1" })));
  });

  it("combines ChurchResources and song audio, and applies both filters", async () => {
    mockResources = [resource];
    mockListChurchResources.mockResolvedValue({ success: true, resources: mockResources });
    renderPage();

    expect(await screen.findByText("rehearsal.mp3")).toBeInTheDocument();
    expect(screen.getByText("Guidelines.pdf")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Audio" }));
    expect(screen.getByText("rehearsal.mp3")).toBeInTheDocument();
    expect(screen.queryByText("Guidelines.pdf")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Documents" }));
    expect(screen.queryByText("rehearsal.mp3")).not.toBeInTheDocument();
    expect(screen.getByText("Guidelines.pdf")).toBeInTheDocument();
  });

  it("sorts resources by the selected column and toggles direction", async () => {
    mockResources = [resource];
    mockListChurchResources.mockResolvedValue({ success: true, resources: mockResources });
    renderPage();

    expect(await screen.findByText("rehearsal.mp3")).toBeInTheDocument();
    const getResourceRows = () => screen.getAllByRole("button", { name: /^Preview / });
    expect(within(getResourceRows()[0]).getByText("Guidelines.pdf")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /Size/ }));
    expect(within(getResourceRows()[0]).getByText("Guidelines.pdf")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /Size/ }));
    expect(within(getResourceRows()[0]).getByText("rehearsal.mp3")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /Size/ }));
    expect(within(getResourceRows()[0]).getByText("Guidelines.pdf")).toBeInTheDocument();
  });

  it("keeps loading while song documents are unresolved", async () => {
    const songLoad = deferred<boolean>();
    mockUpdateAllDocs.mockReturnValue(songLoad.promise);
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading resources");
    expect(screen.queryByText("No resources match this view.")).not.toBeInTheDocument();

    songLoad.resolve(true);
    expect(await screen.findByText("No resources match this view.")).toBeInTheDocument();
  });

  it("shows a true empty state only after both sources load empty", async () => {
    mockSongDocs = [];
    renderPage();

    expect(await screen.findByText("No resources match this view.")).toBeInTheDocument();
  });

  it("keeps song audio visible when the generic resource request fails", async () => {
    mockListChurchResources.mockRejectedValue(new Error("Church files unavailable"));
    renderPage();

    expect(await screen.findByText("rehearsal.mp3")).toBeInTheDocument();
    expect(screen.getByText("Church files unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No resources match this view.")).not.toBeInTheDocument();
  });

  it("surfaces a song-library failure without presenting a true-empty state", async () => {
    mockUpdateAllDocs.mockResolvedValue(false);
    renderPage();

    expect(await screen.findByText("The song library could not be loaded. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("No resources match this view.")).not.toBeInTheDocument();
  });

  it("updates when a song attachment is removed from the store", async () => {
    const view = renderPage();
    expect(await screen.findByText("rehearsal.mp3")).toBeInTheDocument();

    mockState.allDocs.allSongDocs = [song(false)];
    view.rerender(
      <AppGlobalInfoContext.Provider value={{ churchId: "church-1", churchName: "Church", access: "full" } as never}>
        <ControllerInfoContext.Provider value={{ db: mockDb } as never}>
          <ResourcesPage />
        </ControllerInfoContext.Provider>
      </AppGlobalInfoContext.Provider>,
    );

    await waitFor(() => expect(screen.queryByText("rehearsal.mp3")).not.toBeInTheDocument());
    expect(screen.getByText("No resources match this view.")).toBeInTheDocument();
  });

  it("previews a PDF with the signed resource URL", async () => {
    mockResources = [resource];
    mockListChurchResources.mockResolvedValue({ success: true, resources: mockResources });
    jest.mocked(getChurchResourceUrl).mockResolvedValue({
      url: "https://abc.r2.cloudflarestorage.com/worshipsync-resources/guide.pdf",
      expiresAt: "2026-09-22T00:00:00.000Z",
    });
    renderPage();

    await userEvent.setup().click(await screen.findByRole("button", { name: /guidelines\.pdf/i }));

    expect(await screen.findByTitle("Guidelines.pdf")).toHaveAttribute(
      "src",
      "https://abc.r2.cloudflarestorage.com/worshipsync-resources/guide.pdf",
    );
    expect(getChurchResourceUrl).toHaveBeenCalledWith(
      expect.objectContaining({ churchId: "church-1", resourceId: "resource-1" }),
    );
  });

  it("keeps song-audio removal and uploads restricted to full access", async () => {
    renderPage("view");
    expect(await screen.findByText("rehearsal.mp3")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /rehearsal\.mp3/i }));

    expect(await screen.findByRole("dialog", { name: "rehearsal.mp3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove from song" })).not.toBeInTheDocument();
  });
});
