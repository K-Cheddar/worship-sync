import { useDispatch, useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import { setSongSearchValue } from "../../store/allItemsSlice";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";

const Songs = () => {
  const { list, isAllItemsLoading, songSearchValue } = useSelector(
    (state) => state.allItems
  );
  const { allSongDocs } = useSelector((state) => state.allDocs);
  const dispatch = useDispatch();

  return (
    <ErrorBoundary>
      <FilteredItems
        list={list}
        type="song"
        heading="Songs"
        label="song"
        isLoading={isAllItemsLoading}
        allDocs={allSongDocs}
        searchValue={songSearchValue}
        setSearchValue={(value) => dispatch(setSongSearchValue(value))}
      />
    </ErrorBoundary>
  );
};

export default Songs;
