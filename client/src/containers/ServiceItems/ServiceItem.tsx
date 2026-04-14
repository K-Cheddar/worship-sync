import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";
import generateRandomId from "../../utils/generateRandomId";
import { useDispatch } from "../../hooks";
import {
  addToInitialItems,
  removeItemFromList,
} from "../../store/itemListSlice";
import gsap from "gsap";
import { ServiceItem as ServiceItemType } from "../../types";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { useGSAP } from "@gsap/react";
import cn from "classnames";
import { getOutlineRowSelectionState } from "../../utils/outlineRowSelection";

type ServiceItemsProps = {
  isActive: boolean;
  timerValue?: number;
  index: number;
  selectedItemListId: string | undefined;
  insertPointIndex: number;
  selectedListIds: Set<string>;
  item: ServiceItemType;
  initialItems: string[];
  onItemClick: (listId: string, e: React.MouseEvent) => void;
  /** When false, outline cannot be reordered or removed (view-only access). */
  canMutateOutline?: boolean;
};

const ServiceItem = ({
  isActive,
  timerValue,
  item,
  index,
  selectedItemListId,
  insertPointIndex,
  selectedListIds,
  initialItems,
  onItemClick,
  canMutateOutline = true,
}: ServiceItemsProps) => {
  const dispatch = useDispatch();
  const serviceItemRef = useRef<HTMLElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: item.listId,
      disabled: !canMutateOutline,
    });
  const previousItem = useRef<ServiceItemType | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { isSelected, isInsertPoint } = getOutlineRowSelectionState(
    item.listId,
    index,
    selectedListIds,
    selectedItemListId,
    insertPointIndex
  );

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const actions = useMemo(() => {
    if (!canMutateOutline) return undefined;
    return [
      {
        action: (listId: string) => {
          setIsDeleting(true);
          setTimeout(() => {
            dispatch(removeItemFromList(listId));
            setIsDeleting(false);
          }, 500);
        },
        svg: Trash2,
        id: generateRandomId(),
      },
    ];
  }, [canMutateOutline, dispatch]);

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
      {...(canMutateOutline ? attributes : {})}
      {...(canMutateOutline ? listeners : {})}
      style={style}
      ref={(element) => {
        setNodeRef(element);
        serviceItemRef.current = element;
      }}
      data-list-id={item.listId}
      title={item.name}
      className={cn(
        "border-b-2 overflow-hidden",
        isSelected ? "border-l-cyan-500" : "border-transparent",
        isSelected && "border-b-cyan-500",
        !isSelected && isInsertPoint && "border-b-white",
        !isSelected && !isInsertPoint && "border-b-transparent"
      )}
      isSelected={isSelected}
      to={`item/${window.btoa(encodeURI(item._id))}/${window.btoa(
        encodeURI(item.listId)
      )}`}
      type={item.type}
      image={item.background}
      timerValue={timerValue}
      actions={actions}
      displayId={`service-item-${item.listId}`}
      id={item.listId}
      isActive={isActive}
      onClick={(e) => onItemClick(item.listId, e)}
    />
  );
};

export default ServiceItem;
