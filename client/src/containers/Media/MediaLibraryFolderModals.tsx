import { useCallback, useEffect, useState } from "react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Modal from "../../components/Modal/Modal";
import type { MediaFolder, MediaType } from "../../types";
import {
  MEDIA_LIBRARY_ROOT_VIEW,
  collectSubtreeFolderIds,
} from "../../utils/mediaFolderMutations";
import {
  siblingNameExists,
  wouldExceedMaxFolderDepth,
} from "../../utils/mediaDocUtils";
import generateRandomId from "../../utils/generateRandomId";
import { normalizeMediaLibraryStoredName } from "./mediaLibraryMeta";

const MEDIA_DISPLAY_NAME_MAX_LEN = 200;

export type MediaLibraryRenameMediaFormProps = {
  media: MediaType;
  onSave: (name: string) => void;
  onClose: () => void;
};

export function MediaLibraryRenameMediaForm({
  media,
  onSave,
  onClose,
}: MediaLibraryRenameMediaFormProps) {
  const [itemName, setItemName] = useState(media.name);

  useEffect(() => {
    setItemName(media.name);
  }, [media.id, media.name]);

  const handleSave = useCallback(() => {
    const normalized = normalizeMediaLibraryStoredName(itemName);
    if (!normalized) return;
    const name = normalized.slice(0, MEDIA_DISPLAY_NAME_MAX_LEN);
    onSave(name);
    onClose();
  }, [itemName, onSave, onClose]);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
    >
      <Input
        label="Display name"
        value={itemName}
        onChange={(v) =>
          setItemName(String(v).slice(0, MEDIA_DISPLAY_NAME_MAX_LEN))
        }
        placeholder="Name"
        inputTextSize="text-sm"
        inputWidth="w-full"
      />
      <Button type="submit" variant="cta" className="w-full justify-center">
        Save
      </Button>
    </form>
  );
}

type MediaLibraryFolderModalsProps = {
  selectedLibraryFilter: string | null;
  onSelectLibraryFilter: (folderId: string | null) => void;
  folders: MediaFolder[];
  list: MediaType[];
  onUpdateFoldersAndList: (next: {
    list: MediaType[];
    folders: MediaFolder[];
  }) => void;
  onDeleteFolderSubtree: (folderId: string) => boolean | Promise<boolean>;
  onDeleteFolderKeepContents: (folderId: string) => void;
  folderDeleteOpen: boolean;
  onFolderDeleteOpenChange: (open: boolean) => void;
};

const MediaLibraryFolderModals = ({
  selectedLibraryFilter,
  onSelectLibraryFilter,
  folders,
  list,
  onUpdateFoldersAndList,
  onDeleteFolderSubtree,
  onDeleteFolderKeepContents,
  folderDeleteOpen,
  onFolderDeleteOpenChange,
}: MediaLibraryFolderModalsProps) => {
  const [folderDeleteMode, setFolderDeleteMode] = useState<
    "subtree" | "keep" | null
  >(null);

  const selectedRealFolder =
    selectedLibraryFilter &&
      selectedLibraryFilter !== MEDIA_LIBRARY_ROOT_VIEW
      ? folders.find((f) => f.id === selectedLibraryFilter)
      : undefined;

  const handleConfirmFolderDelete = useCallback(async () => {
    if (!selectedRealFolder || !folderDeleteMode) return;
    if (folderDeleteMode === "keep") {
      onDeleteFolderKeepContents(selectedRealFolder.id);
      onSelectLibraryFilter(
        selectedRealFolder.parentId ?? MEDIA_LIBRARY_ROOT_VIEW,
      );
    } else {
      const deleted = await onDeleteFolderSubtree(selectedRealFolder.id);
      if (!deleted) return;
      onSelectLibraryFilter(
        selectedRealFolder.parentId ?? MEDIA_LIBRARY_ROOT_VIEW,
      );
    }
    onFolderDeleteOpenChange(false);
    setFolderDeleteMode(null);
  }, [
    selectedRealFolder,
    folderDeleteMode,
    onDeleteFolderKeepContents,
    onDeleteFolderSubtree,
    onSelectLibraryFilter,
    onFolderDeleteOpenChange,
  ]);

  const subtreeSize = selectedRealFolder
    ? collectSubtreeFolderIds(selectedRealFolder.id, folders).size
    : 0;

  return (
    <>
      <Modal
        isOpen={folderDeleteOpen}
        onClose={() => {
          onFolderDeleteOpenChange(false);
          setFolderDeleteMode(null);
        }}
        title="Delete folder"
        size="sm"
      >
        <div className="flex flex-col gap-4 p-1 text-sm text-gray-200">
          {selectedRealFolder && (
            <p>
              Folder &quot;{selectedRealFolder.name}&quot; — {subtreeSize}{" "}
              folder(s) in subtree (including this folder).
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="fdel"
              checked={folderDeleteMode === "subtree"}
              onChange={() => setFolderDeleteMode("subtree")}
            />
            <span>
              Delete folder and contents (removes all media in this folder and
              subfolders from the library)
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="fdel"
              checked={folderDeleteMode === "keep"}
              onChange={() => setFolderDeleteMode("keep")}
            />
            <span>
              Delete folder but keep contents (move items and subfolders up one
              level)
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="tertiary"
              onClick={() => {
                onFolderDeleteOpenChange(false);
                setFolderDeleteMode(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              className="bg-red-800 hover:bg-red-700"
              disabled={!folderDeleteMode}
              onClick={() => void handleConfirmFolderDelete()}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export type NewFolderPopoverBodyProps = {
  folders: MediaFolder[];
  list: MediaType[];
  parentForNewFolder: string | null;
  onUpdateFoldersAndList: (next: {
    list: MediaType[];
    folders: MediaFolder[];
  }) => void;
  onClose: () => void;
  /** When set, replaces `list` in the save payload (folders always include the new row). */
  adjustListAfterCreate?: (
    newFolder: MediaFolder,
    foldersIncludingNew: MediaFolder[],
    listBefore: MediaType[],
  ) => MediaType[];
};

export type MediaLibraryRenameFolderFormProps = {
  folders: MediaFolder[];
  list: MediaType[];
  folder: MediaFolder;
  onUpdateFoldersAndList: (next: {
    list: MediaType[];
    folders: MediaFolder[];
  }) => void;
  onClose: () => void;
};

export function MediaLibraryRenameFolderForm({
  folders,
  list,
  folder,
  onUpdateFoldersAndList,
  onClose,
}: MediaLibraryRenameFolderFormProps) {
  const [folderName, setFolderName] = useState(folder.name);

  useEffect(() => {
    setFolderName(folder.name);
  }, [folder.id, folder.name]);

  const handleSave = useCallback(() => {
    const name = folderName.trim();
    if (!name) return;
    if (
      siblingNameExists(name, folder.parentId, folders, folder.id)
    ) {
      return;
    }
    const now = new Date().toISOString();
    onUpdateFoldersAndList({
      list,
      folders: folders.map((f) =>
        f.id === folder.id ? { ...f, name, updatedAt: now } : f,
      ),
    });
    onClose();
  }, [
    folderName,
    folder,
    folders,
    list,
    onUpdateFoldersAndList,
    onClose,
  ]);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
    >
      <Input
        label="Folder name"
        value={folderName}
        onChange={(v) => setFolderName(v as string)}
        placeholder="Name"
        inputTextSize="text-sm"
        inputWidth="w-full"
      />
      <Button type="submit" variant="cta" className="w-full justify-center">
        Save
      </Button>
    </form>
  );
}

export function MediaLibraryNewFolderForm({
  folders,
  list,
  parentForNewFolder,
  onUpdateFoldersAndList,
  onClose,
  adjustListAfterCreate,
}: NewFolderPopoverBodyProps) {
  const [newFolderName, setNewFolderName] = useState("");

  const handleCreateFolder = useCallback(() => {
    const name = newFolderName.trim();
    if (!name) return;
    if (siblingNameExists(name, parentForNewFolder, folders)) return;
    if (wouldExceedMaxFolderDepth(parentForNewFolder, folders)) return;
    const now = new Date().toISOString();
    const nf: MediaFolder = {
      id: generateRandomId(),
      name,
      parentId: parentForNewFolder,
      createdAt: now,
      updatedAt: now,
    };
    const nextFolders = [...folders, nf];
    const nextList = adjustListAfterCreate
      ? adjustListAfterCreate(nf, nextFolders, list)
      : list;
    onUpdateFoldersAndList({ list: nextList, folders: nextFolders });
    setNewFolderName("");
    onClose();
  }, [
    newFolderName,
    parentForNewFolder,
    folders,
    list,
    onUpdateFoldersAndList,
    onClose,
    adjustListAfterCreate,
  ]);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        handleCreateFolder();
      }}
    >
      <Input
        label="Folder name"
        value={newFolderName}
        onChange={(v) => setNewFolderName(v as string)}
        placeholder="Name"
        inputTextSize="text-sm"
        inputWidth="w-full"
      />
      <Button type="submit" variant="cta" className="w-full justify-center">
        {adjustListAfterCreate ? "Create and move" : "Create"}
      </Button>
    </form>
  );
}

export { MediaLibraryFolderModals };
export type { MediaLibraryFolderModalsProps };
