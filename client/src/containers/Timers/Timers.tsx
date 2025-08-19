import { useDispatch, useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import { setTimerSearchValue } from "../../store/allItemsSlice";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";

const Timers = () => {
  const { list, isAllItemsLoading, timerSearchValue } = useSelector(
    (state) => state.allItems
  );
  const { allTimerDocs } = useSelector((state) => state.allDocs);
  const dispatch = useDispatch();

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
      />
    </ErrorBoundary>
  );
};

export default Timers;
