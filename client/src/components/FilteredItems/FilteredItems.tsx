import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "../../hooks";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import Button from "../Button/Button";
import Input from "../Input/Input";
import "./FilteredItems.scss";
import {
  addItemToItemList,
  removeItemFromList,
} from "../../store/itemListSlice";
import { Link } from "react-router-dom";
import { removeItemFromAllItemsList } from "../../store/allItemsSlice";
import { ServiceItem } from "../../types";

type FilteredItemsProps = {
  list: ServiceItem[];
  type: string;
  heading: string;
  label: string;
};

const FilteredItems = ({ list, type, heading, label }: FilteredItemsProps) => {
  const dispatch = useDispatch();
  const loader = useRef(null);

  const listOfType = useMemo(() => {
    return list.filter((item) => item.type === type);
  }, [list, type]);

  const [filteredList, setFilteredList] = useState(listOfType);
  const [numShownItems, setNumShownItems] = useState(20);
  const [searchValue, setSearchValue] = useState("");
  const isFullListLoaded = filteredList.length <= numShownItems;

  useEffect(() => {
    setFilteredList(
      listOfType.filter(({ name }) =>
        name.toLowerCase().includes(searchValue.toLowerCase())
      )
    );
  }, [searchValue, listOfType]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setNumShownItems((prev) => prev + 20);
      }
    });

    if (loader.current) {
      observer.observe(loader.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="px-2 py-4 h-full">
      <h2 className="text-2xl text-center mb-2 md:w-2/3 ">{heading}</h2>
      <div>
        <Input
          value={searchValue}
          onChange={(val) => setSearchValue(val as string)}
          label="Search"
          className="md:w-2/3 text-base flex gap-2 items-center mb-4 px-6"
        />
      </div>
      <ul className="filtered-items-list">
        {filteredList.slice(0, numShownItems).map((item, index) => {
          const isEven = index % 2 === 0;
          const bg = isEven ? "bg-slate-800" : "bg-slate-600";
          return (
            <li
              key={item._id}
              className={`flex border border-transparent gap-2 ${bg} pl-4 rounded-md items-center hover:border-gray-300`}
            >
              <p className="text-base flex-1">{item.name}</p>
              <Button
                color="#22d3ee"
                variant="tertiary"
                className="text-sm h-full leading-3 ml-auto"
                padding="py-1 px-2"
                svg={AddSVG}
                onClick={() => dispatch(addItemToItemList(item))}
              >
                Add to List
              </Button>
              <Button
                svg={DeleteSVG}
                variant="tertiary"
                color="red"
                onClick={() => {
                  dispatch(removeItemFromAllItemsList(item._id));
                  // dispatch(removeItemFromList(item._id));
                }}
              />
            </li>
          );
        })}
        {isFullListLoaded && (
          <li className="text-sm flex gap-2 items-center mt-2 justify-center">
            <p>Can't find what you're looking for?</p>
            <Button variant="secondary" className="relative">
              <Link
                className="h-full w-full"
                to={`/controller/create?type=${type}&name=${encodeURI(
                  searchValue
                )}`}
              >
                Create a new {label}
              </Link>
            </Button>
          </li>
        )}
        <li
          className={`w-full text-sm text-center py-1 rounded-md ${
            isFullListLoaded ? "bg-transparent" : "bg-black"
          }`}
          ref={loader}
        >
          {!isFullListLoaded && "Loading..."}
        </li>
      </ul>
    </div>
  );
};

export default FilteredItems;
