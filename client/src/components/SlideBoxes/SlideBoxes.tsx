import Button from "../Button/Button";
import Icon from "../Icon/Icon";
import { BoxIcon, Lock, Unlock, Trash2, Plus, LibraryBig, ImageIcon, Video } from "lucide-react";
import { useDispatch, useSelector } from "../../hooks";
import { setSelectedBox, updateBoxes } from "../../store/itemSlice";
import { setFocusMediaId, setIsMediaExpanded, setRequestOpenMediaPanel } from "../../store/preferencesSlice";
import { createBox } from "../../utils/slideCreation";
import { Box } from "../../types";
import cn from "classnames";

interface SlideBoxesProps {
  className?: string;
  canEdit: boolean;
  canDeleteBox: (index: number) => boolean;
  isBoxLocked: boolean[];
  setIsBoxLocked: React.Dispatch<React.SetStateAction<boolean[]>>;
}

const SlideBoxes = ({
  className,
  canEdit,
  canDeleteBox,
  isBoxLocked,
  setIsBoxLocked,
}: SlideBoxesProps) => {
  const dispatch = useDispatch();
  const item = useSelector((state) => state.undoable.present.item);
  const mediaList = useSelector((state) => state.media.list);
  const { selectedSlide, selectedBox, slides } = item;

  const boxes = slides?.[selectedSlide]?.boxes || [];
  const isEmpty = boxes.length === 0;

  if (isEmpty) {
    return null;
  }

  const activeBox: Box | undefined = boxes[selectedBox];
  const activeBoxHasMedia = Boolean(activeBox?.mediaInfo?.id || activeBox?.background);
  const activeBoxIsLocked = isBoxLocked[selectedBox] ?? false;

  return (
    <section
      className={cn(
        "flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-md border border-gray-600 max-lg:max-h-[25vh]",
        className
      )}
    >
      <p className="flex shrink-0 items-center justify-center gap-1 border-b border-gray-600 px-2 py-2 text-center text-sm font-semibold">
        <Icon svg={BoxIcon} color="#93c5fd" />
        Slide Boxes
      </p>

      {/* Action bar — only shown when a box is selected */}
      {selectedBox !== undefined && selectedBox >= 0 && activeBox && (
        <div className="flex shrink-0 items-center gap-1 border-b border-gray-600 px-2 py-1 bg-black/60 justify-center">
          <Button
            svg={activeBoxIsLocked ? Lock : Unlock}
            color={activeBoxIsLocked ? "gray" : "green"}
            variant="tertiary"
            disabled={!canEdit}
            className="text-xs"
            iconSize="sm"
            onClick={() => {
              setIsBoxLocked((prev) => {
                const newLocked = [...prev];
                newLocked[selectedBox] = !newLocked[selectedBox];
                return newLocked;
              });
            }}
          >
            {activeBoxIsLocked ? "Unlock" : "Lock"}
          </Button>
          {activeBoxHasMedia && (
            <Button
              svg={LibraryBig}
              variant="tertiary"
              className="text-xs"
              color="#22d3ee"
              iconSize="sm"
              onClick={() => {
                dispatch(setRequestOpenMediaPanel(true));
                dispatch(setIsMediaExpanded(true));
                if (activeBox.mediaInfo?.id) {
                  dispatch(setFocusMediaId(activeBox.mediaInfo!.id));
                } else if (activeBox.background) {
                  const mediaId = mediaList.find((m) => m.background === activeBox.background)?.id;
                  if (mediaId) {
                    dispatch(setFocusMediaId(mediaId));
                  }
                }
              }}
            >
              Show in Media
            </Button>
          )}
        </div>
      )}

      <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto pb-2 pt-1">
        {boxes.map((box: Box, index: number) => {
          return (
            <span
              key={box.id}
              className={cn(
                "flex gap-1 min-w-0 border-l-4",
                index !== boxes.length - 1 && "border-b border-b-gray-600",
                selectedBox === index
                  ? "border-l-cyan-500 bg-cyan-500/12"
                  : "border-l-transparent bg-gray-700"
              )}
            >
              <Button
                truncate
                className="min-w-0 flex-1 text-xs hover:bg-gray-500"
                variant="none"
                onClick={() => dispatch(setSelectedBox(index))}
              >
                {(() => {
                  const mediaType =
                    box.mediaInfo?.type ||
                    (box.background?.includes("stream.mux.com") ? "video" : box.background ? "image" : undefined);
                  return mediaType ? (
                    <Icon
                      svg={mediaType === "video" ? Video : ImageIcon}
                      className="shrink-0"
                    />
                  ) : null;
                })()}
                <p className="truncate">
                  {box.label ||
                    box.words?.trim() ||
                    (box.mediaInfo?.name || box.background?.replace(
                      /https:\/\/res\.cloudinary\.com\/.+\/.+\/upload\/v.+\/.+\//g,
                      ""
                    ))?.replace(/^backgrounds?\//i, "").replace(/\?.*$/, "")}
                </p>
              </Button>
              <Icon
                svg={isBoxLocked[index] ? Lock : Unlock}
                color={isBoxLocked[index] ? "#9ca3af" : "#4ade80"}
                className="shrink-0 self-center mr-1"
              />
              {canDeleteBox(index) && canEdit && (
                <Button
                  svg={Trash2}
                  variant="tertiary"
                  color="red"
                  onClick={() => {
                    const newBoxes = boxes.filter((b, i) => i !== index);
                    dispatch(updateBoxes({ boxes: newBoxes }));
                    if (newBoxes.length > 0) {
                      if (index > 0 && boxes[index - 1]) {
                        dispatch(setSelectedBox(index - 1));
                      } else {
                        dispatch(setSelectedBox(0));
                      }
                    }
                  }}
                />
              )}
            </span>
          );
        })}
        {canEdit && (
          <Button
            className="mt-1 w-full justify-center text-xs"
            svg={Plus}
            onClick={() => {
              dispatch(
                updateBoxes({
                  boxes: [
                    ...boxes,
                    createBox({
                      width: 75,
                      height: 75,
                      x: 12.5,
                      y: 12.5,
                    }),
                  ],
                })
              );
              dispatch(setSelectedBox(boxes.length));
            }}
          >
            Add Box
          </Button>
        )}
      </div>
    </section>
  );
};

export default SlideBoxes;
