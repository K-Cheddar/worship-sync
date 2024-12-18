import { useContext, useEffect } from "react";
import { ReactComponent as AddSVG } from "../../../assets/icons/add.svg";
import { ReactComponent as ListSVG } from "../../../assets/icons/list.svg";
import Select from "../../../components/Select/Select";
import { useDispatch, useSelector } from "../../../hooks";
import {
  initiateItemLists,
  removeFromItemLists,
  selectItemList,
  setInitialItemList,
  updateItemLists,
  updateItemListsFromRemote,
} from "../../../store/itemListsSlice";
import getItemListsUtil from "../../../utils/getItemLists";
import PopOver from "../../../components/PopOver/PopOver";
import Button from "../../../components/Button/Button";
import Service from "./Service";
import "./Toolbar.scss";
import { DBItemListDetails, DBItemLists, ItemList } from "../../../types";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import {
  createItemListFromExisting,
  createNewItemList,
} from "../../../utils/itemUtil";

const Services = ({ className }: { className: string }) => {
  const { currentLists, selectedList } = useSelector(
    (state) => state.undoable.present.itemLists
  );

  const dispatch = useDispatch();
  const listsOptions = currentLists.map((list) => ({
    value: list.id,
    label: list.name,
  }));

  const { db, updater } = useContext(ControllerInfoContext) || {};

  useEffect(() => {
    const getItemLists = async () => {
      if (!db) return;
      try {
        const response: DBItemLists | undefined = await db?.get("ItemLists");
        const _itemLists = response?.itemLists || [];
        const _selectedList = response?.selectedList;
        const formattedItemLists = getItemListsUtil(_itemLists);
        dispatch(initiateItemLists(formattedItemLists));
        if (_selectedList) {
          dispatch(setInitialItemList(_selectedList.id));
        }
      } catch (e) {
        console.error(e);
      }
    };

    console.log("getting item lists");

    getItemLists();
  }, [db, dispatch, updater]);

  useEffect(() => {
    if (!updater) return;

    const updateItemLists = async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          if (_update._id === "ItemLists") {
            console.log("updating item lists from remote");
            const update = _update as DBItemLists;
            const formattedItemLists = getItemListsUtil(update.itemLists);
            dispatch(updateItemListsFromRemote(formattedItemLists));
          }
        }
      } catch (e) {
        console.error(e);
      }
    };

    updater.addEventListener("update", updateItemLists);

    return () => updater.removeEventListener("update", updateItemLists);
  }, [updater, dispatch]);

  const _updateItemLists = (list: ItemList) => {
    dispatch(
      updateItemLists(
        currentLists.map((item) => (item.id === list.id ? list : item))
      )
    );
  };

  return (
    <div className={`flex gap-2 items-center ${className || ""}`}>
      <PopOver TriggeringButton={<Button svg={ListSVG} variant="tertiary" />}>
        <div className="flex flex-col gap-2">
          <div className="services-container">
            <section className="flex-1 h-full p-1 flex flex-col">
              <h3 className="text-xl font-semibold mb-2 text-center">
                Current Item Lists
              </h3>
              <ul className="services-list">
                {currentLists.map((list, index) => (
                  <Service
                    key={list.id}
                    list={list}
                    copyList={async (list) => {
                      const newList = await createItemListFromExisting({
                        db,
                        currentLists,
                        selectedList: list,
                      });
                      if (newList) {
                        dispatch(updateItemLists([...currentLists, newList]));
                      }
                    }}
                    deleteList={
                      index === 0
                        ? undefined
                        : async (id) => {
                            dispatch(removeFromItemLists(id));
                            if (db) {
                              const existingList: DBItemListDetails =
                                await db.get(id);
                              db.remove(existingList);
                              dispatch(selectItemList(currentLists[0].id));
                            }
                          }
                    }
                    updateList={(list) => {
                      _updateItemLists(list);
                    }}
                  />
                ))}
              </ul>
            </section>
          </div>
          <Button
            svg={AddSVG}
            className="w-full justify-center text-base"
            onClick={async () => {
              const newList = await createNewItemList({
                db,
                name: "New List",
                currentLists,
              });

              dispatch(updateItemLists([...currentLists, newList]));
            }}
          >
            Add New Service
          </Button>
        </div>
      </PopOver>
      <Select
        label="Outlines"
        hideLabel
        className="services-dropdown"
        labelClassName="mr-2"
        options={listsOptions}
        value={selectedList?.id || ""}
        onChange={(list) => dispatch(selectItemList(list))}
      />
    </div>
  );
};

export default Services;
