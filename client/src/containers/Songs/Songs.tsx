import { useDispatch, useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import { setSongSearchValue } from "../../store/allItemsSlice";

const Songs = () => {
  const { list, isAllItemsLoading, songSearchValue } = useSelector(
    (state) => state.allItems
  );
  const { allSongDocs } = useSelector((state) => state.allDocs);
  const dispatch = useDispatch();

  return (
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
  );
};

export default Songs;
