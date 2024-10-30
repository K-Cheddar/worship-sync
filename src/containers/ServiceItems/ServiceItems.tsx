import { useEffect, useMemo } from "react";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import "./ServiceItems.scss";
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";
import generateRandomId from "../../utils/generateRandomId";
import { useDispatch, useSelector } from "../../hooks";
import { removeItemFromList, initiateItemList } from "../../store/itemList";
import { mockItemList } from "../../store/mockItemList";

const ServiceItems = () => {
  const dispatch = useDispatch();
  const { list: serviceItems } = useSelector((state) => state.itemList);
  const { id } = useSelector((state) => state.item);

  const actions = useMemo(() => {
    return [
      {
        action: (itemId: string) => dispatch(removeItemFromList(itemId)),
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
          return (
            <LeftPanelButton
              key={item.key}
              title={item.name}
              isSelected={item["_id"] === id}
              to={`item/${window.btoa(item["_id"])}`}
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
