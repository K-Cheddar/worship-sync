import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SongReferencePicker from "./SongReferencePicker";

let mockState: unknown;

jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

const songDoc = (id: string, name: string) => ({ _id: id, name, type: "song" });

beforeEach(() => {
  mockState = {
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
    expect(screen.getByRole("button", { name: "Great Are You Lord" })).toBeInTheDocument();
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
});
