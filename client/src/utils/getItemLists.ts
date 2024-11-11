import { DBItemList, ItemList } from "../types";

const DBItemLists: DBItemList[] = [
  {
    id: "Item List 28",
    name: "Stream Outline",
    outline: false,
  },
  {
    id: "Item List 29",
    name: "AY - Jan 14, 2023",
    outline: false,
  },
];

const DBAllItemLists: DBItemList[] = [
  {
    id: "Item List 26",
    name: "Jan 11, 2020",
    outline: false,
  },
  {
    id: "Item List 27",
    name: "Mar 7, 2020",
    outline: false,
  },
  {
    id: "Item List 28",
    name: "Stream Outline",
    outline: false,
  },
  {
    id: "Item List 29",
    name: "AY - Jan 14, 2023",
    outline: false,
  },
];

const getItemLists = (): { currentLists: ItemList[]; allLists: ItemList[] } => {
  const currentLists: ItemList[] = DBItemLists.map((list) => {
    return { id: list.id, name: list.name, isOutline: list.outline };
  });
  const allLists: ItemList[] = DBAllItemLists.map((list) => {
    return { id: list.id, name: list.name, isOutline: list.outline };
  });
  return { currentLists, allLists };
};

export default getItemLists;
