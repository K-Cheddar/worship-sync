import { DBItemList, ItemList } from "../types";

const getItemLists = (
  DBItemLists: DBItemList[] = [],
  DBAllItemLists: DBItemList[] = []
): { formattedItemLists: ItemList[]; formattedAllItemLists: ItemList[] } => {
  const formattedItemLists: ItemList[] = DBItemLists.map((list) => {
    return { id: list.id, name: list.name, isOutline: list.outline };
  });
  const formattedAllItemLists: ItemList[] = DBAllItemLists.map((list) => {
    return { id: list.id, name: list.name, isOutline: list.outline };
  });
  return { formattedItemLists, formattedAllItemLists };
};

export default getItemLists;
