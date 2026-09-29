import Button from "../../components/Button/Button";
import type { MediaFolder } from "../../types";
import { ArrowUp, Folder } from "lucide-react";
import {
  MEDIA_LIBRARY_FOLDER_CHIP_BUTTON_CLASS,
  MEDIA_LIBRARY_FOLDER_CHIP_LABEL_CLASS,
  MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE,
} from "./mediaLibraryOrangeFolderIcon";

type MediaLibraryFolderChipProps = {
  folder: MediaFolder;
  onOpen: (folderId: string) => void;
};

export function MediaLibraryFolderChip({
  folder,
  onOpen,
}: MediaLibraryFolderChipProps) {
  return (
    <Button
      variant="none"
      padding="p-0"
      className={MEDIA_LIBRARY_FOLDER_CHIP_BUTTON_CLASS}
      onClick={() => onOpen(folder.id)}
      title={folder.name}
    >
      <Folder
        {...MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE}
        className="h-3.5 w-3.5 shrink-0 text-orange-400"
        aria-hidden
      />
      <span className={MEDIA_LIBRARY_FOLDER_CHIP_LABEL_CLASS}>{folder.name}</span>
    </Button>
  );
}

type MediaLibraryUpChipProps = {
  currentFolderName?: string;
  onGoUp: () => void;
};

export function MediaLibraryUpChip({
  currentFolderName,
  onGoUp,
}: MediaLibraryUpChipProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button
        variant="none"
        padding="p-0"
        className={MEDIA_LIBRARY_FOLDER_CHIP_BUTTON_CLASS}
        onClick={onGoUp}
        title="Up one level"
      >
        <ArrowUp className="h-3.5 w-3.5 shrink-0 text-zinc-200" aria-hidden />
        <span className={MEDIA_LIBRARY_FOLDER_CHIP_LABEL_CLASS}>Up</span>
      </Button>
      {currentFolderName ? (
        <p
          className="min-w-0 truncate text-xs text-zinc-200"
          title={currentFolderName}
        >
          {currentFolderName}
        </p>
      ) : null}
    </div>
  );
}
