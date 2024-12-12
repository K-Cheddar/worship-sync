import { useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";

const FreeForms = () => {
  const { list, isAllItemsLoading } = useSelector((state) => state.allItems);
  const { allFreeFormDocs } = useSelector((state) => state.allDocs);

  return (
    <FilteredItems
      list={list}
      type="free"
      heading="Free Form Items"
      label="free form item"
      isLoading={isAllItemsLoading}
      allDocs={allFreeFormDocs}
    />
  );
};

export default FreeForms;
