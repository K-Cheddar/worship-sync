import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ItemDetailsEditorFields } from "./ItemDetailsModal";

describe("ItemDetailsEditorFields song links", () => {
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
