import { useEffect, useMemo, useRef } from "react";
import { FileQuestion } from "lucide-react";
import cn from "classnames";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";
import { keepElementInView } from "../../utils/generalUtils";
import { useLiveOutlinePreview } from "./useLiveOutlinePreview";
import ServiceOutlineSkeleton from "../../containers/ServiceItems/ServiceOutlineSkeleton";
import type { ServiceItem as ServiceItemType } from "../../types";

const CurrentItemRow = ({
  item,
  isActive,
}: {
  item: ServiceItemType;
  isActive: boolean;
}) => {
  const rowRef = useRef<HTMLLIElement | null>(null);
  const resolvedImage = useCachedMediaUrl(item.background);
  const Icon = svgMap.get(item.type) || FileQuestion;

  useEffect(() => {
    const child = rowRef.current;
    const parent = child?.parentElement;
    if (!isActive || !child || !parent) return;
    keepElementInView({ child, parent, shouldScrollToCenter: true });
  }, [isActive]);

  return (
    <li
      ref={rowRef}
      className={cn(
        "flex min-h-8 min-w-0 items-center gap-2 rounded-md border-l-2 px-2 py-1",
        isActive ? "border-l-emerald-400 bg-emerald-500/12" : "border-l-transparent",
      )}
    >
      <Icon
        className="size-4 shrink-0"
        style={{ color: iconColorMap.get(item.type) }}
        aria-hidden
      />
      {item.background && (
        <img
          src={resolvedImage ?? item.background}
          alt=""
          className="h-6 w-10 shrink-0 rounded-sm object-cover"
        />
      )}
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">
        {item.name}
      </p>
      {isActive && (
        <span className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
          Live
        </span>
      )}
    </li>
  );
};

/**
 * Read-only mirror of the live outline for the Displays tab: shows every item
 * in service order with the one currently on the monitor/projector output
 * highlighted, so an operator glancing at Displays can see what's coming next.
 */
const CurrentServiceItemList = ({
  activeItemId,
  activeListId,
}: {
  activeItemId?: string | null;
  activeListId?: string | null;
}) => {
  const { items: serviceItems, isLoading } = useLiveOutlinePreview();

  // The monitor reports which outline row (listId) is live, so a song
  // scheduled twice can be told apart. Fall back to matching by the
  // underlying item's _id (picking the first occurrence) for presentations
  // that don't carry a listId, e.g. Quick Links.
  const resolvedActiveListId = useMemo(() => {
    if (
      activeListId &&
      serviceItems.some((item) => item.listId === activeListId)
    ) {
      return activeListId;
    }
    if (!activeItemId) return null;
    return (
      serviceItems.find((item) => item._id === activeItemId)?.listId ?? null
    );
  }, [serviceItems, activeItemId, activeListId]);

  if (isLoading) return <ServiceOutlineSkeleton />;
  if (serviceItems.length === 0) return null;

  return (
    <ul className="scrollbar-variable min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-700 bg-gray-950/40 p-1">
      {serviceItems.map((item) =>
        item.type === "heading" ? (
          <li
            key={item.listId}
            className="truncate px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 first:pt-1"
          >
            {item.name}
          </li>
        ) : (
          <CurrentItemRow
            key={item.listId}
            item={item}
            isActive={item.listId === resolvedActiveListId}
          />
        ),
      )}
    </ul>
  );
};

export default CurrentServiceItemList;
