import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SongReferencePicker from "./SongReferencePicker";

let mockState: unknown;

jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

const songDoc = (id: string, name: string) => ({ _id: id, name, type: "song" });

beforeEach(() => {
  mockState = {
    allItems: { list: [], isAllItemsLoading: false },
    allDocs: {
      allSongDocs: [
        songDoc("song-1", "Great Are You Lord"),
        songDoc("song-2", "Great Is Thy Faithfulness"),
        songDoc("song-3", "Amazing Grace"),
      ],
    },
  };
});

describe("SongReferencePicker", () => {
  it("searches the song library and selects a match", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(<SongReferencePicker value={undefined} onChange={handleChange} />);

    await user.type(screen.getByPlaceholderText("Search the song library…"), "Great");
    expect(await screen.findByRole("button", { name: "Great Are You Lord" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Great Is Thy Faithfulness" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Amazing Grace" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Great Are You Lord" }));
    expect(handleChange).toHaveBeenCalledWith({
      kind: "library",
      songId: "song-1",
      songName: "Great Are You Lord",
    });
  });

  it("shows the selected library song with a clear action", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(
      <SongReferencePicker
        value={{ kind: "library", songId: "song-1", songName: "Great Are You Lord" }}
        onChange={handleChange}
      />,
    );
    expect(screen.getByText("Great Are You Lord")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear song reference" }));
    expect(handleChange).toHaveBeenCalledWith(undefined);
  });

  it("switches into pending mode and captures a title + lyrics for a not-yet-created song", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(<SongReferencePicker value={undefined} onChange={handleChange} />);

    await user.click(screen.getByRole("button", { name: /Song not in the library yet/i }));
    expect(handleChange).toHaveBeenLastCalledWith({
      kind: "pending",
      title: "",
      lyricsText: "",
    });
  });

  it("lets the operator fill in title/lyrics for a pending song", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(
      <SongReferencePicker
        value={{ kind: "pending", title: "", lyricsText: "" }}
        onChange={handleChange}
      />,
    );

    await user.type(screen.getByLabelText(/Song title/i), "New Song");
    expect(handleChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "pending", title: "New Song" }),
    );
  });
  it("shares lyric-phrase ranking and finds indexed titles before hydration", async () => {
    mockState = {
      allItems: { list: [{ _id: "indexed", name: "Holy Spirit", type: "song", listId: "indexed" }], isAllItemsLoading: false },
      allDocs: { allSongDocs: [
        songDoc("weak", "Sound of Praise"),
        { ...songDoc("grace", "Amazing Grace"), arrangements: [{ formattedLyrics: [{ words: "how sweet the sound" }] }] },
      ] },
    };
    const select = jest.fn();
    render(<SongReferencePicker onChange={select} />);
    const input = screen.getByRole("textbox", { name: /Search songs/ });
    fireEvent.change(input, { target: { value: "how sweet the sound" } });
    expect(screen.getByRole("status")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Amazing Grace" });
    expect(screen.getAllByRole("button").slice(0, 2).map((button) => button.textContent)).toEqual(["Amazing Grace", "Sound of Praise"]);
    fireEvent.change(input, { target: { value: "holy spirt" } });
    await screen.findByRole("button", { name: "Holy Spirit" });
    expect(screen.queryByRole("button", { name: "Amazing Grace" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Holy Spirit" }));
    expect(select).toHaveBeenCalledWith({ kind: "library", songId: "indexed", songName: "Holy Spirit" });
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Holy Spirit" })).not.toBeInTheDocument();
  });

  it("cancels older debounces and uses the latest document snapshot", async () => {
    const { rerender, unmount } = render(<SongReferencePicker onChange={jest.fn()} />);
    const input = screen.getByRole("textbox", { name: /Search songs/ });
    fireEvent.change(input, { target: { value: "grace" } });
    fireEvent.change(input, { target: { value: "sheperd" } });
    mockState = { allItems: { list: [], isAllItemsLoading: false }, allDocs: {
      allSongDocs: [{ ...songDoc("new", "Quiet Hymn"), arrangements: [{ formattedLyrics: [{ words: "my shepherd" }] }] }],
    } };
    rerender(<SongReferencePicker onChange={jest.fn()} />);
    await screen.findByRole("button", { name: "Quiet Hymn" });
    expect(screen.queryByRole("button", { name: "Amazing Grace" })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Quiet Hymn" })).not.toBeInTheDocument());
    fireEvent.change(input, { target: { value: "grace" } });
    unmount();
  });

});
