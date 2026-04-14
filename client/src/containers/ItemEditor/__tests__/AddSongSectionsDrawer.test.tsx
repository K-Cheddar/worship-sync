import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DBItem, SongMetadata } from "../../../types";
import AddSongSectionsDrawer from "../AddSongSectionsDrawer";

jest.mock("../../../components/Drawer", () => ({
  __esModule: true,
  default: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title || "drawer"}>
        {children}
      </div>
    ) : null,
}));

jest.mock("../../../components/Select/Select", () => ({
  __esModule: true,
  default: ({
    id,
    label,
    value,
    onChange,
    options,
  }: {
    id?: string;
    label?: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <div>
      {label ? <label htmlFor={id}>{label}</label> : null}
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  ),
}));

const makeSong = (overrides: Partial<DBItem> = {}): DBItem =>
  ({
    _id: "song-id",
    name: "Song Name",
    type: "song",
    selectedArrangement: 0,
    shouldSendTo: {
      projector: true,
      monitor: true,
      stream: true,
    },
    slides: [],
    arrangements: [],
    ...overrides,
  }) as DBItem;

describe("AddSongSectionsDrawer", () => {
  it("filters songs by title like the Songs library and keeps the current song visible when it matches", async () => {
    render(
      <AddSongSectionsDrawer
        songs={[
          makeSong({
            _id: "current-song",
            name: "Current Hope",
            songMetadata: { artistName: "Team Alpha" } as SongMetadata,
          }),
          makeSong({
            _id: "other-song",
            name: "Evening Praise",
            songMetadata: { artistName: "Jane Doe" } as SongMetadata,
          }),
        ]}
        isOpen
        isMobile={false}
        currentSongId="current-song"
        onImport={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /current hope/i })).toBeInTheDocument();
    expect(screen.getByText("Current song")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/search songs/i), {
      target: { value: "evening" },
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /current hope/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /evening praise/i })).toBeInTheDocument();
  });

  it("finds songs by lyric text with the same search as the Songs library", async () => {
    render(
      <AddSongSectionsDrawer
        songs={[
          makeSong({
            _id: "by-lyric",
            name: "Hidden Title",
            arrangements: [
              {
                id: "arr",
                name: "Default",
                formattedLyrics: [
                  {
                    id: "sec",
                    type: "Verse",
                    name: "Verse 1",
                    words: "Unique phrase for the test",
                    slideSpan: 1,
                  },
                ],
                songOrder: [],
                slides: [],
              },
            ],
          }),
          makeSong({
            _id: "other",
            name: "Other Song",
            arrangements: [],
          }),
        ]}
        isOpen
        isMobile={false}
        onImport={jest.fn()}
        onClose={jest.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/search songs/i), {
      target: { value: "unique phrase" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /hidden title/i })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /^other song$/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("defaults to the selected arrangement and shows all sections from formatted lyrics", async () => {
    render(
      <AddSongSectionsDrawer
        songs={[
          makeSong({
            _id: "source-song",
            name: "Imported Song",
            selectedArrangement: 1,
            arrangements: [
              {
                id: "arr-0",
                name: "Master",
                formattedLyrics: [
                  {
                    id: "verse-1",
                    type: "Verse",
                    name: "Verse 1",
                    words: "Verse words",
                    slideSpan: 1,
                  },
                ],
                songOrder: [{ id: "order-1", name: "Verse 1" }],
                slides: [],
              },
              {
                id: "arr-1",
                name: "Alt",
                formattedLyrics: [
                  {
                    id: "chorus-1",
                    type: "Chorus",
                    name: "Chorus",
                    words: "Chorus words",
                    slideSpan: 1,
                  },
                  {
                    id: "tag-1",
                    type: "Tag",
                    name: "Tag",
                    words: "Unused but available",
                    slideSpan: 1,
                  },
                ],
                songOrder: [{ id: "order-2", name: "Chorus" }],
                slides: [],
              },
            ],
          }),
        ]}
        isOpen
        isMobile={false}
        onImport={jest.fn()}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /imported song/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/arrangement/i)).toHaveValue("1");
    });

    expect(screen.getByLabelText("Import Chorus")).toBeInTheDocument();
    expect(screen.getByLabelText("Import Tag")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/arrangement/i), {
      target: { value: "0" },
    });

    expect(screen.getByLabelText("Import Verse 1")).toBeInTheDocument();
    expect(screen.queryByLabelText("Import Chorus")).not.toBeInTheDocument();
  });

  it("disables import when the selected arrangement has no sections", async () => {
    render(
      <AddSongSectionsDrawer
        songs={[
          makeSong({
            _id: "empty-song",
            name: "Empty Song",
            arrangements: [
              {
                id: "arr-empty",
                name: "Master",
                formattedLyrics: [],
                songOrder: [],
                slides: [],
              },
            ],
          }),
        ]}
        isOpen
        isMobile={false}
        onImport={jest.fn()}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /empty song/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/does not have any sections to import/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /import selected/i })).toBeDisabled();
  });

  it("imports the selected sections from the chosen arrangement", async () => {
    const onImport = jest.fn();
    const sections = [
      {
        id: "verse-1",
        type: "Verse",
        name: "Verse 1",
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
    ];

    render(
      <AddSongSectionsDrawer
        songs={[
          makeSong({
            _id: "source-song",
            name: "Imported Song",
            arrangements: [
              {
                id: "arr-1",
                name: "Master",
                formattedLyrics: sections,
                songOrder: [{ id: "order-1", name: "Verse 1" }],
                slides: [],
              },
            ],
          }),
        ]}
        isOpen
        isMobile={false}
        onImport={onImport}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /imported song/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Import Verse 1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Import Chorus"));
    fireEvent.click(screen.getByLabelText("Import Verse 1"));
    fireEvent.click(screen.getByRole("button", { name: /import selected/i }));

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledWith(sections);
    });
  });
});
