import { useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";

const Songs = () => {
  const { list, isAllItemsLoading } = useSelector((state) => state.allItems);

  return (
    <FilteredItems
      list={list}
      type="song"
      heading="Songs"
      label="song"
      isLoading={isAllItemsLoading}
    />
  );
};

export default Songs;
