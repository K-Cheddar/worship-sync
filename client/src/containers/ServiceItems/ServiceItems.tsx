import { useEffect, useMemo } from "react";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import "./ServiceItems.scss";
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";
import generateRandomId from "../../utils/generateRandomId";
import { useDispatch, useSelector } from "../../hooks";
import { removeItemFromList, initiateItemList } from "../../store/itemList";
import { mockItemList } from "../../store/mockItemList";
import { useLocation } from "react-router-dom";

const ServiceItems = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { list: serviceItems } = useSelector((state) => state.itemList);
  const { listId } = useSelector((state) => state.item);

  const actions = useMemo(() => {
    return [
      {
        action: (listId: string) => dispatch(removeItemFromList(listId)),
        svg: DeleteSVG,
        id: generateRandomId(),
      },
    ];
  }, [dispatch]);

  useEffect(() => {
    dispatch(initiateItemList(mockItemList));
  }, [dispatch]);

  return (
    <>
      <h3 className="font-bold text-center p-1 text-base bg-slate-800">
        Service Items
      </h3>
      <ul className="overflow-y-auto overflow-x-visible flex-1 service-items-list">
        {serviceItems.map((item) => {
          const isSelected =
            item.listId === listId && location.pathname.includes("item");
          return (
            <LeftPanelButton
              key={item.listId}
              title={item.name}
              isSelected={isSelected}
              to={`item/${window.btoa(item["_id"])}/${window.btoa(
                item.listId
              )}`}
              type={item.type}
              actions={actions}
              id={item["_id"]}
            />
          );
        })}
      </ul>
    </>
  );
};

export default ServiceItems;
