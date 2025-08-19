import { useDispatch, useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import { setFreeFormSearchValue } from "../../store/allItemsSlice";
import { RootState } from "../../store/store";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";

const FreeForms = () => {
  const { list, isAllItemsLoading, freeFormSearchValue } = useSelector(
    (state: RootState) => state.allItems
  );
  const { allFreeFormDocs } = useSelector((state: RootState) => state.allDocs);
  const dispatch = useDispatch();

  return (
    <ErrorBoundary>
      <FilteredItems
        list={list}
        type="free"
        heading="Free Form Items"
        label="free form item"
        isLoading={isAllItemsLoading}
        allDocs={allFreeFormDocs}
        searchValue={freeFormSearchValue}
        setSearchValue={(value) => dispatch(setFreeFormSearchValue(value))}
      />
    </ErrorBoundary>
  );
};

export default FreeForms;
