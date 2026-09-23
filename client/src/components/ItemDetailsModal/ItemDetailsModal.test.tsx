import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { searchYouTubeVideos } from "../../api/auth";
import { ItemDetailsEditorFields } from "./ItemDetailsModal";

jest.mock("../../api/auth", () => ({
  ...jest.requireActual("../../api/auth"),
  searchYouTubeVideos: jest.fn(),
}));

const mockSearchYouTubeVideos = jest.mocked(searchYouTubeVideos);

describe("ItemDetailsEditorFields song links", () => {
  beforeEach(() => {
    mockSearchYouTubeVideos.mockReset();
    mockSearchYouTubeVideos.mockResolvedValue({
      query: "Example song official",
      cached: false,
      results: [
        {
          videoId: "dQw4w9WgXcQ",
          title: "Example song official video",
          channelName: "Example Channel",
          thumbnail: "https://img.example/thumb.jpg",
          description: "",
          embeddable: true,
          watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
      ],
    });
  });

  it("adds a selected YouTube result to the existing song-link save payload", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(
      <ItemDetailsEditorFields
        isOpen
        onClose={jest.fn()}
        itemType="song"
        itemName="Example song"
        songMetadata={undefined}
        songLinks={[]}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Find YouTube Video" }));
    fireEvent.click(await screen.findByRole("button", { name: "Link video" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Link video" })).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        name: "Example song",
        songLinksPatch: [
          {
            id: expect.any(String),
            label: "YouTube",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          },
        ],
      });
    });
  });

  it("creates manual metadata when a song key is the only detail", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(
      <ItemDetailsEditorFields
        isOpen
        onClose={jest.fn()}
        itemType="song"
        itemName="Example song"
        songMetadata={undefined}
        songLinks={[]}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Key/i), {
      target: { value: "  D  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        name: "Example song",
        songMetadataPatch: expect.objectContaining({
          trackName: "Example song",
          artistName: "",
          key: "D",
        }),
        songLinksPatch: [],
      });
    });
  });

  it("saves an unlabeled YouTube link with a timestamp segment", async () => {
    const onClose = jest.fn();
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(
      <ItemDetailsEditorFields
        isOpen
        onClose={onClose}
        itemType="song"
        itemName="Example song"
        songMetadata={undefined}
        songLinks={[]}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    fireEvent.change(screen.getByLabelText("Link address:"), {
      target: { value: "https://youtu.be/dQw4w9WgXcQ?t=1m30s" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add segment" }));

    expect(screen.getByLabelText("Start time:")).toHaveValue("1:30");
    fireEvent.change(screen.getByLabelText("End time (optional):"), {
      target: { value: "2:05" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        name: "Example song",
        songLinksPatch: [
          {
            id: expect.any(String),
            url: "https://youtu.be/dQw4w9WgXcQ?t=1m30s",
            segments: [
              {
                id: expect.any(String),
                startSeconds: 90,
                endSeconds: 125,
              },
            ],
          },
        ],
      });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("requires a URL but not a link label", async () => {
    render(
      <ItemDetailsEditorFields
        isOpen
        onClose={jest.fn()}
        itemType="song"
        itemName="Example song"
        songMetadata={undefined}
        songLinks={[{ id: "link-1", label: "Chart", url: "" }]}
        onSave={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a valid http(s) address or remove the empty link.",
    );
  });
});
