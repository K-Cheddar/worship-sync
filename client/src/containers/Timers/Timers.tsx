import { useMemo } from "react";
import { useDispatch, useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import NextServiceTimerItem from "../../components/FilteredItems/NextServiceTimerItem";
import { setTimerSearchValue } from "../../store/allItemsSlice";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { addItemToItemList } from "../../store/itemListSlice";
import { SERVICE_TIME_COUNTDOWN_ID, NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../../constants/nextServiceTimer";
import useDisplayedUpcomingService from "../../hooks/useDisplayedUpcomingService";

const Timers = () => {
  const { list, isAllItemsLoading, timerSearchValue } = useSelector(
    (state) => state.allItems
  );
  const { allTimerDocs } = useSelector((state) => state.allDocs);
  const dispatch = useDispatch();

  const services = useSelector((s) => s.undoable.present.serviceTimes.list);

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
            })
          )
        }
      />
    );
  }, [upcomingService, dispatch]);

  return (
    <ErrorBoundary>
      <FilteredItems
        list={list}
        type="timer"
        heading="Timers"
        label="timer"
        isLoading={isAllItemsLoading}
        allDocs={allTimerDocs}
        searchValue={timerSearchValue}
        setSearchValue={(value) => dispatch(setTimerSearchValue(value))}
        pinnedTopContent={pinnedTopContent}
      />
    </ErrorBoundary>
  );
};

export default Timers;
