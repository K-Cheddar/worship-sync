import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MediaLibraryActionBar from "./MediaLibraryActionBar";
import type { MediaLibraryBarAction } from "./mediaLibraryActions";

describe("MediaLibraryActionBar", () => {
  let clientWidthSpy: jest.SpyInstance<number, []>;
  let offsetWidthSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    clientWidthSpy = jest
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(function clientWidthMock(this: HTMLElement) {
        if (
          this.hasAttribute("data-media-library-toolbar-row") ||
          this.hasAttribute("data-media-library-actions-flex") ||
          this.hasAttribute("data-media-library-inline-measure-row")
        )
          return 120;
        return 360;
      });

    offsetWidthSpy = jest
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockImplementation(function offsetWidthMock(this: HTMLElement) {
        if (
          this.hasAttribute("data-measure-action-btn") ||
          this.hasAttribute("data-measure-folder-action-btn")
        )
          return 96;
        return 0;
      });
  });

  afterEach(() => {
    clientWidthSpy.mockRestore();
    offsetWidthSpy.mockRestore();
  });

  it("keeps rename open when chosen from More actions", async () => {
    const user = userEvent.setup();
    const action: MediaLibraryBarAction = {
      id: "send-projector",
      label: "Send to projector",
      onClick: jest.fn(),
    };

    function Harness() {
      const [mediaRenameOpen, setMediaRenameOpen] = useState(false);

      return (
        <MediaLibraryActionBar
          detailsRow={<div>Selected media</div>}
          showFolderActions={false}
          folderNew={null}
          showFolderRenameDelete={false}
          showMediaRename
          mediaRenameOpen={mediaRenameOpen}
          onMediaRenameOpenChange={setMediaRenameOpen}
          renameMediaContent={
            <form>
              <label htmlFor="rename-input">Display name</label>
              <input
                id="rename-input"
                autoFocus
                defaultValue="Current media"
              />
            </form>
          }
          onDeleteFolder={jest.fn()}
          mediaActions={[action]}
          showMoveSelect={false}
          moveSelectOptions={[]}
          onMoveTo={jest.fn()}
        />
      );
    }

    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /rename/i }));

    const renameInput = await screen.findByLabelText(/display name/i);
    await waitFor(() => expect(renameInput).toBeVisible());

    await user.type(renameInput, " updated");

    expect(renameInput).toHaveValue("Current media updated");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows Done and calls handler when multi-select done is enabled", async () => {
    const user = userEvent.setup();
    const onMultiSelectDone = jest.fn();
    const action: MediaLibraryBarAction = {
      id: "send-projector",
      label: "Send to projector",
      onClick: jest.fn(),
    };

    render(
      <MediaLibraryActionBar
        detailsRow={<div>2 selected</div>}
        showFolderActions={false}
        folderNew={null}
        showFolderRenameDelete={false}
        showMediaRename={false}
        onDeleteFolder={jest.fn()}
        mediaActions={[action]}
        showMoveSelect={false}
        moveSelectOptions={[]}
        onMoveTo={jest.fn()}
        showMultiSelectDone
        onMultiSelectDone={onMultiSelectDone}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onMultiSelectDone).toHaveBeenCalledTimes(1);
  });

  it("shows New folder alongside media actions when showNewFolderAction is set", () => {
    clientWidthSpy.mockRestore();
    clientWidthSpy = jest
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(function clientWidthWideToolbar(this: HTMLElement) {
        if (
          this.hasAttribute("data-media-library-toolbar-row") ||
          this.hasAttribute("data-media-library-actions-flex") ||
          this.hasAttribute("data-media-library-inline-measure-row")
        )
          return 1200;
        return 360;
      });

    const action: MediaLibraryBarAction = {
      id: "send-projector",
      label: "Send to projector",
      onClick: jest.fn(),
    };

    render(
      <MediaLibraryActionBar
        detailsRow={<div>2 selected</div>}
        showFolderActions={false}
        showNewFolderAction
        folderNew={{
          open: false,
          onOpenChange: jest.fn(),
          content: <div>New folder form</div>,
          contentClassName: "w-72",
        }}
        showFolderRenameDelete={false}
        showMediaRename={false}
        onDeleteFolder={jest.fn()}
        mediaActions={[action]}
        showMoveSelect
        moveSelectOptions={[{ value: "a", label: "Folder A" }]}
        onMoveTo={jest.fn()}
      />,
    );

    const moveBtn = screen.getByRole("button", { name: /move to folder/i });
    const newFolderBtn = screen.getByRole("button", { name: /^new folder$/i });
    expect(
      moveBtn.compareDocumentPosition(newFolderBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
