import { useEffect, useMemo, useRef, useState } from "react";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import "./ServiceItems.scss";
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";
import generateRandomId from "../../utils/generateRandomId";
import { useDispatch } from "../../hooks";
import {
  addToInitialItems,
  removeItemFromList,
} from "../../store/itemListSlice";
import gsap from "gsap";
import { Location } from "react-router-dom";
import { ServiceItem as ServiceItemType } from "../../types";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { useGSAP } from "@gsap/react";
import cn from "classnames";

type ServiceItemsProps = {
  isActive: boolean;
  selectedItemListId: string | undefined;
  location: Location;
  item: ServiceItemType;
  initialItems: string[];
};

const ServiceItem = ({
  isActive,
  item,
  selectedItemListId,
  location,
  initialItems,
}: ServiceItemsProps) => {
  const dispatch = useDispatch();
  const serviceItemRef = useRef<HTMLElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: item.listId,
    });
  const previousItem = useRef<ServiceItemType | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isSelected = item.listId === selectedItemListId;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const actions = useMemo(() => {
    return [
      {
        action: (listId: string) => {
          setIsDeleting(true);
          setTimeout(() => {
            dispatch(removeItemFromList(listId));
            setIsDeleting(false);
          }, 500);
        },
        svg: DeleteSVG,
        id: generateRandomId(),
      },
    ];
  }, [dispatch]);

  useEffect(() => {
    // track previousItem for highlighting
    previousItem.current = item;
  }, [item]);

  useGSAP(
    () => {
      if (!serviceItemRef.current) return;

      // highlight item if name or background changes
      if (
        previousItem.current &&
        (previousItem.current.name !== item.name ||
          previousItem.current.background !== item.background)
      ) {
        gsap
          .timeline()
          .fromTo(
            serviceItemRef.current,
            { backgroundColor: serviceItemRef.current.style.backgroundColor },
            {
              backgroundColor: "rgba(255, 255, 255, 0.75)",
              duration: 0.5,
              ease: "power1.inOut",
            }
          )
          .to(serviceItemRef.current, {
            backgroundColor: serviceItemRef.current.style.backgroundColor,
            duration: 0.5,
            ease: "power1.inOut",
          });
      } else if (isDeleting) {
        // delete animation
        gsap.timeline().fromTo(
          serviceItemRef.current,
          {
            height: serviceItemRef.current.offsetHeight,
            minHeight: serviceItemRef.current.style.minHeight,
            borderBottomWidth: serviceItemRef.current.style.borderBottomWidth,
            opacity: 1,
          },
          {
            height: 0,
            minHeight: 0,
            opacity: 0,
            borderBottomWidth: 0,
            duration: 0.5,
            ease: "power1.inOut",
          }
        );
      } else if (!initialItems.includes(item.listId)) {
        // initial animation for new items
        gsap
          .timeline()
          .fromTo(
            serviceItemRef.current,
            {
              height: 0,
              minHeight: 0,
              opacity: 0,
              borderBottomWidth: 0,
            },
            {
              height: "auto",
              minHeight: "auto",
              opacity: 1,
              duration: 0.5,
              borderBottomWidth: "2px",
              ease: "power1.inOut",
            }
          )
          .then(() => {
            dispatch(addToInitialItems([item.listId]));
          });
      }
    },
    { scope: serviceItemRef, dependencies: [item, isDeleting] }
  );

  return (
    <LeftPanelButton
      {...attributes}
      {...listeners}
      style={style}
      ref={(element) => {
        setNodeRef(element);
        serviceItemRef.current = element;
      }}
      title={item.name}
      className={cn(
        "border-b-2 border-r-4 overflow-hidden",
        isSelected ? "border-l-cyan-500" : "border-transparent",
        isActive ? "border-r-cyan-500" : "border-r-transparent"
      )}
      isSelected={isSelected && location.pathname.includes("item")}
      to={`item/${window.btoa(encodeURI(item._id))}/${window.btoa(
        encodeURI(item.listId)
      )}`}
      type={item.type}
      image={item.background}
      actions={actions}
      id={`service-item-${item.listId}`}
    />
  );
};

export default ServiceItem;
