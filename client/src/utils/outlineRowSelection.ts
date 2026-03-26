/** Shared outline row selection + insert-point flags (ServiceItem + HeadingItem). */
export const getOutlineRowSelectionState = (
  listId: string,
  index: number,
  selectedListIds: Set<string>,
  selectedItemListId: string | undefined,
  insertPointIndex: number
) => {
  const isSelected =
    selectedListIds.has(listId) ||
    (selectedListIds.size === 0 && listId === selectedItemListId);
  const isInsertPoint = index === insertPointIndex;
  return { isSelected, isInsertPoint };
};
