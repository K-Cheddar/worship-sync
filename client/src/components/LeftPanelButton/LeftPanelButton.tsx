import Button from "../Button/Button";
import { FileQuestion } from "lucide-react";
import { forwardRef, FunctionComponent } from "react";
import cn from "classnames";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import { formatTime } from "../DisplayWindow/TimerDisplay";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";
import MultiSelectSubsetTick from "../MultiSelectSubsetTick/MultiSelectSubsetTick";

type LeftPanelButtonProps = {
  isSelected: boolean;
  style?: React.CSSProperties | undefined;
  to: string;
  title: string;
  subtitle?: string;
  type: string;
  id: string;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  actions?: {
    action: (itemId: string) => void;
    svg: FunctionComponent<{}>;
    id: string;
  }[];
  image?: string;
  className?: string;
  displayId?: string;
  timerValue?: number;
  isActive?: boolean;
  /** When provided, renders a multi-select tick badge on the left edge of the row. */
  multiSelectMode?: boolean;
  /** Whether this row is in the active multi-select subset. */
  isMultiSelected?: boolean;
};

const LeftPanelButton = forwardRef<HTMLLIElement, LeftPanelButtonProps>(
  (
    {
      isSelected,
      to,
      title,
      subtitle,
      type,
      actions,
      id,
      style,
      image,
      className,
      displayId,
      timerValue,
      isActive,
      onClick,
      multiSelectMode,
      isMultiSelected,
      ...rest
    },
    ref
  ) => {
    const resolvedImage = useCachedMediaUrl(image);

    return (
      <li
        id={displayId}
        ref={ref}
        style={style}
        className={cn(
          "group relative flex min-h-8 min-w-0",
          isSelected && "ring-1 ring-inset ring-cyan-500/30",
          className
        )}
        {...rest}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-0 transition-colors duration-150 ease-out",
            isSelected
              ? "bg-cyan-500/12 group-hover:bg-cyan-500/18 group-active:bg-cyan-500/24"
              : "bg-transparent group-hover:bg-black/22 group-active:bg-black/32"
          )}
        />
        {multiSelectMode !== undefined && (
          <MultiSelectSubsetTick
            modeActive={multiSelectMode}
            isSelected={isMultiSelected ?? false}
            frameClassName="absolute left-1.5 top-1/2 -translate-y-1/2 z-20 size-5"
          />
        )}
        <Button
          variant="none"
          className="relative z-10 flex min-h-8 min-w-0 flex-1 shrink items-center self-stretch bg-transparent text-sm rounded-tl-none rounded-bl-none"
          iconSize="md"
          wrap
          svg={image || isActive ? undefined : svgMap.get(type) || FileQuestion}
          gap="gap-2"
          color={iconColorMap.get(type)}
          isSelected={isSelected}
          padding="py-1 px-2"
          component="link"
          to={`/controller/${to}`}
          onClick={onClick}
        >
          {image && !isActive && (
            <img
              src={resolvedImage ?? image}
              className="w-14 max-w-[30%] shrink-0"
              alt={title}
            />
          )}
          {isActive && (
            <span className="shrink-0 rounded-lg bg-black/55 px-2 py-1 text-xs font-semibold tabular-nums text-white">
              {formatTime(timerValue || 0, false, true)}
            </span>
          )}
          <div className="min-w-0 flex-1 pl-1">
            <p
              title={title}
              className="line-clamp-3 wrap-break-word text-left font-semibold text-white"
            >
              {title}
            </p>
            {subtitle && (
              <p className="truncate text-left text-xs font-normal text-white/55">
                {subtitle}
              </p>
            )}
          </div>
        </Button>
        {actions &&
          actions.map((action) => (
            <Button
              svg={action.svg}
              key={action.id}
              onClick={() => action.action(id)}
              variant="tertiary"
              className="relative z-10 shrink-0 transition-colors duration-150 ease-out hover:bg-white/10 active:bg-white/15"
            />
          ))}
      </li>
    );
  }
);

export default LeftPanelButton;
