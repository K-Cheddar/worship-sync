import { useContext, useEffect, useState } from "react";
import { ReactComponent as OpenSVG } from "../../../assets/icons/open-folder.svg";
import { ReactComponent as AddSVG } from "../../../assets/icons/add.svg";
import Select from "../../../components/Select/Select";
import { useDispatch, useSelector } from "../../../hooks";
import {
  initiateAllItemLists,
  initiateItemLists,
  removeFromAllItemLists,
  removeFromItemLists,
  selectItemList,
  updateAllItemLists,
  updateItemLists,
} from "../../../store/itemListsSlice";
import getItemListsUtil from "../../../utils/getItemLists";
import Modal from "../../../components/Modal/Modal";
import Button from "../../../components/Button/Button";
import Service from "./Service";
import "./Toolbar.scss";
import { DBItemLists, ItemList } from "../../../types";
import generateRandomId from "../../../utils/generateRandomId";
import { GlobalInfoContext } from "../../../context/globalInfo";

const Services = () => {
  const { allLists, currentLists, selectedList } = useSelector(
    (state) => state.undoable.present.itemLists
  );

  const dispatch = useDispatch();
  const listsOptions = currentLists.map((list) => ({
    value: list.id,
    label: list.name,
  }));

  const [isModalOpen, setIsModalOpen] = useState(false);
  const { db } = useContext(GlobalInfoContext) || {};

  useEffect(() => {
    const getItemLists = async () => {
      try {
        const response1: DBItemLists | undefined = await db?.get("ItemLists");
        const _itemLists = response1?.itemLists || [];
        const response2: DBItemLists | undefined = await db?.get(
          "allItemLists"
        );
        const _allItemLists = response2?.itemLists || [];
        const { formattedItemLists, formattedAllItemLists } = getItemListsUtil(
          _itemLists,
          _allItemLists
        );
        dispatch(initiateItemLists(formattedItemLists));
        dispatch(initiateAllItemLists(formattedAllItemLists));
      } catch (e) {
        console.error(e);
      }
    };
    getItemLists();
  }, [db, dispatch]);

  const _updateItemLists = (list: ItemList) => {
    dispatch(
      updateItemLists(
        currentLists.map((item) => (item.id === list.id ? list : item))
      )
    );
  };

  const _updateAllItemLists = (list: ItemList) => {
    dispatch(
      updateAllItemLists(
        allLists.map((item) => (item.id === list.id ? list : item))
      )
    );
  };

  return (
    <div className="flex gap-2 items-center">
      <Select
        label="Outlines"
        className="services-dropdown"
        labelProps={{ className: "mr-2" }}
        options={listsOptions}
        value={selectedList?.id || ""}
        onChange={(list) => dispatch(selectItemList(list))}
      />
      <Button
        svg={OpenSVG}
        onClick={() => setIsModalOpen(true)}
        variant="tertiary"
      />
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="flex flex-col gap-2 h-[50vh] w-[40vw]">
          <div className="services-container">
            <section className="flex-1 h-full p-1 flex flex-col">
              <h3 className="text-xl font-semibold mb-2">Current Item Lists</h3>
              <ul className="services-list">
                {currentLists.map((list) => (
                  <Service
                    key={list.id}
                    list={list}
                    copyList={(list) => {
                      dispatch(
                        updateItemLists([
                          ...currentLists,
                          {
                            ...list,
                            name: `Copy of ${list.name}`,
                            id: generateRandomId(),
                          },
                        ])
                      );
                    }}
                    deleteList={(id) => dispatch(removeFromItemLists(id))}
                    updateList={(list) => {
                      _updateItemLists(list);
                      _updateAllItemLists(list);
                    }}
                  />
                ))}
              </ul>
            </section>
            <hr className="border-zinc-400 border-l-2 h-full rounded-sm" />
            <section className="flex-1 h-full p-1 flex flex-col">
              <h3 className="text-xl font-semibold mb-2">All Item Lists</h3>
              <ul className="services-list">
                {allLists.map((list) => (
                  <Service
                    key={list.id}
                    list={list}
                    isAllLists
                    deleteList={(id) => {
                      dispatch(removeFromAllItemLists(id));
                      dispatch(removeFromItemLists(id));
                    }}
                    updateList={(list) => {
                      _updateAllItemLists(list);
                      _updateItemLists(list);
                    }}
                    addList={(list) =>
                      dispatch(updateItemLists([...currentLists, list]))
                    }
                    canBeAdded={
                      !currentLists.some((item) => item.id === list.id)
                    }
                  />
                ))}
              </ul>
            </section>
          </div>
          <Button
            svg={AddSVG}
            className="ml-auto text-base"
            onClick={() =>
              dispatch(
                updateAllItemLists([
                  ...allLists,
                  {
                    id: generateRandomId(),
                    name: "New List",
                    isOutline: false,
                  },
                ])
              )
            }
          >
            Add New Service
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export default Services;
