import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LyricBoxes from "../LyricBoxes";

const mockKeepElementInView = jest.fn();
let mockState: any;

jest.mock("../../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../../../utils/generalUtils", () => ({
  keepElementInView: (args: unknown) => mockKeepElementInView(args),
}));

jest.mock("../LyrcisBox", () => ({
  __esModule: true,
  default: ({ lyric, index, selected, justMoved, onChangeSectionType }: any) => (
    <li
      id={`lyric-box-${lyric.id}`}
      data-testid={`lyric-box-${lyric.id}`}
      data-selected={selected ? "true" : "false"}
      data-moved={justMoved ? "true" : "false"}
    >
      <button onClick={() => onChangeSectionType("Verse 4", index)}>
        Change {lyric.id}
      </button>
      {lyric.name}
    </li>
  ),
}));

jest.mock("../../../components/Button/Button", () => ({
  __esModule: true,
  default: ({ children, iconSize, svg, variant, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock("../../../components/Select/Select", () => ({
  __esModule: true,
  default: ({ value }: any) => <div>{value}</div>,
}));

describe("LyricBoxes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      undoable: {
        present: {
          preferences: {
            formattedLyricsPerRow: 2,
          },
        },
      },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("waits until scrolling settles before glowing the moved section", async () => {
    jest.useFakeTimers();
    mockKeepElementInView.mockReturnValue(true);
    const onMovedSectionTracked = jest.fn();

    render(
      <LyricBoxes
        formattedLyrics={[
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
        ]}
        setFormattedLyrics={jest.fn()}
        reformatLyrics={jest.fn()}
        availableSections={[
          { label: "Verse", value: "Verse" },
          { label: "Chorus", value: "Chorus" },
        ]}
        onFormattedLyricsDelete={jest.fn()}
        isMobile={false}
        selectedSectionId="chorus-1"
        recentlyMovedSectionId="chorus-1"
        onMovedSectionTracked={onMovedSectionTracked}
        onSectionSelect={jest.fn()}
      />
    );

    const selectedBox = screen.getByTestId("lyric-box-chorus-1");
    const lyricsList = screen.getByTestId("lyrics-boxes-list");

    expect(selectedBox).toHaveAttribute("data-selected", "true");
    expect(selectedBox).toHaveAttribute("data-moved", "false");

    await waitFor(() => {
      expect(mockKeepElementInView).toHaveBeenCalledWith(
        expect.objectContaining({
          child: selectedBox,
          parent: lyricsList,
        })
      );
    });

    fireEvent.scroll(lyricsList);

    act(() => {
      jest.advanceTimersByTime(120);
    });

    await waitFor(() => {
      expect(selectedBox).toHaveAttribute("data-moved", "true");
    });
    expect(onMovedSectionTracked).toHaveBeenCalledWith("chorus-1");

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(selectedBox).toHaveAttribute("data-moved", "false");
    });
  });

  it("inserts a renamed section before the requested target when moving downward", () => {
    mockKeepElementInView.mockReturnValue(false);
    const reformatLyrics = jest.fn();

    render(
      <LyricBoxes
        formattedLyrics={[
          {
            id: "verse-1",
            type: "Verse",
            name: "Verse 1",
            words: "Verse 1 words",
            slideSpan: 1,
          },
          {
            id: "bridge-1",
            type: "Bridge",
            name: "Bridge",
            words: "Bridge words",
            slideSpan: 1,
          },
          {
            id: "verse-2",
            type: "Verse",
            name: "Verse 2",
            words: "Verse 2 words",
            slideSpan: 1,
          },
          {
            id: "verse-3",
            type: "Verse",
            name: "Verse 3",
            words: "Verse 3 words",
            slideSpan: 1,
          },
          {
            id: "verse-4",
            type: "Verse",
            name: "Verse 4",
            words: "Verse 4 words",
            slideSpan: 1,
          },
        ]}
        setFormattedLyrics={jest.fn()}
        reformatLyrics={reformatLyrics}
        availableSections={[
          { label: "Bridge", value: "Bridge" },
          { label: "Verse 1", value: "Verse 1" },
          { label: "Verse 2", value: "Verse 2" },
          { label: "Verse 3", value: "Verse 3" },
          { label: "Verse 4", value: "Verse 4" },
        ]}
        onFormattedLyricsDelete={jest.fn()}
        isMobile={false}
        selectedSectionId="bridge-1"
        onSectionSelect={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Change bridge-1" }));

    expect(reformatLyrics).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "verse-1" }),
        expect.objectContaining({ id: "verse-2" }),
        expect.objectContaining({ id: "verse-3" }),
        expect.objectContaining({ id: "bridge-1", type: "Verse" }),
        expect.objectContaining({ id: "verse-4" }),
      ])
    );

    expect(
      reformatLyrics.mock.calls[0][0].map((section: { id: string }) => section.id)
    ).toEqual(["verse-1", "verse-2", "verse-3", "bridge-1", "verse-4"]);
  });

  it("keeps the requested number when moving a section downward within the same type", () => {
    mockKeepElementInView.mockReturnValue(false);
    const reformatLyrics = jest.fn();

    render(
      <LyricBoxes
        formattedLyrics={[
          {
            id: "verse-1",
            type: "Verse",
            name: "Verse 1",
            words: "Verse 1 words",
            slideSpan: 1,
          },
          {
            id: "verse-2",
            type: "Verse",
            name: "Verse 2",
            words: "Verse 2 words",
            slideSpan: 1,
          },
          {
            id: "verse-3",
            type: "Verse",
            name: "Verse 3",
            words: "Verse 3 words",
            slideSpan: 1,
          },
          {
            id: "verse-4",
            type: "Verse",
            name: "Verse 4",
            words: "Verse 4 words",
            slideSpan: 1,
          },
        ]}
        setFormattedLyrics={jest.fn()}
        reformatLyrics={reformatLyrics}
        availableSections={[
          { label: "Verse 1", value: "Verse 1" },
          { label: "Verse 2", value: "Verse 2" },
          { label: "Verse 3", value: "Verse 3" },
          { label: "Verse 4", value: "Verse 4" },
        ]}
        onFormattedLyricsDelete={jest.fn()}
        isMobile={false}
        selectedSectionId="verse-2"
        onSectionSelect={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Change verse-2" }));

    expect(
      reformatLyrics.mock.calls[0][0].map((section: { id: string }) => section.id)
    ).toEqual(["verse-1", "verse-3", "verse-4", "verse-2"]);
  });

  it("does not rerun keepElementInView when only words change", async () => {
    mockKeepElementInView.mockReturnValue(false);
    const sharedProps = {
      setFormattedLyrics: jest.fn(),
      reformatLyrics: jest.fn(),
      availableSections: [
        { label: "Verse 1", value: "Verse 1" },
        { label: "Verse 2", value: "Verse 2" },
      ],
      onFormattedLyricsDelete: jest.fn(),
      isMobile: false,
      selectedSectionId: "verse-2",
      onSectionSelect: jest.fn(),
    };

    const { rerender } = render(
      <LyricBoxes
        {...sharedProps}
        formattedLyrics={[
          {
            id: "verse-1",
            type: "Verse",
            name: "Verse 1",
            words: "Verse 1 words",
            slideSpan: 1,
          },
          {
            id: "verse-2",
            type: "Verse",
            name: "Verse 2",
            words: "Verse 2 words",
            slideSpan: 1,
          },
        ]}
      />
    );

    await waitFor(() => {
      expect(mockKeepElementInView).toHaveBeenCalledTimes(1);
    });

    rerender(
      <LyricBoxes
        {...sharedProps}
        formattedLyrics={[
          {
            id: "verse-1",
            type: "Verse",
            name: "Verse 1",
            words: "Updated verse 1 words",
            slideSpan: 1,
          },
          {
            id: "verse-2",
            type: "Verse",
            name: "Verse 2",
            words: "Updated verse 2 words",
            slideSpan: 1,
          },
        ]}
      />
    );

    expect(mockKeepElementInView).toHaveBeenCalledTimes(1);
  });
});
