import { useParams } from "react-router-dom";
import SlideEditor from "../../containers/ItemEditor/SlideEditor";
import ItemSlides from "../../containers/ItemSlides/ItemSlides";
import { useEffect, useMemo, useState } from "react";
import generateRandomId from "../../utils/generateRandomId";
import { mockArrangement } from "../../store/mockArrangement";
import { DBItem } from "../../types";
import { formatItemInfo } from "../../utils/getItemInfo";
import { useDispatch } from "../../hooks";
import { setActiveItem } from "../../store/itemSlice";

const mockItem: DBItem = {
  name: "There's a welcome here",
  type: "song",
  id: generateRandomId(),
  selectedArrangement: 0,
  shouldSkipTitle: false,
  arrangements: mockArrangement,
};

const getItemFromDB = async (itemId: string) => {
  return mockItem;
};

const Item = () => {
  const { itemId } = useParams();
  const decodedItemId = useMemo(() => window.atob(itemId || ""), [itemId]);
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const dispatch = useDispatch();

  useEffect(() => {
    const selectItem = async () => {
      const item = await getItemFromDB(decodedItemId);
      if (!item) return setStatus("error");
      const formattedItem = await formatItemInfo(item);
      console.log({ formattedItem });
      dispatch(setActiveItem(formattedItem));
    };
    selectItem();
  }, [decodedItemId, dispatch]);

  if (status === "error")
    return (
      <h2 className="text-2xl text-center mt-4 font-bold">Item Not Found</h2>
    );

  return (
    <>
      <SlideEditor />
      <ItemSlides />
    </>
  );
};

export default Item;
