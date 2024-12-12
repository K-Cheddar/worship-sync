import { useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";

const Songs = () => {
  const { list, isAllItemsLoading } = useSelector((state) => state.allItems);
  const { allSongDocs } = useSelector((state) => state.allDocs);

  return (
    <FilteredItems
      list={list}
      type="song"
      heading="Songs"
      label="song"
      isLoading={isAllItemsLoading}
      allDocs={allSongDocs}
    />
  );
};

export default Songs;
