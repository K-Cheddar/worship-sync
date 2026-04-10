import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import Drawer from "../Drawer";
import Button from "../Button/Button";
import SongArrangementSectionsPanel from "./SongArrangementSectionsPanel";
import { DBItem } from "../../types";

type ViewSongSectionsDrawerProps = {
  song: DBItem | null;
  isOpen: boolean;
  isMobile: boolean;
  searchHighlight?: string;
  onClose: () => void;
};

const ViewSongSectionsDrawer = ({
  song,
  isOpen,
  isMobile,
  searchHighlight,
  onClose,
}: ViewSongSectionsDrawerProps) => {
  const [arrangementIndex, setArrangementIndex] = useState(0);
  const previousSongIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!song) {
      previousSongIdRef.current = null;
      return;
    }
    const def = Math.min(
      Math.max(song.selectedArrangement ?? 0, 0),
      Math.max(0, (song.arrangements?.length ?? 1) - 1),
    );
    if (previousSongIdRef.current !== song._id) {
      previousSongIdRef.current = song._id;
      setArrangementIndex(def);
    }
  }, [song]);

  if (!song) {
    return null;
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Sections — ${song.name}`}
      size="xl"
      position={isMobile ? "bottom" : "right"}
      contentClassName="flex min-h-0 flex-col"
      contentPadding="p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <SongArrangementSectionsPanel
          song={song}
          mode="view"
          arrangementIndex={arrangementIndex}
          onArrangementIndexChange={setArrangementIndex}
          searchHighlight={searchHighlight}
          arrangementSelectId="library-view-song-arrangement"
        />
        <div className="flex shrink-0 justify-end border-t border-gray-700 pt-4">
          <Button variant="secondary" onClick={onClose} svg={X}>
            Close
          </Button>
        </div>
      </div>
    </Drawer>
  );
};

export default ViewSongSectionsDrawer;
