import { X } from "lucide-react";
import Drawer from "../Drawer";
import Button from "../Button/Button";

type ViewPlainLyricsDrawerProps = {
  title: string | null;
  lyricsText: string;
  isOpen: boolean;
  emptyMessage?: string;
  onClose: () => void;
};

/**
 * Read-only plain-text lyrics drawer for plan songs that are not library docs
 * (pending imports) or whose library song can no longer be resolved.
 */
const ViewPlainLyricsDrawer = ({
  title,
  lyricsText,
  isOpen,
  emptyMessage = "No lyrics available for this song.",
  onClose,
}: ViewPlainLyricsDrawerProps) => {
  if (!title) {
    return null;
  }

  const trimmed = lyricsText.trim();

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Lyrics — ${title}`}
      size="xl"
      position="right"
      contentClassName="flex min-h-0 flex-col"
      contentPadding="p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-variable">
          {trimmed ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
              {trimmed}
            </p>
          ) : (
            <p className="text-sm text-gray-400">{emptyMessage}</p>
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-gray-700 pt-4">
          <Button variant="secondary" onClick={onClose} svg={X}>
            Close
          </Button>
        </div>
      </div>
    </Drawer>
  );
};

export default ViewPlainLyricsDrawer;
