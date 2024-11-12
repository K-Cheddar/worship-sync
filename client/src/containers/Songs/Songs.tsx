import { useSelector } from "../../hooks";
import FilteredItems from "../../components/FilteredItems/FilteredItems";

const Songs = () => {
  const { list } = useSelector((state) => state.allItems);

  return <FilteredItems list={list} type="song" heading="Songs" label="song" />;
};

export default Songs;
