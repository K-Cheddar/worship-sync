import Button from "../../components/Button/Button";
import type { MediaFolder } from "../../types";
import { ArrowUp, Folder } from "lucide-react";
import {
  MEDIA_LIBRARY_FOLDER_CHIP_BUTTON_CLASS,
  MEDIA_LIBRARY_FOLDER_CHIP_LABEL_CLASS,
  MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE,
} from "./mediaLibraryOrangeFolderIcon";
import cn from "classnames";

type MediaLibraryFolderGridItemsProps = {
  /** When false (Show all), nothing is rendered */
  active: boolean;
  childFolders: MediaFolder[];
  canGoUp: boolean;
  currentFolderName?: string;
  onGoUp: () => void;
  onOpenFolder: (folderId: string) => void;
};

/** Row spans the grid; chip inside is only as wide as its content. */
const rowLiClass =
  "col-span-full flex list-none justify-start py-0.5 min-w-0";

/**
 * Full-width rows at the top of the media grid: Up, then one row per folder.
 * Names are always shown (independent of media “show names” toggle).
 */
const MediaLibraryFolderGridItems = ({
  active,
  childFolders,
  canGoUp,
  currentFolderName,
  onGoUp,
  onOpenFolder,
}: MediaLibraryFolderGridItemsProps) => {
  if (!active) return null;

  return (
    <>
      {canGoUp && (
        <li key="media-library-up" className={cn(rowLiClass, "flex items-center gap-2")}>
          <Button
            variant="none"
            padding="p-0"
            className={MEDIA_LIBRARY_FOLDER_CHIP_BUTTON_CLASS}
            onClick={onGoUp}
            title="Up one level"
          >
            <ArrowUp
              className="h-3.5 w-3.5 shrink-0 text-zinc-200 "
              aria-hidden
            />
            <span className={MEDIA_LIBRARY_FOLDER_CHIP_LABEL_CLASS}>
              Up
            </span>
          </Button>
          <p className="text-xs text-zinc-200">{currentFolderName}</p>

        </li>
      )}
      {childFolders.map((f) => (
        <li key={f.id} className={rowLiClass}>
          <Button
            variant="none"
            padding="p-0"
            className={MEDIA_LIBRARY_FOLDER_CHIP_BUTTON_CLASS}
            onClick={() => onOpenFolder(f.id)}
            title={f.name}
          >
            <Folder
              {...MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE}
              className="h-3.5 w-3.5 shrink-0 text-orange-400"
              aria-hidden
            />
            <span className={MEDIA_LIBRARY_FOLDER_CHIP_LABEL_CLASS}>{f.name}</span>
          </Button>
        </li>
      ))}
    </>
  );
};

export default MediaLibraryFolderGridItems;
