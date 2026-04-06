import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Grip } from "lucide-react";
import Button from "../../components/Button/Button";
import { QuickLinkType, TimerInfo } from "../../types";
import QuickLink from "./QuickLink";

type SortableQuickLinkProps = QuickLinkType & {
  removeQuickLink: () => void;
  updateQuickLink: (key: keyof QuickLinkType, value: any) => void;
  isMobile?: boolean;
  isSelected: boolean;
  setSelectedQuickLink: () => void;
  timers: TimerInfo[];
  index: number;
  hideDisplayTypeSelect?: boolean;
};

const SortableQuickLink = (props: SortableQuickLinkProps) => {
  const { id, index, ...rest } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragHandle = (
    <Button
      ref={setActivatorNodeRef}
      type="button"
      variant="tertiary"
      className="shrink-0 touch-none"
      padding="px-2 py-1"
      svg={Grip}
      aria-label="Drag to reorder"
      {...attributes}
      {...listeners}
    />
  );

  return (
    <QuickLink
      {...rest}
      id={id}
      index={index}
      listItemRef={setNodeRef}
      sortableStyle={sortableStyle}
      dragHandle={dragHandle}
    />
  );
};

export default SortableQuickLink;
