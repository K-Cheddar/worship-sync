import { fireEvent, render, screen } from "@testing-library/react";
import { SongItemMetadataModal } from "./SongItemMetadataModal";

describe("SongItemMetadataModal", () => {
  it("updates only the name when there is no songMetadata and artist/album are empty", () => {
    const onSave = jest.fn();

    render(
      <SongItemMetadataModal
        isOpen
        onClose={() => {}}
        itemName="Holy Holy Holy"
        songMetadata={undefined}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Song name:"), {
      target: { value: "Updated Title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({ name: "Updated Title" });
    expect(onSave.mock.calls[0][0].songMetadataPatch).toBeUndefined();
  });

  it("creates manual songMetadata when artist or album is provided", () => {
    const onSave = jest.fn();

    render(
      <SongItemMetadataModal
        isOpen
        onClose={() => {}}
        itemName="Song"
        songMetadata={undefined}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Artist:"), {
      target: { value: "  Artist Name  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.name).toBe("Song");
    expect(payload.songMetadataPatch).toMatchObject({
      source: "manual",
      trackName: "Song",
      artistName: "Artist Name",
    });
  });

  it("clears manual-only metadata when artist and album are cleared", () => {
    const onSave = jest.fn();

    render(
      <SongItemMetadataModal
        isOpen
        onClose={() => {}}
        itemName="Song"
        songMetadata={{
          source: "manual",
          trackName: "Song",
          artistName: "Was Here",
          importedAt: "2026-01-01T00:00:00.000Z",
        }}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Artist:"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "Song",
      songMetadataPatch: null,
    });
  });
});
