import { useSelector } from "../../hooks";
import type { ServiceItem } from "../../types";
import { selectSongLibrary } from "../../store/songLibrarySelectors";

/** Shared document-backed song library, available independently of Controller mounting. */
export const useServicePlanSongLibrary = (): {
  songs: ServiceItem[];
  isLoading: boolean;
} => {
  const { songs, isLoading } = useSelector(selectSongLibrary);
  return { songs, isLoading };
};
