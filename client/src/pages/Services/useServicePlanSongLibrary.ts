import { useSelector } from "../../hooks";
import type { ServiceItem } from "../../types";
import { selectSongLibrary } from "../../store/songLibrarySelectors";

/**
 * The songs a plan surface can attach, in the Controller's ServiceItem shape.
 *
 * Controller `allItems` is the natural source, but Teams/Services sessions
 * often never run the Controller lifecycle, so it can be empty or temporarily
 * partial. Merge it with `allSongDocs`, which ServicePlanEditor keeps
 * refreshed. Shared by the library picker and suggestion popover so the two
 * can't end up searching different lists.
 */
export const useServicePlanSongLibrary = (): {
  songs: ServiceItem[];
  isLoading: boolean;
} => {
  const { songs, isLoading } = useSelector(selectSongLibrary);
  return { songs, isLoading };
};
