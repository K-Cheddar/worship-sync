import { useCallback } from "react";
import { BookOpen } from "lucide-react";
import { useDispatch, useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import { useNavigate } from "react-router-dom";
import { getVerses as getVersesApi } from "../../api/getVerses";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import { formatBibleItemForVersion } from "../../utils/itemUtil";
import { openBibleAtLocation } from "../../store/bibleSlice";
import { bibleVersions } from "../../utils/bibleVersions";
import {
  updateBibleInfo,
  updateSlides,
  setSectionLoading,
  setName,
} from "../../store/itemSlice";
import { ItemState } from "../../types";
import { useControllerBasePath } from "../../context/activeController";
import cn from "classnames";

type BibleItemActionsProps = {
  item: ItemState;
  className?: string;
  inlineVersionLabel?: boolean;
};

const BibleItemActions = ({
  item,
  className,
  inlineVersionLabel = false,
}: BibleItemActionsProps) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const controllerBasePath = useControllerBasePath();
  const isSectionLoading = useSelector(
    (state: RootState) => state.undoable.present.item.isSectionLoading
  );

  const handleOpenChapter = useCallback(() => {
    const info = item.bibleInfo;
    if (!info?.book || !info?.chapter || !info?.version) return;
    dispatch(
      openBibleAtLocation({
        book: info.book,
        chapter: info.chapter,
        version: info.version,
      }),
    );
    navigate(`${controllerBasePath}/bible`);
  }, [item.bibleInfo, controllerBasePath, dispatch, navigate]);

  const handleVersionChange = useCallback(
    async (newVersion: string) => {
      const bibleInfo = item.bibleInfo;
      if (
        !bibleInfo?.book ||
        !bibleInfo?.chapter ||
        bibleInfo.version === newVersion
      )
        return;
      dispatch(setSectionLoading(true));
      try {
        const chapterIndex = Math.max(0, parseInt(bibleInfo.chapter, 10) - 1);
        const data = await getVersesApi({
          book: bibleInfo.book,
          chapter: chapterIndex,
          version: newVersion,
        });
        const newVerses = data?.verses ?? [];
        const formattedItem = formatBibleItemForVersion({
          item,
          newVersion,
          newVerses,
        });
        if (formattedItem?.bibleInfo) {
          dispatch(updateBibleInfo({ bibleInfo: formattedItem.bibleInfo }));
          dispatch(updateSlides({ slides: formattedItem.slides }));
          if (formattedItem.name) {
            dispatch(setName({ name: formattedItem.name }));
          }
        }
      } catch (error) {
        console.error("Error updating Bible version:", error);
      } finally {
        dispatch(setSectionLoading(false));
      }
    },
    [item, dispatch]
  );

  return (
    <div className={cn("flex flex-col gap-2 lg:flex-[0_0_30%] w-full py-2", className)}>
      <Button
        variant="primary"
        svg={BookOpen}
        color="#22d3ee"
        onClick={handleOpenChapter}
        className="justify-center"
      >
        Open Chapter
      </Button>
      <Select
        label="Version"
        value={item.bibleInfo!.version}
        onChange={handleVersionChange}
        options={bibleVersions}
        labelLayout={inlineVersionLabel ? "inline" : "stacked"}
        disabled={isSectionLoading}
        className="w-full"
      />
    </div>
  );
};

export default BibleItemActions;
