import { useDispatch, useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import { setFreeFormSearchValue } from "../../store/allItemsSlice";

const FreeForms = () => {
  const { list, isAllItemsLoading, freeFormSearchValue } = useSelector(
    (state) => state.allItems
  );
  const { allFreeFormDocs } = useSelector((state) => state.allDocs);
  const dispatch = useDispatch();

  return (
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
  );
};

export default FreeForms;
