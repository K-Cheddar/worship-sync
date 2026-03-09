import { fireEvent, render, screen } from "@testing-library/react";
import LyricsEditor from "../LyricsEditor";

const mockDispatch = jest.fn();
let mockState: any;

const mockSetIsEditMode = jest.fn((value: boolean) => ({
  type: "item/setIsEditMode",
  payload: value,
}));
const mockUpdateArrangements = jest.fn((payload: any) => ({
  type: "item/updateArrangements",
  payload,
}));
const mockFormatSong = jest.fn((item: any) => item);

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
  useCurrentItem: () => mockState.undoable.present.item,
}));

jest.mock("../../../store/itemSlice", () => ({
  setIsEditMode: (value: boolean) => mockSetIsEditMode(value),
  updateArrangements: (payload: any) => mockUpdateArrangements(payload),
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
  default: () => <div data-testid="lyric-boxes" />,
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
  default: () => <div data-testid="section-preview" />,
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

describe("LyricsEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = makeBaseState();
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
});
