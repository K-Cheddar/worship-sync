import { useState } from "react";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import Button from "../Button/Button";
import { ServiceItem } from "../../types";

type FilteredItemProps = {
  index: number;
  item: ServiceItem;
  addItemToList: (item: ServiceItem) => void;
  setItemToBeDeleted: (item: ServiceItem) => void;
};

const FilteredItem = ({
  index,
  item,
  addItemToList,
  setItemToBeDeleted,
}: FilteredItemProps) => {
  const isEven = index % 2 === 0;
  const bg = isEven ? "bg-slate-800" : "bg-slate-600";

  const [justAdded, setJustAdded] = useState(false);

  const addItem = (item: ServiceItem) => {
    addItemToList(item);
    setJustAdded(true);

    setTimeout(() => setJustAdded(false), 2000);
  };

  return (
    <li
      key={item._id}
      className={`flex border border-transparent gap-2 ${bg} pl-4 rounded-md items-center hover:border-gray-300 min-h-8 py-1.5`}
    >
      <p className="text-base flex-1">{item.name}</p>
      <Button
        color={justAdded ? "#84cc16" : "#22d3ee"}
        variant="tertiary"
        className="text-sm h-full leading-3 ml-auto"
        padding="py-1 px-2"
        disabled={justAdded}
        svg={justAdded ? CheckSVG : AddSVG}
        onClick={() => addItem(item)}
      >
        {justAdded ? "Added!" : "Add to list"}
      </Button>
      <Button
        svg={DeleteSVG}
        variant="tertiary"
        color="red"
        onClick={() => setItemToBeDeleted(item)}
      />
    </li>
  );
};

export default FilteredItem;
