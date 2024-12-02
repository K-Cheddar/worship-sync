import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "../../hooks";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import Button from "../Button/Button";
import Input from "../Input/Input";
import "./FilteredItems.scss";
import {
  addItemToItemList,
  removeItemFromListById,
} from "../../store/itemListSlice";
import { Link } from "react-router-dom";
import { removeItemFromAllItemsList } from "../../store/allItemsSlice";
import { ServiceItem } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { ActionCreators } from "redux-undo";

type FilteredItemsProps = {
  list: ServiceItem[];
  type: string;
  heading: string;
  label: string;
  isLoading: boolean;
};

const FilteredItems = ({
  list,
  type,
  heading,
  label,
  isLoading,
}: FilteredItemsProps) => {
  const dispatch = useDispatch();
  const loader = useRef(null);

  const listOfType = useMemo(() => {
    return list.filter((item) => item.type === type);
  }, [list, type]);

  const [filteredList, setFilteredList] = useState(listOfType);
  const [numShownItems, setNumShownItems] = useState(20);
  const [searchValue, setSearchValue] = useState("");
  const [itemToBeDeleted, setItemToBeDeleted] = useState<ServiceItem | null>(
    null
  );
  const isFullListLoaded = filteredList.length <= numShownItems;

  const { db } = useContext(ControllerInfoContext) || {};

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

  const deleteItem = async (item: ServiceItem) => {
    setItemToBeDeleted(null);
    dispatch(removeItemFromAllItemsList(item._id));
    dispatch(removeItemFromListById(item._id));
    dispatch(ActionCreators.clearHistory());
    if (db) {
      try {
        const doc = await db.get(item._id);
        db.remove(doc);
      } catch (error) {
        console.error(error);
      }
    }
  };

  return (
    <div className="px-2 py-4 h-full">
      {itemToBeDeleted && (
        <div className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-slate-700 rounded px-8 py-4">
            <p className="text-xl">
              Are you sure you want to delete{" "}
              <span className="font-semibold">{itemToBeDeleted.name}</span>?
            </p>
            <p className="text-lg text-amber-400">
              This action is permanent and will clear your undo history.
            </p>
            <div className="flex gap-6 w-full mt-4">
              <Button
                className="flex-1 justify-center"
                onClick={() => setItemToBeDeleted(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 justify-center"
                variant="cta"
                onClick={() => deleteItem(itemToBeDeleted)}
              >
                Delete Forever
              </Button>
            </div>
          </div>
        </div>
      )}
      <h2 className="text-2xl text-center mb-2 lg:w-2/3 ">{heading}</h2>
      {isLoading && (
        <h3 className="text-lg text-center">{heading} is loading...</h3>
      )}
      <div>
        <Input
          value={searchValue}
          disabled={isLoading}
          onChange={(val) => setSearchValue(val as string)}
          label="Search"
          className="lg:w-2/3 text-base flex gap-2 items-center mb-4 px-6"
          data-ignore-undo="true"
        />
      </div>
      <ul className="filtered-items-list">
        {filteredList.slice(0, numShownItems).map((item, index) => {
          const isEven = index % 2 === 0;
          const bg = isEven ? "bg-slate-800" : "bg-slate-600";
          return (
            <li
              key={item._id}
              className={`flex border border-transparent gap-2 ${bg} pl-4 rounded-md items-center hover:border-gray-300 min-h-8 py-1.5`}
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
                onClick={() => setItemToBeDeleted(item)}
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
