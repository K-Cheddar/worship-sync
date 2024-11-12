import { useMemo } from "react";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import "./ServiceItems.scss";
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";
import generateRandomId from "../../utils/generateRandomId";
import { useDispatch } from "../../hooks";
import { removeItemFromList } from "../../store/itemList";

import { Location } from "react-router-dom";
import { ServiceItem as ServiceItemType } from "../../types";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";

type ServiceItemsProps = {
  listId: string | undefined;
  location: Location;
  item: ServiceItemType;
};

const ServiceItem = ({ item, listId, location }: ServiceItemsProps) => {
  const dispatch = useDispatch();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: item.listId,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const actions = useMemo(() => {
    return [
      {
        action: (listId: string) => {
          dispatch(removeItemFromList(listId));
        },
        svg: DeleteSVG,
        id: generateRandomId(),
      },
    ];
  }, [dispatch]);

  const isSelected =
    item.listId === listId && location.pathname.includes("item");

  return (
    <LeftPanelButton
      {...attributes}
      {...listeners}
      style={style}
      ref={setNodeRef}
      title={item.name}
      isSelected={isSelected}
      to={`item/${window.btoa(encodeURI(item._id))}/${window.btoa(
        encodeURI(item.listId)
      )}`}
      type={item.type}
      actions={actions}
      id={item.listId}
    />
  );
};

export default ServiceItem;
