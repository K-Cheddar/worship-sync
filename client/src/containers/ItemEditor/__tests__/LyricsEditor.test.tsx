import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ToastData } from "../../../components/Toast/ToastContainer";
import LyricsEditor from "../LyricsEditor";
import { ToastContext } from "../../../context/toastContext";

type ShowToastArg = string | Omit<ToastData, "id">;

const mockDispatch = jest.fn();
let mockState: any;
let lastLyricBoxesProps: any;
let lastLyricSectionToolsProps: any;
let lastSectionPreviewProps: any;
let lastAddSongSectionsDrawerProps: any;
let lastArrangementProps: any[];
let mockGeneratedIdCounter = 0;

const mockSetIsEditMode = jest.fn((value: boolean) => ({
  type: "item/setIsEditMode",
  payload: value,
}));
const mockUpdateArrangements = jest.fn((payload: any) => ({
  type: "item/updateArrangements",
  payload,
}));
const mockDiscardPendingRemoteItem = jest.fn(() => ({
  type: "item/discardPendingRemoteItem",
}));
const mockApplyPendingRemoteItem = jest.fn(() => ({
  type: "item/applyPendingRemoteItem",
}));
const mockSetSongMetadata = jest.fn((value: unknown) => ({
  type: "item/setSongMetadata",
  payload: value,
}));
const mockFormatSong = jest.fn((item: any) => item);
let mockShowToast: jest.Mock<string, [ShowToastArg]> = jest.fn<string, [ShowToastArg]>(() => "toast-1");
let mockRemoveToast = jest.fn();

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
  useCurrentItem: () => mockState.undoable.present.item,
}));

jest.mock("../../../store/itemSlice", () => ({
  setIsEditMode: (value: boolean) => mockSetIsEditMode(value),
  updateArrangements: (payload: any) => mockUpdateArrangements(payload),
  discardPendingRemoteItem: () => mockDiscardPendingRemoteItem(),
  applyPendingRemoteItem: () => mockApplyPendingRemoteItem(),
  setSongMetadata: (value: unknown) => mockSetSongMetadata(value),
}));

jest.mock("../../../store/preferencesSlice", () => ({
  setFormattedLyrics: jest.fn((n: number) => ({
    type: "preferences/setFormattedLyrics",
    payload: n,
  })),
}));

jest.mock("../../../utils/overflow", () => ({
  formatSong: (item: any) => mockFormatSong(item),
  formatSection: jest.fn(() => []),
}));

jest.mock("../../../utils/generateRandomId", () => ({
  __esModule: true,
  default: () => {
    mockGeneratedIdCounter += 1;
    return `generated-id-${mockGeneratedIdCounter}`;
  },
}));

jest.mock("../LyricBoxes", () => ({
  __esModule: true,
  default: (props: any) => {
    lastLyricBoxesProps = props;
    return <div data-testid="lyric-boxes" />;
  },
}));

jest.mock("../LyricSectionTools", () => ({
  __esModule: true,
  default: (props: any) => {
    lastLyricSectionToolsProps = props;
    return (
      <div data-testid="lyric-section-tools">
        <button type="button" onClick={() => props.onAddEmptySection("Bridge")}>
          Add empty section
        </button>
        <button type="button" onClick={props.onOpenImportDrawer}>
          Import from song
        </button>
      </div>
    );
  },
}));

jest.mock("../SongSections", () => ({
  __esModule: true,
  default: () => <div data-testid="song-sections" />,
}));

jest.mock("../Arrangement", () => ({
  __esModule: true,
  default: (props: any) => {
    lastArrangementProps.push(props);
    return (
      <li data-testid="arrangement-item">
        <span>{props.arrangement.name}</span>
        <button
          type="button"
          onClick={() =>
            props.setLocalArrangements([
              ...props.localArrangements,
              {
                ...props.arrangement,
                id: "copied-arrangement",
                name: `${props.arrangement.name} copy`,
              },
            ])
          }
        >
          Copy {props.arrangement.name}
        </button>
      </li>
    );
  },
}));

jest.mock("../SectionPreview", () => ({
  __esModule: true,
  default: (props: any) => {
    lastSectionPreviewProps = props;
    return <div data-testid="section-preview" />;
  },
}));

jest.mock("../AddSongSectionsDrawer", () => ({
  __esModule: true,
  default: (props: any) => {
    lastAddSongSectionsDrawerProps = props;
    return props.isOpen ? <div data-testid="add-song-sections-drawer" /> : null;
  },
}));

jest.mock("../../../components/ErrorBoundary/ErrorBoundary", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../../../components/Modal/Modal", () => ({
  __esModule: true,
  default: ({
    isOpen,
    children,
    title,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    title?: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title || "modal"}>
        {children}
      </div>
    ) : null,
}));

const makeBaseState = (overrides: Partial<any> = {}) => {
  const base = {
    allDocs: {
      allSongDocs: [],
    },
    allItems: {
      isAllItemsLoading: false,
    },
    undoable: {
      present: {
        item: {
          name: "Sample Song",
          type: "song",
          isEditMode: true,
          selectedArrangement: 0,
          arrangements: [
            {
              id: "arr-1",
              name: "Master",
              slides: [],
              formattedLyrics: [],
              songOrder: [],
            },
          ],
        },
        preferences: {
          formattedLyricsPerRow: 3,
        },
      },
    },
  };

  return {
    ...base,
    ...overrides,
    undoable: {
      ...base.undoable,
      ...(overrides as any).undoable,
      present: {
        ...base.undoable.present,
        ...((overrides as any).undoable?.present || {}),
        item: {
          ...base.undoable.present.item,
          ...((overrides as any).undoable?.present?.item || {}),
        },
        preferences: {
          ...base.undoable.present.preferences,
          ...((overrides as any).undoable?.present?.preferences || {}),
        },
      },
    },
  };
};

const renderWithToastContext = () =>
  render(
    <ToastContext.Provider
      value={{
        showToast: mockShowToast,
        removeToast: mockRemoveToast,
      }}
    >
      <LyricsEditor />
    </ToastContext.Provider>
  );

/** LyricsEditorPanel mounts after a deferred tick; wait before interacting. */
const waitForLyricsEditorPanelReady = () =>
  waitFor(() => {
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

describe("LyricsEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = makeBaseState();
    lastLyricBoxesProps = null;
    lastLyricSectionToolsProps = null;
    lastSectionPreviewProps = null;
    lastAddSongSectionsDrawerProps = null;
    lastArrangementProps = [];
    mockShowToast = jest.fn<string, [ShowToastArg]>(() => "toast-1");
    mockRemoveToast = jest.fn();
    mockFormatSong.mockImplementation((item: any) => item);
    mockGeneratedIdCounter = 0;
  });

  it("returns null when edit mode is disabled", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            isEditMode: false,
          },
        },
      },
    });

    const { container } = render(<LyricsEditor />);

    expect(container).toBeEmptyDOMElement();
  });

  it("dispatches save actions and updates arrangements using formatted song result", async () => {
    const formattedResult = {
      arrangements: [
        {
          id: "arr-1",
          name: "Master",
          slides: [{ id: "slide-1", boxes: [] }],
          formattedLyrics: [],
          songOrder: [],
        },
      ],
      selectedArrangement: 0,
    };
    mockFormatSong.mockReturnValue(formattedResult);

    render(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mockSetIsEditMode).toHaveBeenCalledWith(false);
    expect(mockFormatSong).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sample Song",
        selectedArrangement: 0,
      })
    );
    expect(mockUpdateArrangements).toHaveBeenCalledWith({
      arrangements: formattedResult.arrangements,
      selectedArrangement: 0,
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/setIsEditMode",
      payload: false,
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/updateArrangements",
      payload: {
        arrangements: formattedResult.arrangements,
        selectedArrangement: 0,
      },
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/setSongMetadata",
      payload: undefined,
    });
  });

  it("closes immediately on cancel when there are no pending changes", async () => {
    render(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockSetIsEditMode).toHaveBeenCalledWith(false);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/setIsEditMode",
      payload: false,
    });
  });

  it("shows confirmation modal when cancelling with unsaved changes", async () => {
    render(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    fireEvent.click(screen.getByRole("button", { name: "Copy Master" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByText(/you have unsaved changes\. are you sure you want to leave/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave Without Saving" }));

    expect(mockSetIsEditMode).toHaveBeenCalledWith(false);
  });

  it("keeps the selected section pinned by id after lyrics reorder", async () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            arrangements: [
              {
                id: "arr-1",
                name: "Master",
                slides: [],
                formattedLyrics: [
                  {
                    id: "verse-1",
                    type: "Verse",
                    name: "Verse",
                    words: "Verse words",
                    slideSpan: 1,
                  },
                  {
                    id: "chorus-1",
                    type: "Chorus",
                    name: "Chorus",
                    words: "Chorus words",
                    slideSpan: 1,
                  },
                ],
                songOrder: [
                  { id: "order-1", name: "Verse" },
                  { id: "order-2", name: "Chorus" },
                ],
              },
            ],
          },
        },
      },
    });

    render(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    await waitFor(() => {
      expect(lastLyricBoxesProps.selectedSectionId).toBe("verse-1");
    });

    act(() => {
      lastLyricBoxesProps.onSectionSelect("chorus-1");
    });

    await waitFor(() => {
      expect(lastLyricBoxesProps.selectedSectionId).toBe("chorus-1");
    });

    act(() => {
      lastLyricBoxesProps.reformatLyrics([
        {
          id: "verse-1",
          type: "Verse",
          name: "Verse",
          words: "Verse words",
          slideSpan: 1,
        },
        {
          id: "chorus-1",
          type: "Bridge",
          name: "Bridge",
          words: "Chorus words",
          slideSpan: 1,
        },
      ]);
    });

    await waitFor(() => {
      expect(lastLyricBoxesProps.selectedSectionId).toBe("chorus-1");
    });

    expect(lastLyricBoxesProps.recentlyMovedSectionId).toBe("chorus-1");
    expect(lastSectionPreviewProps.selectedSection.id).toBe("chorus-1");
    expect(lastSectionPreviewProps.selectedSection.name).toBe("Bridge");
  });

  it("falls back to the first remaining section when the selected section is deleted", async () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            arrangements: [
              {
                id: "arr-1",
                name: "Master",
                slides: [],
                formattedLyrics: [
                  {
                    id: "verse-1",
                    type: "Verse",
                    name: "Verse",
                    words: "Verse words",
                    slideSpan: 1,
                  },
                  {
                    id: "chorus-1",
                    type: "Chorus",
                    name: "Chorus",
                    words: "Chorus words",
                    slideSpan: 1,
                  },
                ],
                songOrder: [
                  { id: "order-1", name: "Verse" },
                  { id: "order-2", name: "Chorus" },
                ],
              },
            ],
          },
        },
      },
    });

    render(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    await waitFor(() => {
      expect(lastLyricBoxesProps.selectedSectionId).toBe("verse-1");
    });

    act(() => {
      lastLyricBoxesProps.onFormattedLyricsDelete(0);
    });

    await waitFor(() => {
      expect(lastLyricBoxesProps.selectedSectionId).toBe("chorus-1");
    });

    expect(lastSectionPreviewProps.selectedSection.id).toBe("chorus-1");
  });

  it("shows the newly selected song immediately when reopening edit lyrics after switching items", async () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            _id: "song-a",
            name: "Song A",
            isEditMode: true,
            selectedArrangement: 0,
            arrangements: [
              {
                id: "arr-a",
                name: "Master",
                slides: [],
                formattedLyrics: [
                  {
                    id: "song-a-verse",
                    type: "Verse",
                    name: "Verse 1",
                    words: "Song A words",
                    slideSpan: 1,
                  },
                ],
                songOrder: [{ id: "order-a", name: "Verse 1" }],
              },
            ],
          },
        },
      },
    });

    const { rerender } = render(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    await waitFor(() => {
      expect(screen.getByText("Song A")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(lastLyricBoxesProps.formattedLyrics[0].id).toBe("song-a-verse");
    });

    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            _id: "song-b",
            name: "Song B",
            isEditMode: false,
            selectedArrangement: 0,
            arrangements: [
              {
                id: "arr-b",
                name: "Master",
                slides: [],
                formattedLyrics: [
                  {
                    id: "song-b-chorus",
                    type: "Chorus",
                    name: "Chorus 1",
                    words: "Song B words",
                    slideSpan: 1,
                  },
                ],
                songOrder: [{ id: "order-b", name: "Chorus 1" }],
              },
            ],
          },
        },
      },
    });

    rerender(<LyricsEditor />);

    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            _id: "song-b",
            name: "Song B",
            isEditMode: true,
            selectedArrangement: 0,
            arrangements: [
              {
                id: "arr-b",
                name: "Master",
                slides: [],
                formattedLyrics: [
                  {
                    id: "song-b-chorus",
                    type: "Chorus",
                    name: "Chorus 1",
                    words: "Song B words",
                    slideSpan: 1,
                  },
                ],
                songOrder: [{ id: "order-b", name: "Chorus 1" }],
              },
            ],
          },
        },
      },
    });

    rerender(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    await waitFor(() => {
      expect(screen.getByText("Song B")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(lastLyricBoxesProps.formattedLyrics[0].id).toBe("song-b-chorus");
    });
    await waitFor(() => {
      expect(lastLyricBoxesProps.formattedLyrics[0].words).toBe("Song B words");
    });

    expect(screen.queryByText("Song A")).not.toBeInTheDocument();
  });

  it("offers toast actions for buffered remote updates while editing", async () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            _id: "song-remote",
            hasRemoteUpdate: true,
            hasPendingUpdate: true,
            pendingRemoteItem: {
              _id: "song-remote",
              type: "song",
              arrangements: [
                {
                  id: "arr-1",
                  name: "Master",
                  slides: [],
                  formattedLyrics: [],
                  songOrder: [],
                },
              ],
            },
          },
        },
      },
    });

    renderWithToastContext();
    await waitForLyricsEditorPanelReady();

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalled();
    });

    const [toastArg] = mockShowToast.mock.calls[0];
    const renderToastChildren = typeof toastArg === "object" && toastArg !== null ? toastArg["children"] : undefined;
    if (typeof renderToastChildren !== "function") {
      throw new Error("expected showToast with object payload and children render function");
    }
    render(<>{renderToastChildren("toast-1")}</>);

    fireEvent.click(screen.getByRole("button", { name: "Keep Editing Mine" }));

    expect(mockDiscardPendingRemoteItem).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/discardPendingRemoteItem",
    });
    expect(mockRemoveToast).toHaveBeenCalledWith("toast-1");
  });

  it("applies a buffered remote song immediately when the lyrics editor has no local changes", async () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            _id: "song-remote",
            hasRemoteUpdate: true,
            hasPendingUpdate: false,
            pendingRemoteItem: {
              _id: "song-remote",
              type: "song",
              selectedArrangement: 0,
              arrangements: [
                {
                  id: "arr-1",
                  name: "Master",
                  slides: [],
                  formattedLyrics: [],
                  songOrder: [],
                },
              ],
            },
          },
        },
      },
    });

    renderWithToastContext();
    await waitForLyricsEditorPanelReady();

    await waitFor(() => {
      expect(mockApplyPendingRemoteItem).toHaveBeenCalled();
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/applyPendingRemoteItem",
    });
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("adds an empty section and appends it to song order by default", async () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            arrangements: [
              {
                id: "arr-1",
                name: "Master",
                slides: [],
                formattedLyrics: [
                  {
                    id: "verse-1",
                    type: "Verse",
                    name: "Verse",
                    words: "Verse words",
                    slideSpan: 1,
                  },
                ],
                songOrder: [{ id: "order-1", name: "Verse" }],
              },
            ],
          },
        },
      },
    });

    render(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    act(() => {
      lastLyricSectionToolsProps.onAddEmptySection("Bridge");
    });

    await waitFor(() => {
      expect(
        lastLyricBoxesProps.formattedLyrics.find(
          (section: { id: string }) => section.id === "generated-id-1",
        ),
      ).toEqual(
        expect.objectContaining({
          id: "generated-id-1",
          type: "Bridge",
          name: "Bridge",
          words: "",
        }),
      );
    });

    expect(lastLyricBoxesProps.selectedSectionId).toBe("generated-id-1");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mockFormatSong).toHaveBeenCalledWith(
      expect.objectContaining({
        arrangements: [
          expect.objectContaining({
            songOrder: [
              { id: "order-1", name: "Verse" },
              { id: "generated-id-2", name: "Bridge" },
            ],
          }),
        ],
      }),
    );
  });

  it("when song order is empty, adding a section only adds that section to song order (not all lyrics)", async () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            arrangements: [
              {
                id: "arr-1",
                name: "Master",
                slides: [],
                formattedLyrics: [
                  {
                    id: "verse-1",
                    type: "Verse",
                    name: "Verse",
                    words: "Verse words",
                    slideSpan: 1,
                  },
                ],
                songOrder: [],
              },
            ],
          },
        },
      },
    });

    render(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    act(() => {
      lastLyricSectionToolsProps.onAddEmptySection("Bridge");
    });

    await waitFor(() => {
      expect(
        lastLyricBoxesProps.formattedLyrics.some(
          (section: { id: string }) => section.id === "generated-id-1",
        ),
      ).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const savedItem = mockFormatSong.mock.calls[mockFormatSong.mock.calls.length - 1][0];
    const savedSongOrder = savedItem.arrangements[0].songOrder;
    expect(savedSongOrder).toHaveLength(1);
    expect(savedSongOrder[0]).toMatchObject({ name: "Bridge" });
  });

  it("imports sections from another song into the current arrangement and appends them to song order by default", async () => {
    mockState = makeBaseState({
      allDocs: {
        allSongDocs: [
          {
            _id: "source-song",
            name: "Source Song",
            type: "song",
            selectedArrangement: 0,
            shouldSendTo: {
              projector: true,
              monitor: true,
              stream: true,
            },
            slides: [],
            arrangements: [],
          },
        ],
      },
      undoable: {
        present: {
          item: {
            _id: "current-song",
            arrangements: [
              {
                id: "arr-1",
                name: "Master",
                slides: [],
                formattedLyrics: [
                  {
                    id: "verse-1",
                    type: "Verse",
                    name: "Verse",
                    words: "Verse words",
                    slideSpan: 1,
                  },
                ],
                songOrder: [{ id: "order-1", name: "Verse" }],
              },
            ],
          },
        },
      },
    });

    render(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    act(() => {
      lastLyricSectionToolsProps.onOpenImportDrawer();
    });

    await waitFor(() => {
      expect(lastAddSongSectionsDrawerProps.isOpen).toBe(true);
    });

    act(() => {
      lastAddSongSectionsDrawerProps.onImport([
        {
          id: "source-chorus",
          type: "Chorus",
          name: "Chorus",
          words: "Imported chorus words",
          slideSpan: 4,
        },
      ]);
    });

    await waitFor(() => {
      expect(
        lastLyricBoxesProps.formattedLyrics.find(
          (section: { id: string }) => section.id === "generated-id-1",
        ),
      ).toEqual(
        expect.objectContaining({
          id: "generated-id-1",
          type: "Chorus",
          words: "Imported chorus words",
          slideSpan: 1,
        }),
      );
    });

    expect(lastLyricBoxesProps.selectedSectionId).toBe("generated-id-1");
    expect(lastAddSongSectionsDrawerProps.isOpen).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mockFormatSong).toHaveBeenCalledWith(
      expect.objectContaining({
        arrangements: [
          expect.objectContaining({
            songOrder: [
              { id: "order-1", name: "Verse" },
              { id: "generated-id-2", name: "Chorus" },
            ],
          }),
        ],
      }),
    );
  });

  it("can import sections without appending them to song order when the toggle is off", async () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            _id: "current-song",
            arrangements: [
              {
                id: "arr-1",
                name: "Master",
                slides: [],
                formattedLyrics: [
                  {
                    id: "verse-1",
                    type: "Verse",
                    name: "Verse",
                    words: "Verse words",
                    slideSpan: 1,
                  },
                ],
                songOrder: [],
              },
            ],
          },
        },
      },
    });

    render(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    act(() => {
      lastLyricSectionToolsProps.onAddNewSectionsToSongOrderChange(false);
    });

    await waitFor(() => {
      expect(lastLyricSectionToolsProps.addNewSectionsToSongOrder).toBe(false);
    });

    act(() => {
      lastLyricSectionToolsProps.onOpenImportDrawer();
    });

    act(() => {
      lastAddSongSectionsDrawerProps.onImport([
        {
          id: "source-chorus",
          type: "Chorus",
          name: "Chorus",
          words: "Imported chorus words",
          slideSpan: 4,
        },
      ]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mockFormatSong).toHaveBeenCalledWith(
      expect.objectContaining({
        arrangements: [
          expect.objectContaining({
            songOrder: [],
          }),
        ],
      }),
    );
  });

  it("preserves unsaved copied arrangements when deleting a lyric section from a stale handler", async () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            arrangements: [
              {
                id: "arr-1",
                name: "Master",
                slides: [],
                formattedLyrics: [
                  {
                    id: "verse-1",
                    type: "Verse",
                    name: "Verse",
                    words: "Verse words",
                    slideSpan: 1,
                  },
                  {
                    id: "chorus-1",
                    type: "Chorus",
                    name: "Chorus",
                    words: "Chorus words",
                    slideSpan: 1,
                  },
                ],
                songOrder: [
                  { id: "order-1", name: "Verse" },
                  { id: "order-2", name: "Chorus" },
                ],
              },
            ],
          },
        },
      },
    });

    render(<LyricsEditor />);
    await waitForLyricsEditorPanelReady();

    const staleDeleteSection = lastLyricBoxesProps.onFormattedLyricsDelete;

    fireEvent.click(screen.getByRole("button", { name: "Copy Master" }));

    await waitFor(() => {
      expect(screen.getByText("Master copy")).toBeInTheDocument();
    });

    act(() => {
      staleDeleteSection(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mockFormatSong).toHaveBeenCalledWith(
      expect.objectContaining({
        arrangements: expect.arrayContaining([
          expect.objectContaining({ id: "arr-1", name: "Master" }),
          expect.objectContaining({
            id: "copied-arrangement",
            name: "Master copy",
          }),
        ]),
      }),
    );
  });
});
