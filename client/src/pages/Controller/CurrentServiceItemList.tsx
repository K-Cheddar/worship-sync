import { useEffect, useMemo, useRef } from "react";
import { FileQuestion } from "lucide-react";
import cn from "classnames";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";
import { keepElementInView } from "../../utils/generalUtils";
import { useLiveOutlinePreview } from "./useLiveOutlinePreview";
import ServiceOutlineSkeleton from "../../containers/ServiceItems/ServiceOutlineSkeleton";
import type { ServiceItem as ServiceItemType } from "../../types";
import {
  getDefaultControllerProfiles,
  type ControllerProfile,
} from "../../utils/controllerProfiles";

const DEFAULT_PRESENTATION_PROFILE = getDefaultControllerProfiles()[0];

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
        isActive
          ? "border-l-emerald-400 bg-emerald-500/12"
          : "border-l-transparent",
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
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
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
 * Read-only mirror of a controller's live outline for the Displays tab. The
 * selected controller's current item is highlighted.
 */
const CurrentServiceItemList = ({
  activeItemId,
  activeListId,
  activeName,
  liveOutputName,
  controller = DEFAULT_PRESENTATION_PROFILE,
  controllers = [],
  onControllerChange,
}: {
  activeItemId?: string | null;
  activeListId?: string | null;
  activeName?: string | null;
  liveOutputName?: string | null;
  controller?: ControllerProfile;
  controllers?: ControllerProfile[];
  onControllerChange?: (id: string) => void;
}) => {
  const { items: serviceItems, isLoading } = useLiveOutlinePreview(
    controller.outlineScope,
  );

  // The display source reports which outline row (listId) is live, so a song
  // scheduled twice can be told apart. Fall back to the underlying item id,
  // then the displayed name for projector presentations, which historically
  // did not carry itemId/listId.
  const resolvedActiveListId = useMemo(() => {
    if (
      activeListId &&
      serviceItems.some((item) => item.listId === activeListId)
    ) {
      return activeListId;
    }
    return (
      (activeItemId
        ? serviceItems.find((item) => item._id === activeItemId)?.listId
        : null) ??
      serviceItems.find(
        (item) =>
          activeName?.trim() &&
          item.name.trim().toLocaleLowerCase() === activeName.trim().toLocaleLowerCase(),
      )?.listId ??
      null
    );
  }, [serviceItems, activeItemId, activeListId, activeName]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {controllers.length > 1 ? (
        <div
          className="flex min-h-9 shrink-0 items-center gap-1 overflow-x-auto rounded-lg border border-gray-700 bg-gray-950/40 p-1"
          role="group"
          aria-label="Item list controller"
        >
          {controllers.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === controller.id}
              onClick={() => onControllerChange?.(option.id)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                option.id === controller.id
                  ? "bg-cyan-600 text-white"
                  : "text-gray-300 hover:bg-gray-800"
              }`}
            >
              {option.name}
            </button>
          ))}
        </div>
      ) : null}
      {liveOutputName ? (
        <p className="shrink-0 truncate px-1 text-[11px] font-medium text-gray-400">
          Following {liveOutputName}
        </p>
      ) : null}
      {isLoading ? (
        <ServiceOutlineSkeleton />
      ) : serviceItems.length === 0 ? (
        <p className="rounded-lg border border-gray-700 bg-gray-950/40 p-3 text-sm text-gray-400">
          No item list is available for {controller.name}.
        </p>
      ) : (
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
      )}
    </div>
  );
};

export default CurrentServiceItemList;
