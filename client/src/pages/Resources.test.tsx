/* eslint-disable testing-library/no-node-access -- Compare the rendered SVG from the mocked shell to the shared icon identity. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext as AppGlobalInfoContext } from "../context/globalInfo";
import { TransferProvider } from "../context/transferContext";
import ResourcesPage, { ResourceTableSkeleton } from "./Resources";
import type { DBItem } from "../types";
import type { ChurchResource } from "../types/churchResource";
import {
  deleteChurchResource,
  createExternalChurchResource,
  deleteSongAudioWithRetry,
  getChurchResourceUrl,
  getExternalResourceResolution,
  getChurchStorageQuota,
  getSongAudioUrl,
  listChurchResources,
  updateChurchResource,
  uploadChurchResource,
} from "../api/auth";
import { updateAllDocs } from "../utils/dbUtils";
import { PAGE_APPEARANCES } from "./pageAppearances";
import { getLucideIconInnerMarkup } from "../test/lucideIconTestUtils";

// Renderer behavior and binary fetching are covered by the shared preview tests.
jest.mock("../components/ContentPreview/DocxPreview", () => ({
  __esModule: true,
  default: () => <div role="document" aria-label="Word document preview" />,
}));

jest.mock("../components/AppPageShell/AppWorkspaceShell", () => ({
  __esModule: true,
  default: ({
    children,
    title,
    icon: PageIcon,
    iconColorClass,
  }: {
    children: ReactNode;
    title: string;
    icon: LucideIcon;
    iconColorClass?: string;
  }) => (
    <>
      <header>
        <h1>
          <span data-testid="workspace-title-icon" className={iconColorClass}>
            <PageIcon />
          </span>
          {title}
        </h1>
      </header>
      {children}
    </>
  ),
}));

jest.mock("../api/auth", () => ({
  createExternalChurchResource: jest.fn(),
  deleteChurchResource: jest.fn(),
  deleteSongAudioWithRetry: jest.fn(),
  getChurchResourceUrl: jest.fn(),
  getExternalResourceResolution: jest.fn(),
  getChurchStorageQuota: jest.fn(),
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
const mockDeleteChurchResource = jest.mocked(deleteChurchResource);
const mockListChurchResources = jest.mocked(listChurchResources);
const mockGetSongAudioUrl = jest.mocked(getSongAudioUrl);
const mockGetExternalResourceResolution = jest.mocked(getExternalResourceResolution);
const mockGetChurchStorageQuota = jest.mocked(getChurchStorageQuota);
const mockUploadChurchResource = jest.mocked(uploadChurchResource);
const mockCreateExternalChurchResource = jest.mocked(createExternalChurchResource);

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

const imageResource = {
  ...resource,
  id: "image-resource-1",
  name: "Profile.jpg",
  kind: "image" as const,
  storage: { ...resource.storage, key: "churches/church-1/files/image-resource-1/original", fileName: "Profile.jpg", contentType: "image/jpeg" },
} satisfies ChurchResource;

const externalResource = (
  id: string,
  name: string,
  kind: ChurchResource["kind"],
  url: string,
  mediaType: string,
  metadata: { mimeType?: string; fileName?: string; provider?: string } = {},
): ChurchResource => ({
  id,
  churchId: "church-1",
  name,
  kind,
  sourceType: "external",
  external: { url, provider: metadata.provider || "direct", mediaType, mimeType: metadata.mimeType, fileName: metadata.fileName },
  createdAt: "2026-09-21T00:00:00.000Z",
  createdBy: "user-1",
  updatedAt: "2026-09-21T00:00:00.000Z",
  updatedBy: "user-1",
});

const renderPage = (access: "full" | "music" | "view" | "member" = "full") =>
  render(
    <TransferProvider>
      <AppGlobalInfoContext.Provider value={{ churchId: "church-1", churchName: "Church", access } as never}>
        <ControllerInfoContext.Provider value={{ db: mockDb } as never}>
          <ResourcesPage />
        </ControllerInfoContext.Provider>
      </AppGlobalInfoContext.Provider>
    </TransferProvider>,
  );

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

describe("Resources page", () => {
  describe("compact layout", () => {
    const originalMatchMedia = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = jest.fn().mockReturnValue({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() });
      mockListChurchResources.mockResolvedValue({ success: true, resources: [resource] });
    });
    afterEach(() => { window.matchMedia = originalMatchMedia; });

    it("toggles the full compact resource name without opening a preview", async () => {
      const user = userEvent.setup();
      const name = "A very long resource filename that should stay on one line until touched.pdf";
      mockListChurchResources.mockResolvedValue({ success: true, resources: [{ ...resource, name }] });
      renderPage();
      const toggle = await screen.findByRole("button", { name: `Toggle full name for ${name}` });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(within(toggle).getByText(name)).toHaveClass("truncate");
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(within(toggle).getByText(name)).not.toHaveClass("truncate");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      toggle.focus();
      await user.keyboard("{Enter}");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      await user.keyboard(" ");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      jest.mocked(getChurchResourceUrl).mockResolvedValue({ url: "https://files.test/guide.pdf", expiresAt: new Date(Date.now() + 900000).toISOString() });
      await user.click(screen.getByRole("button", { name: `Preview ${name}` }));
      expect(screen.getByRole("dialog", { name })).toBeInTheDocument();
    });

    it.each(["Name", "Type", "Size", "Updated", "Source"])("shares %s sorting with the table including descending and default order", async (dimension) => {
      const user = userEvent.setup();
      const view = renderPage();
      await screen.findByRole("button", { name: "Preview Guidelines.pdf" });
      const order = () => screen.getAllByRole("button", { name: /^Preview / }).map((row) => row.getAttribute("aria-label"));
      const initial = order();
      let asc: (string | null)[] = [];
      let desc: (string | null)[] = [];
      for (const direction of ["ascending", "descending"] as const) {
        await user.click(screen.getByRole("button", { name: "Sort resources" }));
        await user.click(screen.getByRole("menuitemradio", { name: `${dimension} ${direction}` }));
        if (direction === "ascending") asc = order();
        else desc = order();
      }
      await user.click(screen.getByRole("button", { name: "Sort resources" }));
      await user.click(screen.getByRole("menuitemradio", { name: "Default order" }));
      expect(order()).toEqual(initial);
      view.unmount();
      window.matchMedia = originalMatchMedia;
      renderPage();
      await screen.findByRole("button", { name: "Preview Guidelines.pdf" });
      await user.click(screen.getByRole("button", { name: dimension }));
      expect(order()).toEqual(asc);
      await user.click(screen.getByRole("button", { name: dimension }));
      expect(order()).toEqual(desc);
    });

    it("keeps a filtered preview in mobile sort order", async () => {
      mockSongDocs = [];
      mockListChurchResources.mockResolvedValue({ success: true, resources: [resource, { ...resource, id: "second", name: "Second guide.pdf" }, imageResource] });
      jest.mocked(getChurchResourceUrl).mockResolvedValue({ url: "https://files.test/guide.pdf", expiresAt: new Date(Date.now() + 900000).toISOString() });
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole("button", { name: "Preview Guidelines.pdf" });
      await user.click(screen.getByRole("button", { name: "Documents" }));
      await user.type(screen.getByPlaceholderText("Search..."), "guide");
      await user.click(screen.getByRole("button", { name: "Sort resources" }));
      await user.click(screen.getByRole("menuitemradio", { name: "Name descending" }));
      await user.click(screen.getByRole("button", { name: "Preview Second guide.pdf" }));
      const preview = screen.getByRole("dialog", { name: "Second guide.pdf" });
      expect(within(preview).getByText("1 of 2")).toBeInTheDocument();
      await user.click(within(preview).getByRole("button", { name: "Next resource" }));
      expect(screen.getByRole("dialog", { name: "Guidelines.pdf" })).toBeInTheDocument();
    });

    it("preserves selection on a reference conflict and clears it on cancellation", async () => {
      mockDeleteChurchResource.mockRejectedValue(Object.assign(new Error("Used by a service plan"), { status: 409 }));
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole("button", { name: "Preview Guidelines.pdf" });
      await user.click(screen.getByRole("button", { name: "Select" }));
      await user.click(screen.getByRole("checkbox", { name: "Select Guidelines.pdf" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Delete selected (1)" }));
      await user.click(within(screen.getByRole("dialog", { name: "Delete resource?" })).getByRole("button", { name: "Cancel" }));
      expect(mockDeleteChurchResource).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Delete selected (1)" }));
      await user.click(within(screen.getByRole("dialog", { name: "Delete resource?" })).getByRole("button", { name: "Delete" }));
      await screen.findByText("Used by a service plan");
      expect(screen.getByRole("checkbox", { name: "Select Guidelines.pdf" })).toBeChecked();
      await user.click(screen.getByRole("button", { name: "Cancel selection" }));
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Select" }));
      expect(screen.getByRole("checkbox", { name: "Select Guidelines.pdf" })).not.toBeChecked();
    });

    it("downloads a song attachment with pending feedback and no destructive action", async () => {
      const download = deferred<{ url: string; expiresAt: string }>();
      mockGetSongAudioUrl.mockReturnValue(download.promise);
      const open = jest.spyOn(window, "open").mockImplementation(() => null);
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole("button", { name: "Actions for rehearsal.mp3" }));
      expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("menuitem", { name: "Download" }));
      expect(screen.getByRole("menuitem", { name: "Downloading…" })).toHaveAttribute("aria-disabled", "true");
      await act(async () => download.resolve({ url: "https://audio.test/download.mp3", expiresAt: "later" }));
      expect(open).toHaveBeenCalledWith("https://audio.test/download.mp3", "_blank", "noopener,noreferrer");
      expect(mockGetSongAudioUrl).toHaveBeenCalledWith(expect.objectContaining({ disposition: "attachment", songId: "song-1" }));
      open.mockRestore();
    });

    it("shows the existing load error and a genuine empty state on mobile", async () => {
      mockSongDocs = [];
      mockListChurchResources.mockRejectedValueOnce(new Error("Files unavailable"));
      const view = renderPage();
      await screen.findByRole("alert");
      expect(screen.getByText("Files unavailable")).toBeInTheDocument();
      expect(screen.queryByText("No resources match this view.")).not.toBeInTheDocument();
      view.unmount();
      mockListChurchResources.mockResolvedValue({ success: true, resources: [] });
      renderPage();
      expect(await screen.findByText("No resources match this view.")).toBeInTheDocument();
    });

    it("mounts one compact list, sorts it, and navigates that order", async () => {
      jest.mocked(getChurchResourceUrl).mockResolvedValue({ url: "https://files.test/guide.pdf", expiresAt: new Date(Date.now() + 900000).toISOString() });
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole("button", { name: "Preview Guidelines.pdf" });
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Sort resources/ }));
      await user.click(screen.getByRole("menuitemradio", { name: "Name descending" }));
      expect(screen.getAllByRole("button", { name: /^Preview / }).map((row) => row.getAttribute("aria-label"))).toEqual(["Preview rehearsal.mp3", "Preview Guidelines.pdf"]);
      await user.click(screen.getByRole("button", { name: "Preview rehearsal.mp3" }));
      const dialog = screen.getByRole("dialog", { name: "rehearsal.mp3" });
      expect(within(dialog).getByText("1 of 2")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Next resource" }));
      expect(screen.getByRole("dialog", { name: "Guidelines.pdf" })).toBeInTheDocument();
    });

    it("selects only church resources and confirms bulk deletion before exiting selection", async () => {
      mockDeleteChurchResource.mockResolvedValue({ success: true });
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole("button", { name: "Preview Guidelines.pdf" });
      await user.click(screen.getByRole("button", { name: "Select" }));
      expect(screen.queryByRole("checkbox", { name: "Select rehearsal.mp3" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Select all" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Delete selected (1)" }));
      const confirmation = screen.getByRole("dialog", { name: "Delete resource?" });
      expect(mockDeleteChurchResource).not.toHaveBeenCalled();
      await user.click(within(confirmation).getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(mockDeleteChurchResource).toHaveBeenCalledWith({ churchId: "church-1", resourceId: "resource-1" });
      expect(screen.queryByRole("button", { name: "Cancel selection" })).not.toBeInTheDocument();
    });

    it.each(["music", "view"] as const)("limits %s row actions without opening a preview", async (access) => {
      const user = userEvent.setup();
      renderPage(access);
      await user.click(await screen.findByRole("button", { name: "Actions for Guidelines.pdf" }));
      expect(screen.getByRole("menuitem", { name: "Download" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Select" })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("offers rename and delete for external links without inventing downloads", async () => {
      mockListChurchResources.mockResolvedValue({ success: true, resources: [externalResource("external", "Worship flow", "other", "https://example.test", "web", { provider: "google-drive" })] });
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole("button", { name: "Actions for Worship flow" }));
      expect(screen.queryByRole("menuitem", { name: "Download" })).not.toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
      await user.click(screen.getByRole("menuitem", { name: "Rename" }));
      expect(await screen.findByRole("textbox", { name: /Resource name/ })).toHaveValue("Worship flow");
    });

    it("renders compact loading without a wide table", () => {
      mockUpdateAllDocs.mockReturnValue(new Promise(() => {}));
      renderPage();
      expect(screen.getByRole("status")).toHaveTextContent("Loading resources");
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });
  });
  it("uses the shared Resources page icon identity", () => {
    renderPage();

    const title = screen.getByRole("heading", { name: "Resources" });
    const titleIcon = title.querySelector("svg");
    expect(titleIcon?.innerHTML).toBe(
      getLucideIconInnerMarkup(PAGE_APPEARANCES.resources.icon),
    );
    expect(screen.getByTestId("workspace-title-icon")).toHaveClass(
      PAGE_APPEARANCES.resources.iconColorClass,
    );
  });

  it.each(["asc", "desc"])("navigates the searched, filtered %s order and prepares only immediate neighbors", async (direction) => {
    mockSongDocs = [];
    const files = ["D", "A", "C", "B"].map((letter) => ({
      ...resource, id: letter, name: `${letter} Guide.pdf`, storage: { ...resource.storage, key: letter },
    }));
    mockListChurchResources.mockResolvedValue({ success: true, resources: [...files, { ...resource, id: "other", name: "Other.pdf" }, { ...imageResource, name: "Image Guide.jpg" }] });
    const getUrl = jest.mocked(getChurchResourceUrl);
    getUrl.mockImplementation(async ({ resourceId }) => ({ url: `https://files.test/${resourceId}.pdf`, expiresAt: new Date(Date.now() + 900_000).toISOString() }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: "Preview A Guide.pdf" });
    await user.click(screen.getByRole("button", { name: "Documents" }));
    await user.type(screen.getByPlaceholderText("Search..."), "Guide");
    await user.click(screen.getByRole("button", { name: "Name" }));
    if (direction === "desc") await user.click(screen.getByRole("button", { name: "Name" }));
    const order = direction === "asc" ? ["A", "B", "C", "D"] : ["D", "C", "B", "A"];
    await user.click(screen.getByRole("button", { name: `Preview ${order[1]} Guide.pdf` }));
    const dialog = screen.getByRole("dialog", { name: `${order[1]} Guide.pdf` });
    expect(within(dialog).getByText("2 of 4")).toBeInTheDocument();
    await waitFor(() => expect(getUrl).toHaveBeenCalledTimes(3));
    expect(getUrl.mock.calls.map(([args]) => args.resourceId).sort()).toEqual(order.slice(0, 3).sort());
    await user.click(within(dialog).getByRole("button", { name: "Expand preview" }));
    within(dialog).getByRole("button", { name: "Next resource" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: `${order[2]} Guide.pdf` })).toBe(dialog);
    expect(within(dialog).getByText("3 of 4")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Exit expanded preview" })).toBeInTheDocument();
    await waitFor(() => expect(getUrl).toHaveBeenCalledTimes(4));
    expect(getUrl.mock.calls.filter(([args]) => args.resourceId === order[2])).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: "Next resource" }));
    expect(within(dialog).getByRole("button", { name: "Next resource" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Previous resource" }));
    await user.click(within(dialog).getByRole("button", { name: "Previous resource" }));
    await user.click(within(dialog).getByRole("button", { name: "Previous resource" }));
    expect(within(dialog).getByText("1 of 4")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Previous resource" })).toBeDisabled();
    expect(getUrl).toHaveBeenCalledTimes(4);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Select A Guide.pdf" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: /Delete selected/ })).not.toBeInTheDocument();
  });

  it.each(["uploaded PDF", "uploaded DOCX", "Google Doc", "SharePoint"])("reopens %s without resolving its valid source again", async (kind) => {
    mockSongDocs = [];
    const entry = kind === "Google Doc" || kind === "SharePoint"
      ? externalResource("cached", "Cached guide", "document", kind === "Google Doc" ? "https://docs.google.com/document/d/cached/edit" : "https://church.sharepoint.com/:b:/s/team/Ecached?e=token", "document")
      : { ...resource, name: "Cached guide", storage: { ...resource.storage, fileName: kind === "uploaded DOCX" ? "guide.docx" : "guide.pdf", contentType: kind === "uploaded DOCX" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf" } };
    mockListChurchResources.mockResolvedValue({ success: true, resources: [entry] });
    const expiry = new Date(Date.now() + 900_000).toISOString();
    jest.mocked(getChurchResourceUrl).mockResolvedValue({ url: "https://files.test/cached", expiresAt: expiry });
    mockGetExternalResourceResolution.mockResolvedValue({ originalUrl: entry.sourceType === "external" ? entry.external.url : "", provider: kind === "Google Doc" ? "google-drive" : "sharepoint", sourceKind: "file", mimeType: "application/pdf", previewUrl: "https://worshipsync.test/api/resources/proxy?token=cached", expiresAt: expiry });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Preview Cached guide" }));
    await waitFor(() => expect(screen.queryByText(/Preparing preview/)).not.toBeInTheDocument());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Preview Cached guide" }));
    await waitFor(() => expect(screen.queryByText(/Preparing preview/)).not.toBeInTheDocument());
    expect(jest.mocked(getChurchResourceUrl).mock.calls.length + mockGetExternalResourceResolution.mock.calls.length).toBe(1);
  });

  it("refreshes an expiring upload source on reopen", async () => {
    mockSongDocs = [];
    mockListChurchResources.mockResolvedValue({ success: true, resources: [resource] });
    const getUrl = jest.mocked(getChurchResourceUrl);
    getUrl.mockResolvedValueOnce({ url: "https://files.test/old.pdf", expiresAt: new Date(Date.now() + 30_000).toISOString() })
      .mockResolvedValue({ url: "https://files.test/fresh.pdf", expiresAt: new Date(Date.now() + 900_000).toISOString() });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Preview Guidelines.pdf" }));
    expect(await screen.findByTitle("Guidelines.pdf")).toHaveAttribute("src", "https://files.test/old.pdf");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Preview Guidelines.pdf" }));
    expect(await screen.findByTitle("Guidelines.pdf")).toHaveAttribute("src", "https://files.test/fresh.pdf");
    expect(getUrl).toHaveBeenCalledTimes(2);
  });

  it("keeps navigation disabled while a resource name is being edited", async () => {
    mockSongDocs = [];
    mockListChurchResources.mockResolvedValue({ success: true, resources: [resource, { ...resource, id: "other", name: "Other.pdf" }] });
    jest.mocked(getChurchResourceUrl).mockResolvedValue({ url: "https://files.test/guide.pdf", expiresAt: new Date(Date.now() + 900_000).toISOString() });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Preview Guidelines.pdf" }));
    await user.click(screen.getByRole("button", { name: "More preview actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.getByRole("button", { name: "Next resource" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel rename" }));
    expect(screen.getByRole("button", { name: "Next resource" })).toBeEnabled();
  });

  beforeEach(() => {
    mockGetChurchStorageQuota.mockClear();
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
    mockGetChurchStorageQuota.mockResolvedValue({
      success: true,
      quotas: {
        r2: { used: 3.5 * 1024 ** 2, limit: 500 * 1024 ** 2, unit: "bytes" },
        cloudinary: { used: 0, limit: 500 * 1024 ** 2, unit: "bytes" },
        mux: { used: 0, limit: 1_000, unit: "minutes" },
      },
    });
    mockUploadChurchResource.mockResolvedValue(resource);
    mockCreateExternalChurchResource.mockReset();
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
    mockGetExternalResourceResolution.mockReset();
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

  it("adds and displays an external resource with its provider and external size", async () => {
    const externalResource: ChurchResource = {
      id: "external-1",
      churchId: "church-1",
      name: "Team guide",
      kind: "document",
      sourceType: "external",
      external: {
        url: "https://docs.google.com/document/d/guide/edit",
        provider: "google-drive",
        mimeType: "application/pdf",
        fileName: "team-guide.pdf",
        mediaType: "document",
      },
      createdAt: "2026-09-21T00:00:00.000Z",
      createdBy: "user-1",
      updatedAt: "2026-09-21T00:00:00.000Z",
      updatedBy: "user-1",
    };
    mockCreateExternalChurchResource.mockResolvedValue(externalResource);
    renderPage();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Add resource" }));
    await userEvent.setup().click(screen.getByRole("menuitem", { name: "Add external link" }));
    const dialog = await screen.findByRole("dialog", { name: "Add external link" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByPlaceholderText("https://"), externalResource.external.url);
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Add resource" }));

    expect(await screen.findByText("Team guide")).toBeInTheDocument();
    expect(screen.getByText("Google Drive")).toBeInTheDocument();
    expect(screen.getByText("External")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Size" }));
    expect(screen.getByText("Team guide")).toBeInTheDocument();
    expect(mockCreateExternalChurchResource).toHaveBeenCalledWith(expect.objectContaining({
      churchId: "church-1",
      url: externalResource.external.url,
    }));
    mockGetExternalResourceResolution.mockResolvedValue({
      originalUrl: externalResource.external.url,
      externalUrl: externalResource.external.url,
      provider: "google-drive",
      sourceKind: "file",
      title: "Team guide",
      filename: "team-guide.pdf",
      mimeType: "application/pdf",
      mediaType: "document",
      previewType: "document",
      previewUrl: "https://preview.test/guide.pdf",
      requiresProxy: true,
      canPreview: true,
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "Preview Team guide" }));
    expect(await screen.findByRole("dialog", { name: "Team guide" })).toBeInTheDocument();
    expect(mockGetExternalResourceResolution).toHaveBeenCalledWith(externalResource.external.url);
    expect(screen.getByRole("button", { name: "Open in new tab" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "More preview actions" }));
    expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Download" })).not.toBeInTheDocument();
  });

  it("keeps an external resource visible when the server blocks deletion due to plan references", async () => {
    const externalResource: ChurchResource = {
      id: "external-2",
      churchId: "church-1",
      name: "Plan guide",
      kind: "document",
      sourceType: "external",
      external: { url: "https://example.com/guide", provider: "direct" },
      createdAt: "2026-09-21T00:00:00.000Z",
      createdBy: "user-1",
      updatedAt: "2026-09-21T00:00:00.000Z",
      updatedBy: "user-1",
    };
    mockResources = [externalResource];
    mockListChurchResources.mockResolvedValue({ success: true, resources: mockResources });
    mockDeleteChurchResource.mockRejectedValue(Object.assign(
      new Error("This resource is used by 1 Service Plan. Remove it from the plan before deleting it."),
      { status: 409 },
    ));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByLabelText("Select Plan guide"));
    await user.click(screen.getByRole("button", { name: "Delete selected (1)" }));
    const confirmation = await screen.findByRole("dialog", { name: /Delete resource/ });
    await user.click(within(confirmation).getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("button", { name: "Preview Plan guide" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/used by 1 Service Plan/i);
  });

  it("shows the church R2 quota independently of the visible resources", async () => {
    mockListChurchResources.mockResolvedValue({ success: true, resources: [] });
    renderPage();
    expect(await screen.findByText("File storage: 3.5 MB / 500 MB")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Show storage usage details" }));
    expect(screen.getByRole("region", { name: "File storage" })).toHaveTextContent("3.5 MB / 500 MB");
    expect(screen.getByText("496.5 MB remaining")).toBeInTheDocument();
    expect(mockGetChurchStorageQuota).toHaveBeenCalledWith("church-1");
  });

  it("refreshes R2 usage after a successful Resources upload", async () => {
    const user = userEvent.setup();
    mockUploadChurchResource.mockResolvedValue(resource);
    renderPage();
    const trigger = await screen.findByRole("button", { name: "Add resource" });
    expect(trigger).toHaveAttribute("data-slot", "dropdown-menu-trigger");
    expect(trigger).toHaveAttribute("data-variant", "presentCta");
    await user.click(trigger);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Add external link" })).toBeInTheDocument();
    expect(within(menu).queryByRole("button")).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Upload file" }));
    const dialog = await screen.findByRole("dialog", { name: "Upload resources" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText("Select resource files"), new File(["guide"], "guide.pdf", { type: "application/pdf" }));
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(mockGetChurchStorageQuota).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Upload file" }));
    await screen.findByRole("dialog", { name: "Upload resources" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("restores an active minimized upload from Add resource without starting another upload", async () => {
    const user = userEvent.setup();
    const pending = deferred<ChurchResource>();
    mockUploadChurchResource.mockReturnValue(pending.promise);
    renderPage();
    const trigger = await screen.findByRole("button", { name: "Add resource" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Upload file" }));
    await screen.findByRole("dialog", { name: "Upload resources" });
    await user.upload(screen.getByLabelText("Select resource files"), new File(["guide"], "guide.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await user.click(screen.getByRole("button", { name: "Minimize resource upload to button" }));
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Upload file" }));
    expect(await screen.findByRole("dialog", { name: "Upload resources" })).toHaveAttribute("aria-busy", "true");
    expect(mockUploadChurchResource).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(resource));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Uploading..." })).not.toBeInTheDocument();
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

  it("shows uploaded JPEG resources in the Images filter", async () => {
    mockResources = [resource, imageResource];
    mockListChurchResources.mockResolvedValue({ success: true, resources: mockResources });
    renderPage();
    expect(await screen.findByText("Profile.jpg")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Images" }));
    expect(screen.getByText("Profile.jpg")).toBeInTheDocument();
    expect(screen.queryByText("Guidelines.pdf")).not.toBeInTheDocument();
  });

  it("filters only documents and audio while keeping other external resources under All", async () => {
    const externalDocument = externalResource("external-doc", "Volunteer guide", "document", "https://docs.example.test/guide", "document");
    const externalAudio = externalResource("external-audio", "Rehearsal MP3", "audio", "https://files.example.test/rehearsal.mp3", "audio");
    const externalImage = externalResource("external-image", "Service image", "other", "https://files.example.test/slide.png", "image");
    const externalVideo = externalResource("external-video", "Service video", "other", "https://files.example.test/clip.mp4", "video");
    const externalWeb = externalResource("external-web", "Reference site", "other", "https://example.test/page", "web");
    mockResources = [resource, externalDocument, externalAudio, externalImage, externalVideo, externalWeb];
    mockListChurchResources.mockResolvedValue({ success: true, resources: mockResources });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Service image")).toBeInTheDocument();
    expect(screen.getByText("Service video")).toBeInTheDocument();
    expect(screen.getByText("Reference site")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Documents" }));
    expect(screen.getByText("Guidelines.pdf")).toBeInTheDocument();
    expect(screen.getByText("Volunteer guide")).toBeInTheDocument();
    expect(screen.queryByText("Service image")).not.toBeInTheDocument();
    expect(screen.queryByText("Service video")).not.toBeInTheDocument();
    expect(screen.queryByText("Reference site")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Audio" }));
    expect(screen.getByText("Rehearsal MP3")).toBeInTheDocument();
    expect(screen.getByText("rehearsal.mp3")).toBeInTheDocument();
    expect(screen.queryByText("Volunteer guide")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Service image")).toBeInTheDocument();
    expect(screen.getByText("Service video")).toBeInTheDocument();
    expect(screen.getByText("Reference site")).toBeInTheDocument();
  });

  it.each([
    [externalResource("external-web-label", "Reference site", "other", "https://example.test/page", "web"), "Web"],
    [externalResource("external-video-label", "Service video", "other", "https://example.test/clip", "video"), "Video"],
    [externalResource("external-image-label", "Service image", "other", "https://example.test/slide", "image"), "Image"],
    [externalResource("external-unknown-label", "Unsupported link", "other", "https://example.test/unknown", "unknown"), "Link"],
    [externalResource("external-pdf-label", "Guide PDF", "document", "https://example.test/guide.pdf", "document", { mimeType: "application/pdf", fileName: "guide.pdf" }), "PDF"],
    [externalResource("external-docx-label", "Guide DOCX", "document", "https://example.test/guide.docx", "document", { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName: "guide.docx" }), "DOCX"],
  ] as const)("labels %s as %s", async (external, expectedLabel) => {
    const fetchMock = expectedLabel === "DOCX"
      ? jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false } as Response)
      : undefined;
    mockResources = [external];
    mockListChurchResources.mockResolvedValue({ success: true, resources: mockResources });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: new RegExp(`Preview ${external.name}`) }));
    expect(await screen.findByText(new RegExp(`${expectedLabel} · External · Updated`))).toBeInTheDocument();
    fetchMock?.mockRestore();
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

  it("uses the Resources table columns and row spacing for its loading skeleton", () => {
    render(<ResourceTableSkeleton />);
    const loadingTable = within(screen.getByRole("region", { name: "Loading resources" })).getByRole("table", { name: "Resource list loading" });
    expect(within(loadingTable).getAllByRole("row")).toHaveLength(6);
    expect(within(loadingTable).getAllByRole("columnheader")).toHaveLength(6);
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
      <TransferProvider>
        <AppGlobalInfoContext.Provider value={{ churchId: "church-1", churchName: "Church", access: "full" } as never}>
          <ControllerInfoContext.Provider value={{ db: mockDb } as never}>
            <ResourcesPage />
          </ControllerInfoContext.Provider>
        </AppGlobalInfoContext.Provider>
      </TransferProvider>,
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

    await userEvent.setup().click(screen.getByRole("button", { name: "More preview actions" }));
    expect(await screen.findByRole("menuitem", { name: "Download" })).toBeInTheDocument();
    expect(screen.getByText("WorshipSync • PDF")).toBeVisible();
    expect(screen.getByText(/PDF · 100 B · Updated/)).toBeVisible();
    expect(await screen.findByTitle("Guidelines.pdf")).toHaveAttribute(
      "src",
      "https://abc.r2.cloudflarestorage.com/worshipsync-resources/guide.pdf",
    );
    expect(getChurchResourceUrl).toHaveBeenCalledWith(
      expect.objectContaining({ churchId: "church-1", resourceId: "resource-1" }),
    );
  });

  it("previews an uploaded DOCX as a document and keeps download available", async () => {
    mockResources = [{ ...resource, name: "Guidelines.docx", storage: {
      ...resource.storage, fileName: "Guidelines.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    } }];
    mockListChurchResources.mockResolvedValue({ success: true, resources: mockResources });
    jest.mocked(getChurchResourceUrl).mockResolvedValue({ url: "https://r2.example.test/opaque?signature=secret", expiresAt: "2026-09-22T00:00:00.000Z" });
    renderPage();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Preview Guidelines.docx" }));
    expect(await screen.findByRole("document", { hidden: true })).toBeInTheDocument();
    expect(screen.getByText("WorshipSync • Document")).toBeVisible();
    expect(screen.getByText(/DOCX · 100 B · Updated/)).toBeVisible();
    expect(screen.queryByTitle("Guidelines.docx")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "More preview actions" }));
    expect(screen.getByRole("menuitem", { name: "Download" })).toBeInTheDocument();
  });

  it("keeps song-audio removal and uploads restricted to full access", async () => {
    renderPage("view");
    expect(await screen.findByText("rehearsal.mp3")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /rehearsal\.mp3/i }));

    expect(await screen.findByRole("dialog", { name: "rehearsal.mp3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove from song" })).not.toBeInTheDocument();
  });

  it("uses the styled confirmation modal before deleting a church resource", async () => {
    mockResources = [resource];
    mockListChurchResources.mockResolvedValue({ success: true, resources: mockResources });
    let resolveDelete!: (result: { success: true }) => void;
    jest.mocked(deleteChurchResource).mockImplementation(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }));
    renderPage();

    await userEvent.setup().click(await screen.findByRole("button", { name: /Preview Guidelines\.pdf/i }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "More preview actions" }));
    const deleteAction = await screen.findByRole("menuitem", { name: "Delete" });
    expect(deleteAction).toHaveAttribute("data-variant", "destructive");
    expect(screen.getByRole("menuitem", { name: "Download" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual([
      "Download",
      "Rename",
      "Delete",
    ]);
    await userEvent.setup().click(deleteAction);

    const confirmation = await screen.findByRole("dialog", { name: "Delete resource?" });
    expect(confirmation).toHaveTextContent("Guidelines.pdf");
    await userEvent.setup().click(within(confirmation).getByRole("button", { name: "Delete" }));
    expect(within(confirmation).getByRole("button", { name: "Delete" })).toHaveAttribute("data-variant", "presentDestructive");
    expect(confirmation).toHaveAttribute("aria-busy", "true");
    expect(within(confirmation).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(within(confirmation).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.setup().click(within(confirmation).getByRole("button", { name: "Delete" }));
    expect(deleteChurchResource).toHaveBeenCalledTimes(1);
    await userEvent.setup().keyboard("{Escape}");
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("dialog", { name: "Delete resource?" })).toBeInTheDocument();
    resolveDelete({ success: true });
    await waitFor(() => expect(deleteChurchResource).toHaveBeenCalledWith({ churchId: "church-1", resourceId: "resource-1" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete resource?" })).not.toBeInTheDocument());
    await waitFor(() => expect(mockGetChurchStorageQuota).toHaveBeenCalledTimes(2));
  });

  it("supports selecting multiple church resources for deletion", async () => {
    const secondResource = { ...resource, id: "resource-2", name: "Second guide.pdf" };
    mockResources = [resource, secondResource];
    mockListChurchResources.mockResolvedValue({ success: true, resources: mockResources });
    jest.mocked(deleteChurchResource).mockResolvedValue({ success: true });
    renderPage();

    expect(await screen.findByText("Second guide.pdf")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Select Guidelines.pdf" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Second guide.pdf" }));
    await user.click(screen.getByRole("button", { name: "Delete selected (2)" }));

    const confirmation = await screen.findByRole("dialog", { name: "Delete resource?" });
    expect(within(confirmation).getByRole("button", { name: "Delete" })).toHaveAttribute("data-variant", "presentDestructive");
    expect(within(confirmation).getByText("Guidelines.pdf")).toBeInTheDocument();
    expect(within(confirmation).getByText("Second guide.pdf")).toBeInTheDocument();
  });

  it("does not open a desktop preview when operating a selection checkbox with the keyboard", async () => {
    mockListChurchResources.mockResolvedValue({ success: true, resources: [resource] });
    const user = userEvent.setup();
    renderPage();
    const checkbox = await screen.findByRole("checkbox", { name: "Select Guidelines.pdf" });
    checkbox.focus();
    await user.keyboard(" ");
    expect(checkbox).toBeChecked();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
