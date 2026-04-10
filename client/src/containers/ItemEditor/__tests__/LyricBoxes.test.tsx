import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import LyricBoxes from "../LyricBoxes";

const mockKeepElementInView = jest.fn();
let mockState: any;

const flushDoubleRaf = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });

jest.mock("../../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../../../utils/generalUtils", () => ({
  keepElementInView: (args: unknown) => mockKeepElementInView(args),
}));

jest.mock("../LyrcisBox", () => ({
  __esModule: true,
  default: ({
    lyric,
    index,
    selected,
    justMoved,
    onChangeSectionType,
    onDelete,
  }: any) => (
    <li
      id={`lyric-box-${lyric.id}`}
      data-testid={`lyric-box-${lyric.id}`}
      data-selected={selected ? "true" : "false"}
      data-moved={justMoved ? "true" : "false"}
    >
      <button onClick={() => onChangeSectionType("Verse 4", index)}>
        Change {lyric.id}
      </button>
      <button
        type="button"
        data-testid={`delete-${lyric.id}`}
        onClick={() => onDelete?.(index)}
      >
        Delete {lyric.id}
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

  it("glows the moved section after reposition without scrolling the list", async () => {
    mockKeepElementInView.mockReturnValue(false);
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

    expect(selectedBox).toHaveAttribute("data-selected", "true");
    expect(mockKeepElementInView).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(selectedBox).toHaveAttribute("data-moved", "true");
    });
    expect(onMovedSectionTracked).toHaveBeenCalledWith("chorus-1");

    await act(async () => {
      await new Promise((r) => {
        setTimeout(r, 1000);
      });
    });

    await waitFor(() => {
      expect(selectedBox).toHaveAttribute("data-moved", "false");
    });
  });

  it("inserts a renamed section before the requested target when moving downward", async () => {
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

    await act(async () => {
      await flushDoubleRaf();
    });

    expect(mockKeepElementInView).toHaveBeenCalled();
  });

  it("keeps the requested number when moving a section downward within the same type", async () => {
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

    await act(async () => {
      await flushDoubleRaf();
    });

    expect(mockKeepElementInView).toHaveBeenCalled();
  });

  it("does not call keepElementInView when only words change", () => {
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

    expect(mockKeepElementInView).not.toHaveBeenCalled();

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

    expect(mockKeepElementInView).not.toHaveBeenCalled();
  });

  it("does not scroll the selected section into view after a section delete", async () => {
    mockKeepElementInView.mockReturnValue(false);

    const initialLyrics = [
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
    ];

    const LyricBoxesDeleteHarness = () => {
      const [formattedLyrics, setFormattedLyrics] = useState(initialLyrics);
      return (
        <LyricBoxes
          formattedLyrics={formattedLyrics}
          setFormattedLyrics={jest.fn()}
          reformatLyrics={jest.fn()}
          availableSections={[
            { label: "Verse 1", value: "Verse 1" },
            { label: "Verse 2", value: "Verse 2" },
          ]}
          onFormattedLyricsDelete={(index) => {
            setFormattedLyrics((prev) => prev.filter((_, i) => i !== index));
          }}
          isMobile={false}
          selectedSectionId="verse-2"
          onSectionSelect={jest.fn()}
        />
      );
    };

    render(<LyricBoxesDeleteHarness />);

    expect(mockKeepElementInView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("delete-verse-1"));

    await waitFor(() => {
      expect(screen.queryByTestId("lyric-box-verse-1")).toBeNull();
    });

    expect(mockKeepElementInView).not.toHaveBeenCalled();
  });

  it("scrolls the selected section into view when scrollSelectedIntoViewToken increases", async () => {
    mockKeepElementInView.mockReturnValue(false);

    const ScrollTokenHarness = () => {
      const [token, setToken] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setToken((t) => t + 1)}>
            bump-scroll
          </button>
          <LyricBoxes
            formattedLyrics={[
              {
                id: "verse-1",
                type: "Verse",
                name: "Verse 1",
                words: "words",
                slideSpan: 1,
              },
            ]}
            setFormattedLyrics={jest.fn()}
            reformatLyrics={jest.fn()}
            availableSections={[{ label: "Verse 1", value: "Verse 1" }]}
            onFormattedLyricsDelete={jest.fn()}
            isMobile={false}
            selectedSectionId="verse-1"
            scrollSelectedIntoViewToken={token}
            onSectionSelect={jest.fn()}
          />
        </>
      );
    };

    render(<ScrollTokenHarness />);

    expect(mockKeepElementInView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "bump-scroll" }));

    await waitFor(() => {
      expect(mockKeepElementInView).toHaveBeenCalledWith(
        expect.objectContaining({
          child: screen.getByTestId("lyric-box-verse-1"),
          parent: screen.getByTestId("lyrics-boxes-list"),
        })
      );
    });
  });
});
