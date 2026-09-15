import { DragOverlay, useDndContext } from "@dnd-kit/core";
import { useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import MediaDragPreview from "./MediaDragPreview";
import { isMediaDragData } from "../../utils/presentationDnd";

const MediaDragOverlay = () => {
  const { active } = useDndContext();
  const mediaList = useSelector(
    (state: RootState) => state.media?.list ?? [],
  );
  const activeMediaData = isMediaDragData(active?.data.current)
    ? active.data.current
    : null;
  const mediaItems = activeMediaData
    ? activeMediaData.mediaIds
        .map((mediaId) => mediaList.find((media) => media.id === mediaId))
        .filter((media): media is (typeof mediaList)[number] => Boolean(media))
    : [];

  return (
    <DragOverlay dropAnimation={null} className="pointer-events-none">
      <MediaDragPreview mediaItems={mediaItems} variant="overlay" />
    </DragOverlay>
  );
};

export default MediaDragOverlay;
