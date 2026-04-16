import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Modal from "../../components/Modal/Modal";
import RadioButton, {
  RadioGroup,
} from "../../components/RadioButton/RadioButton";
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

  useEffect(() => {
    if (folderDeleteOpen) setFolderDeleteMode(null);
  }, [folderDeleteOpen]);

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

  /** Descendant folder rows only (not the folder being deleted). */
  const foldersInsideCount = selectedRealFolder
    ? Math.max(
      0,
      collectSubtreeFolderIds(selectedRealFolder.id, folders).size - 1,
    )
    : 0;

  return (
    <>
      <Modal
        isOpen={folderDeleteOpen}
        onClose={() => {
          onFolderDeleteOpenChange(false);
          setFolderDeleteMode(null);
        }}
        title={
          selectedRealFolder
            ? `Delete folder: "${selectedRealFolder.name}"`
            : "Delete folder"
        }
        description={
          selectedRealFolder
            ? `Choose how to delete the folder "${selectedRealFolder.name}".`
            : undefined
        }
        titleClassName="break-words pr-2"
        size="sm"
      >
        <div className="flex flex-col gap-4 p-1 text-sm text-gray-200">
          {foldersInsideCount > 0 ? (
            <p className="text-xs leading-snug text-gray-400">
              {foldersInsideCount} folder
              {foldersInsideCount === 1 ? "" : "s"} inside this folder.
            </p>
          ) : null}
          <RadioGroup
            value={folderDeleteMode ?? ""}
            onValueChange={(v) =>
              setFolderDeleteMode(v === "subtree" || v === "keep" ? v : null)
            }
            className="flex flex-col gap-4"
          >
            <RadioButton
              className="w-full items-start"
              optionValue="subtree"
              label="Delete folder and contents"
              helperText="Removes all media in this folder and nested folders from the library."
              labelClassName="font-medium leading-snug whitespace-normal"
              textSize="text-sm"
              hideLabelColon
            />
            <RadioButton
              className="w-full items-start"
              optionValue="keep"
              label="Delete folder but keep contents"
              helperText="Moves items and nested folders up one level."
              labelClassName="font-medium leading-snug whitespace-normal"
              textSize="text-sm"
              hideLabelColon
            />
          </RadioGroup>
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
              svg={Trash2}
              title="Delete folder"
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
  /** Called after a folder is created (e.g. leave “show all” so the new folder is visible). */
  onFolderCreated?: (newFolder: MediaFolder) => void;
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
  onFolderCreated,
}: NewFolderPopoverBodyProps) {
  const [newFolderName, setNewFolderName] = useState("");
  const [nameConflict, setNameConflict] = useState(false);

  const handleCreateFolder = useCallback(() => {
    const name = newFolderName.trim();
    if (!name) return;
    if (siblingNameExists(name, parentForNewFolder, folders)) {
      setNameConflict(true);
      return;
    }
    setNameConflict(false);
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
    onFolderCreated?.(nf);
    onClose();
  }, [
    newFolderName,
    parentForNewFolder,
    folders,
    list,
    onUpdateFoldersAndList,
    onClose,
    adjustListAfterCreate,
    onFolderCreated,
  ]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      handleCreateFolder();
    },
    [handleCreateFolder],
  );

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <Input
        label="Folder name"
        value={newFolderName}
        onChange={(v) => {
          setNewFolderName(v as string);
          setNameConflict(false);
        }}
        placeholder="Name"
        inputTextSize="text-sm"
        inputWidth="w-full"
      />
      {nameConflict ? (
        <p
          role="alert"
          className="text-xs leading-snug text-amber-300"
        >
          A folder with this name already exists here. Use a different name.
        </p>
      ) : null}
      <Button type="submit" variant="cta" className="w-full justify-center">
        {adjustListAfterCreate ? "Create and move" : "Create"}
      </Button>
    </form>
  );
}

export { MediaLibraryFolderModals };
export type { MediaLibraryFolderModalsProps };
