import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LyricsEditor from "../LyricsEditor";
import { ToastContext } from "../../../context/toastContext";

const mockDispatch = jest.fn();
let mockState: any;
let lastLyricBoxesProps: any;
let lastSectionPreviewProps: any;

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
const mockFormatSong = jest.fn((item: any) => item);
let mockShowToast = jest.fn(() => "toast-1");
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
}));

jest.mock("../../../store/preferencesSlice", () => ({
  increaseFormattedLyrics: jest.fn(() => ({ type: "preferences/increaseFormattedLyrics" })),
  decreaseFormattedLyrics: jest.fn(() => ({ type: "preferences/decreaseFormattedLyrics" })),
}));

jest.mock("../../../utils/overflow", () => ({
  formatSong: (item: any) => mockFormatSong(item),
  formatSection: jest.fn(() => []),
}));

jest.mock("../LyricBoxes", () => ({
  __esModule: true,
  default: (props: any) => {
    lastLyricBoxesProps = props;
    return <div data-testid="lyric-boxes" />;
  },
}));

jest.mock("../SongSections", () => ({
  __esModule: true,
  default: () => <div data-testid="song-sections" />,
}));

jest.mock("../Arrangement", () => ({
  __esModule: true,
  default: ({ arrangement }: { arrangement: { name: string } }) => (
    <li data-testid="arrangement-item">{arrangement.name}</li>
  ),
}));

jest.mock("../SectionPreview", () => ({
  __esModule: true,
  default: (props: any) => {
    lastSectionPreviewProps = props;
    return <div data-testid="section-preview" />;
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

describe("LyricsEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = makeBaseState();
    lastLyricBoxesProps = null;
    lastSectionPreviewProps = null;
    mockShowToast = jest.fn(() => "toast-1");
    mockRemoveToast = jest.fn();
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

  it("dispatches save actions and updates arrangements using formatted song result", () => {
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
  });

  it("closes immediately on cancel when there are no pending changes", () => {
    render(<LyricsEditor />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockSetIsEditMode).toHaveBeenCalledWith(false);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/setIsEditMode",
      payload: false,
    });
  });

  it("shows confirmation modal when cancelling with unsaved changes", () => {
    render(<LyricsEditor />);

    fireEvent.change(screen.getByLabelText(/paste lyrics here/i), {
      target: { value: "Verse\nAmazing grace" },
    });
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

  it("does not warn about unsaved changes after pasted lyrics are cleared", () => {
    render(<LyricsEditor />);

    const pasteLyricsInput = screen.getByLabelText(/paste lyrics here/i);
    fireEvent.change(pasteLyricsInput, {
      target: { value: "Verse\nAmazing grace" },
    });
    fireEvent.change(pasteLyricsInput, {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
            hasRemoteUpdate: true,
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

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalled();
    });

    const { children: renderToastChildren } = mockShowToast.mock.calls[0][0];
    render(<>{renderToastChildren("toast-1")}</>);

    fireEvent.click(screen.getByRole("button", { name: "Keep Editing Mine" }));

    expect(mockDiscardPendingRemoteItem).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/discardPendingRemoteItem",
    });
    expect(mockRemoveToast).toHaveBeenCalledWith("toast-1");
  });
});
