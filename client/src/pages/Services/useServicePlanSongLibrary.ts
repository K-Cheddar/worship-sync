import { useMemo } from "react";
import { useSelector } from "../../hooks";
import type { ServiceItem } from "../../types";

/**
 * The songs a plan surface can attach, in the Controller's ServiceItem shape.
 *
 * Controller `allItems` is the natural source, but Teams/Services sessions
 * often never run the Controller lifecycle, so it stays "loading" with an empty
 * list forever. Fall back to `allSongDocs`, which ServicePlanEditor already
 * keeps refreshed. Shared by the library picker and the suggestion popover so
 * the two can't end up searching different lists.
 */
export const useServicePlanSongLibrary = (): {
  songs: ServiceItem[];
  isLoading: boolean;
} => {
  const allSongDocs = useSelector((state) => state.allDocs.allSongDocs);
  const allItems = useSelector((state) => state.allItems.list);
  const isAllItemsLoading = useSelector(
    (state) => state.allItems.isAllItemsLoading,
  );

  const songs = useMemo((): ServiceItem[] => {
    const fromAllItems = allItems.filter((item) => item.type === "song");
    if (fromAllItems.length > 0) return fromAllItems;
    return allSongDocs.map((doc) => ({
      _id: doc._id,
      name: doc.name,
      type: "song",
      listId: doc._id,
      background: typeof doc.background === "string" ? doc.background : "",
    }));
  }, [allItems, allSongDocs]);

  return {
    songs,
    isLoading: isAllItemsLoading && songs.length === 0 && allSongDocs.length === 0,
  };
};
