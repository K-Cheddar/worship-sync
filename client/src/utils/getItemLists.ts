import { DBItemList, ItemList } from "../types";

const getItemLists = (DBItemLists: DBItemList[] = []): ItemList[] => {
  const formattedItemLists: ItemList[] = DBItemLists.map((list) => {
    return { id: list.id, name: list.name, isOutline: list.outline };
  });
  return formattedItemLists;
};

export default getItemLists;
