import Button from "../../components/Button/Button";
import type { MediaFolder } from "../../types";
import { ArrowUp, Folder } from "lucide-react";
import { MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE } from "./mediaLibraryOrangeFolderIcon";

type MediaLibraryFolderGridItemsProps = {
  /** When false (Show all), nothing is rendered */
  active: boolean;
  childFolders: MediaFolder[];
  canGoUp: boolean;
  onGoUp: () => void;
  onOpenFolder: (folderId: string) => void;
};

/** Row spans the grid; chip inside is only as wide as its content. */
const rowLiClass =
  "col-span-full flex list-none justify-start py-0.5 min-w-0";

/** Frosted glass chip (folder rows + Up) */
const folderChipButtonClass =
  "inline-flex max-w-full min-w-0 shrink-0 flex-row items-center gap-1.5 rounded-md border border-white/20 bg-white/[0.08] px-1.5 py-0.5 text-left text-xs font-medium text-zinc-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-md transition-[background-color,border-color] hover:border-white/30 hover:bg-white/[0.14]";

/** Long names truncate so the chip stays compact; short names keep tight width. */
const labelClass = "min-w-0 max-w-[14rem] truncate text-left text-zinc-100";

/**
 * Full-width rows at the top of the media grid: Up, then one row per folder.
 * Names are always shown (independent of media “show names” toggle).
 */
const MediaLibraryFolderGridItems = ({
  active,
  childFolders,
  canGoUp,
  onGoUp,
  onOpenFolder,
}: MediaLibraryFolderGridItemsProps) => {
  if (!active) return null;

  return (
    <>
      {canGoUp && (
        <li key="media-library-up" className={rowLiClass}>
          <Button
            variant="none"
            padding="p-0"
            className={folderChipButtonClass}
            onClick={onGoUp}
            title="Up one level"
          >
            <ArrowUp
              className="h-3.5 w-3.5 shrink-0 text-zinc-200"
              aria-hidden
            />
            <span className={labelClass}>Up</span>
          </Button>
        </li>
      )}
      {childFolders.map((f) => (
        <li key={f.id} className={rowLiClass}>
          <Button
            variant="none"
            padding="p-0"
            className={folderChipButtonClass}
            onClick={() => onOpenFolder(f.id)}
            title={f.name}
          >
            <Folder
              {...MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE}
              className="h-3.5 w-3.5 shrink-0 text-orange-400"
              aria-hidden
            />
            <span className={labelClass}>{f.name}</span>
          </Button>
        </li>
      ))}
    </>
  );
};

export default MediaLibraryFolderGridItems;
