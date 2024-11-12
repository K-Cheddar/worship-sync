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
  _id: string | undefined;
  location: Location;
  item: ServiceItemType;
};

const ServiceItem = ({ item, _id, location }: ServiceItemsProps) => {
  const dispatch = useDispatch();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: item._id,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const actions = useMemo(() => {
    return [
      {
        action: (_id: string) => {
          dispatch(removeItemFromList(_id));
        },
        svg: DeleteSVG,
        id: generateRandomId(),
      },
    ];
  }, [dispatch]);

  const isSelected = item._id === _id && location.pathname.includes("item");

  return (
    <LeftPanelButton
      {...attributes}
      {...listeners}
      style={style}
      ref={setNodeRef}
      title={item.name}
      isSelected={isSelected}
      to={`item/${window.btoa(encodeURI(item._id))}`}
      type={item.type}
      actions={actions}
      id={item._id}
    />
  );
};

export default ServiceItem;
