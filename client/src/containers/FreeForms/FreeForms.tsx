import { useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";

const FreeForms = () => {
  const { list, isAllItemsLoading } = useSelector((state) => state.allItems);

  return (
    <FilteredItems
      list={list}
      type="free"
      heading="Free Form Items"
      label="free form item"
      isLoading={isAllItemsLoading}
    />
  );
};

export default FreeForms;
