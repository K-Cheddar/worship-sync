import { useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";

const FreeForms = () => {
  const { list } = useSelector((state) => state.allItems);

  return (
    <FilteredItems
      list={list}
      type="free"
      heading="Free Form Items"
      label="free form item"
    />
  );
};

export default FreeForms;
