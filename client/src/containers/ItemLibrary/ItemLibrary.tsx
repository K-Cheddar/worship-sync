import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import NextServiceTimerItem from "../../components/FilteredItems/NextServiceTimerItem";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { addItemToItemList } from "../../store/itemListSlice";
import {
  setLibraryFilter,
  setLibrarySearchValue,
  type LibraryFilter,
} from "../../store/allItemsSlice";
import { selectUnifiedItemLibrary } from "../../store/itemLibrarySelectors";
import { RootState } from "../../store/store";
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS, SERVICE_TIME_COUNTDOWN_ID } from "../../constants/nextServiceTimer";
import useDisplayedUpcomingService from "../../hooks/useDisplayedUpcomingService";
import type { DBItem } from "../../types";

const routeFilterBySegment: Record<string, LibraryFilter> = {
  songs: "song",
  free: "free",
  timers: "timer",
};
const filterHeading: Record<LibraryFilter, string> = {
  all: "All Items",
  song: "Songs",
  free: "Custom",
  timer: "Timers",
};
const filterLabel: Record<LibraryFilter, string> = {
  all: "item",
  song: "song",
  free: "custom item",
  timer: "timer",
};

type ItemLibraryProps = {
  /** Keeps directly rendered legacy containers aligned with their route. */
  routeFilter?: LibraryFilter;
};

const ItemLibrary = ({ routeFilter }: ItemLibraryProps) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const library = useSelector(selectUnifiedItemLibrary);
  const {
    isAllItemsLoading,
    libraryFilter,
    librarySearchValue,
  } = useSelector((state: RootState) => state.allItems);
  const { allSongDocs, allFreeFormDocs, allTimerDocs } = useSelector(
    (state: RootState) => state.allDocs,
  );
  const allDocs = useMemo<DBItem[]>(
    () => [...allSongDocs, ...allFreeFormDocs, ...allTimerDocs],
    [allSongDocs, allFreeFormDocs, allTimerDocs],
  );

  const pathSegments = location.pathname.split("/");
  const routeFilterFromLocation =
    routeFilterBySegment[pathSegments[pathSegments.length - 1] ?? ""];
  const routeFilterForPage = routeFilterFromLocation ?? routeFilter;

  useEffect(() => {
    if (routeFilterForPage) dispatch(setLibraryFilter(routeFilterForPage));
  }, [dispatch, location.pathname, routeFilterForPage]);

  const services = useSelector(
    (state: RootState) => state.undoable.present.serviceTimes.list,
  );
  const upcomingService = useDisplayedUpcomingService(
    services,
    NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS,
    { keepRecentlyElapsedDuringGrace: true },
  );

  const pinnedTopContent = useMemo(() => {
    if (!upcomingService) return undefined;
    const serviceName = upcomingService.service.name || "Upcoming Service";
    return (
      <NextServiceTimerItem
        upcomingService={upcomingService}
        onAdd={() =>
          dispatch(
            addItemToItemList({
              name: serviceName,
              type: "service-time",
              _id: SERVICE_TIME_COUNTDOWN_ID,
              listId: "",
            }),
          )
        }
      />
    );
  }, [upcomingService, dispatch]);

  return (
    <ErrorBoundary>
      <FilteredItems
        list={library}
        type="all"
        heading={filterHeading[libraryFilter]}
        label={filterLabel[libraryFilter]}
        isLoading={isAllItemsLoading && library.length === 0}
        allDocs={allDocs}
        searchValue={librarySearchValue}
        setSearchValue={(value) => dispatch(setLibrarySearchValue(value))}
        libraryFilter={libraryFilter}
        onLibraryFilterChange={(filter) => dispatch(setLibraryFilter(filter))}
        pinnedTopContent={libraryFilter === "timer" ? pinnedTopContent : undefined}
      />
    </ErrorBoundary>
  );
};

export default ItemLibrary;
