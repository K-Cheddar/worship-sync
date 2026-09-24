import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalInfoContext } from "../../context/globalInfo";
import { getChurchResource, getChurchResourceUrl, listChurchResources } from "../../api/auth";
import ServicePlanContentPanel from "./ServicePlanContentPanel";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlanElement } from "../../types/servicePlan";

let mockSongDocs: Array<Record<string, unknown>> = [];
let mockAllFreeFormDocs: Array<{ _id: string; name: string; type: string; slides: unknown[] }> = [];
const mockGetChurchResource = jest.mocked(getChurchResource);
const mockGetChurchResourceUrl = jest.mocked(getChurchResourceUrl);
const mockListChurchResources = jest.mocked(listChurchResources);
jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ allDocs: { allSongDocs: mockSongDocs, allFreeFormDocs: mockAllFreeFormDocs } }),
}));

jest.mock("../../api/auth", () => ({
  getChurchResource: jest.fn(),
  getChurchResourceUrl: jest.fn(),
  getSongAudioUrl: jest.fn(),
  listChurchResources: jest.fn(),
}));

jest.mock("./ServicePlanLibraryPicker", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("./ServicePlanCustomDocumentPicker", () => ({
  __esModule: true,
  default: ({ onSelectDocument }: { onSelectDocument: (document: never) => void }) => (
    <div role="dialog" aria-label="Add custom document">
      {mockAllFreeFormDocs.map((document) => (
        <button key={document._id} type="button" onClick={() => onSelectDocument(document as never)}>
          Pick {document.name}
        </button>
      ))}
    </div>
  ),
}));

jest.mock("./ServicePlanScripturePopover", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../../components/YouTubePlaylistPlayer/YouTubePlaylistPlayer", () => ({
  __esModule: true,
  default: () => <div aria-label="YouTube player" />,
}));

jest.mock("../../components/ContentPreview/ContentPreviewDialog", () => ({
  __esModule: true,
  default: ({ resource }: { resource: { title?: string; url?: string } | null }) => resource ? (
    <div role="dialog" aria-label="Content preview">{resource.title || resource.url}</div>
  ) : null,
}));

const element = (overrides: Partial<ServicePlanElement> = {}): ServicePlanElement => ({
  id: "element-1",
  type: "free",
  title: plainTextToRichText("Special Music"),
  ...overrides,
});

describe("ServicePlanContentPanel resources", () => {
  beforeEach(() => {
    mockSongDocs = [];
    mockAllFreeFormDocs = [];
    mockGetChurchResource.mockReset();
    mockGetChurchResourceUrl.mockReset();
    mockListChurchResources.mockReset();
  });

  it("uses the shared rich-text toolbar while editing a text resource", async () => {
    const user = userEvent.setup();
    render(<ServicePlanContentPanel element={element()} allowEdit onUpdate={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Add resource" }));
    await user.click(screen.getByRole("menuitem", { name: "Text / Notes" }));

    expect(screen.getByRole("toolbar", { name: "Note formatting" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
  });

  it("adds multiple resources and removes one without touching the other", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    const { rerender } = render(<ServicePlanContentPanel element={element()} allowEdit onUpdate={onUpdate} />);

    await user.click(screen.getByRole("button", { name: "Add resource" }));
    await user.click(screen.getByRole("menuitem", { name: "Text / Notes" }));
    await user.type(screen.getByLabelText(/Title/), "Sermon notes");
    await user.type(screen.getByRole("textbox", { name: "Notes" }), "Welcome the guest speaker.");
    await user.click(screen.getByRole("button", { name: "Add resource" }));

    const firstResources = onUpdate.mock.calls.at(-1)?.[0].resources;
    expect(firstResources).toHaveLength(1);
    expect(firstResources[0]).toMatchObject({
      type: "text",
      title: "Sermon notes",
      data: { text: plainTextToRichText("Welcome the guest speaker.") },
    });
    rerender(<ServicePlanContentPanel element={element({ resources: firstResources })} allowEdit onUpdate={onUpdate} />);

    await user.click(screen.getByRole("button", { name: "Add resource" }));
    await user.click(screen.getByRole("menuitem", { name: "Link" }));
    await user.type(screen.getByLabelText(/Title/), "Offering instructions");
    await user.type(screen.getByLabelText(/URL/), "https://example.com/offering");
    await user.click(screen.getByRole("button", { name: "Add resource" }));

    const secondResources = onUpdate.mock.calls.at(-1)?.[0].resources;
    expect(secondResources).toHaveLength(2);
    expect(secondResources[0].title).toBe("Sermon notes");
    expect(secondResources[1].title).toBe("Offering instructions");
    expect(secondResources[1].type).toBe("url");

    rerender(
      <ServicePlanContentPanel
        element={element({ resources: secondResources })}
        allowEdit
        onUpdate={onUpdate}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Remove resource Sermon notes" }));
    expect(onUpdate.mock.calls.at(-1)?.[0].resources).toEqual([secondResources[1]]);
  });

  it("renders YouTube resources with the shared player and unknown resources safely", () => {
    render(
      <ServicePlanContentPanel
        element={element({
          resources: [
            {
              id: "youtube-1",
              type: "youtube",
              title: "Rehearsal video",
              provider: "youtube",
              mediaId: "dQw4w9WgXcQ",
              url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            },
            { id: "future-1", type: "future-provider", title: "Future resource" },
          ],
        })}
        allowEdit={false}
        onUpdate={jest.fn()}
      />,
    );

    expect(screen.getByText("Rehearsal video")).toBeInTheDocument();
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    expect(screen.getByText("Future resource")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("opens a linked resource in the viewer from the editable content panel", async () => {
    const user = userEvent.setup();
    const url = "https://www.dropbox.com/scl/fi/example/video.mp4";
    render(
      <ServicePlanContentPanel
        element={element({
          resources: [{ id: "link-1", type: "url", title: url, url }],
        })}
        allowEdit
        onUpdate={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: `Preview ${url}` }));

    expect(screen.getByRole("dialog", { name: "Content preview" })).toHaveTextContent(url);
  });

  it("attaches an existing song MP3 by reference", async () => {
    mockSongDocs = [{
      _id: "song-1",
      name: "Special Music",
      type: "song",
      songAudio: {
        id: "audio-1",
        fileName: "accompaniment.mp3",
        key: "churches/church-1/songs/song-1/audio-1.mp3",
        contentType: "audio/mpeg",
        sizeBytes: 100,
        uploadedAt: "2026-01-01T00:00:00.000Z",
      },
    }];
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    render(<ServicePlanContentPanel element={element()} allowEdit onUpdate={onUpdate} />);

    await user.click(screen.getByRole("button", { name: "Add resource" }));
    await user.click(screen.getByRole("menuitem", { name: "Media / MP3" }));
    await user.click(screen.getByRole("button", { name: /accompaniment\.mp3/ }));

    expect(onUpdate).toHaveBeenCalledWith({
      resources: [expect.objectContaining({
        type: "audio",
        mediaId: "audio-1",
        data: { songId: "song-1", audioId: "audio-1" },
      })],
    });
  });

  it("searches files and previews one before attaching it", async () => {
    mockListChurchResources.mockResolvedValue({
      success: true,
      resources: [
        {
          id: "file-1",
          churchId: "church-1",
          name: "Service guide",
          kind: "document",
          storage: {
            key: "churches/church-1/files/file-1/original",
            fileName: "guide.pdf",
            contentType: "application/pdf",
            sizeBytes: 100,
            uploadedAt: "2026-01-01T00:00:00.000Z",
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: "user-1",
          updatedAt: "2026-01-01T00:00:00.000Z",
          updatedBy: "user-1",
        },
        {
          id: "file-2",
          churchId: "church-1",
          name: "Volunteer notes",
          kind: "document",
          storage: {
            key: "churches/church-1/files/file-2/original",
            fileName: "notes.txt",
            contentType: "text/plain",
            sizeBytes: 50,
            uploadedAt: "2026-01-01T00:00:00.000Z",
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: "user-1",
          updatedAt: "2026-01-01T00:00:00.000Z",
          updatedBy: "user-1",
        },
      ],
    });
    mockGetChurchResourceUrl.mockResolvedValue({
      url: "https://example.test/file-1.pdf",
      expiresAt: "2026-01-01T00:15:00.000Z",
    });
    const user = userEvent.setup();
    const onUpdate = jest.fn();

    render(
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <ServicePlanContentPanel element={element()} allowEdit onUpdate={onUpdate} />
      </GlobalInfoContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Add resource" }));
    await user.click(screen.getByRole("menuitem", { name: "File" }));

    expect(await screen.findByRole("dialog", { name: "Choose a file" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search files" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Search files" }), "guide");
    expect(screen.getByRole("button", { name: /^Service guide/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Volunteer notes/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview file Service guide" }));
    expect(screen.getByRole("dialog", { name: "Content preview" })).toHaveTextContent("Service guide");
    expect(onUpdate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Service guide/ }));
    expect(onUpdate).toHaveBeenCalledWith({
      resources: [expect.objectContaining({
        type: "document",
        data: { resourceId: "file-1" },
      })],
    });
  });

  it("fetches only referenced ChurchResources and renders a referenced MP3 as audio", async () => {
    mockGetChurchResource.mockResolvedValue({
      success: true,
      resource: {
        id: "churchResource_mp3",
        churchId: "church-1",
        name: "Rehearsal track",
        kind: "audio",
        storage: {
          key: "churches/church-1/files/churchResource_mp3/original",
          fileName: "rehearsal.mp3",
          contentType: "audio/mpeg",
          sizeBytes: 100,
          uploadedAt: "2026-01-01T00:00:00.000Z",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "user-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: "user-1",
      },
    });
    mockGetChurchResourceUrl.mockResolvedValue({
      url: "https://example.test/transient-resource-url",
      expiresAt: "2026-01-01T00:15:00.000Z",
    });
    render(
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <ServicePlanContentPanel
          element={element({
            resources: [{
              id: "resource-ref-1",
              type: "document",
              title: "Church resource",
              data: { resourceId: "churchResource_mp3" },
            }],
          })}
          allowEdit={false}
          onUpdate={jest.fn()}
        />
      </GlobalInfoContext.Provider>,
    );

    await waitFor(() => expect(mockGetChurchResource).toHaveBeenCalledWith("church-1", "churchResource_mp3"));
    expect(mockListChurchResources).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("rehearsal.mp3")).toBeInTheDocument();
    expect(screen.getByText("Audio")).toBeInTheDocument();
    expect(mockGetChurchResourceUrl).toHaveBeenCalledWith({
      churchId: "church-1",
      resourceId: "churchResource_mp3",
    });
  });

  it("keeps legacy song and scripture attachments visible and detachable", async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    render(
      <ServicePlanContentPanel
        element={element({
          songRefs: [{ kind: "library", songId: "song-1", songName: "Welcome Song" }],
          scriptureRefs: [{
            label: "John 3:16 (NIV)",
            book: "John",
            chapter: "3",
            verseRange: "16",
            version: "NIV",
          }],
        })}
        allowEdit
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByText("Welcome Song")).toBeInTheDocument();
    expect(screen.getByText("John 3:16 (NIV)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove song Welcome Song" }));
    expect(onUpdate).toHaveBeenCalledWith({ songRef: undefined, songRefs: [] });
    await user.click(screen.getByRole("button", { name: "Remove scripture John 3:16 (NIV)" }));
    expect(onUpdate).toHaveBeenCalledWith({ scriptureRef: undefined, scriptureRefs: [] });
  });

  it("attaches multiple custom documents by ordered id references and removes one", async () => {
    mockAllFreeFormDocs = [
      { _id: "doc-1", name: "Welcome Slides", type: "free", slides: [{ text: "not copied" }] },
      { _id: "doc-2", name: "Prayer Guide", type: "free", slides: [{ text: "not copied" }] },
    ];
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    const { rerender } = render(
      <ServicePlanContentPanel element={element()} allowEdit onUpdate={onUpdate} />,
    );

    await user.click(screen.getByRole("button", { name: "Add custom document" }));
    await user.click(screen.getByRole("button", { name: "Pick Welcome Slides" }));
    const firstResources = onUpdate.mock.calls.at(-1)?.[0].resources;
    expect(firstResources).toHaveLength(1);
    expect(firstResources[0]).toMatchObject({
      type: "custom-document",
      title: "Welcome Slides",
      data: { customDocumentId: "doc-1" },
    });
    expect(firstResources[0]).not.toHaveProperty("slides");

    rerender(
      <ServicePlanContentPanel
        element={element({ resources: firstResources })}
        allowEdit
        onUpdate={onUpdate}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Pick Prayer Guide" }));
    const orderedResources = onUpdate.mock.calls.at(-1)?.[0].resources;
    expect(orderedResources.map((resource: { data: { customDocumentId: string } }) => resource.data.customDocumentId)).toEqual([
      "doc-1",
      "doc-2",
    ]);

    rerender(
      <ServicePlanContentPanel
        element={element({ resources: orderedResources })}
        allowEdit
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByText("Welcome Slides")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove custom document Welcome Slides" }));
    expect(onUpdate.mock.calls.at(-1)?.[0].resources).toEqual([orderedResources[1]]);
  });

});
