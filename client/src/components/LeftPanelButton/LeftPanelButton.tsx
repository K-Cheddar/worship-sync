import Button from "../Button/Button";
import { FileQuestion } from "lucide-react";
import { forwardRef, FunctionComponent } from "react";
import cn from "classnames";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import { formatTime } from "../DisplayWindow/TimerDisplay";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";

type LeftPanelButtonProps = {
  isSelected: boolean;
  style?: React.CSSProperties | undefined;
  to: string;
  title: string;
  type: string;
  id: string;
  onClick?: (e: React.MouseEvent) => void;
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
};

const LeftPanelButton = forwardRef<HTMLLIElement, LeftPanelButtonProps>(
  (
    {
      isSelected,
      to,
      title,
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
        className={cn("group relative flex min-h-8", className)}
        {...rest}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-0 transition-colors duration-150 ease-out",
            /* Rest: canvas; hover: darken slightly; selected: clearly darker than bg-homepage-canvas. */
            isSelected
              ? "bg-black/48 group-hover:bg-black/58 group-active:bg-black/65"
              : "bg-transparent group-hover:bg-black/22 group-active:bg-black/32"
          )}
        />
        <Button
          variant="none"
          className={cn(
            "relative z-10 min-h-8 min-w-0 flex-1 shrink self-stretch bg-transparent text-sm rounded-tl-none rounded-bl-none"
          )}
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
            <img src={resolvedImage ?? image} className="w-14 max-w-[30%]" alt={title} />
          )}
          {isActive && (
            <span className="bg-black/55 text-white font-semibold rounded-lg px-2 py-1 text-xs tabular-nums">
              {formatTime(timerValue || 0, false, true)}
            </span>
          )}
          <p
            className={cn(
              "pl-1 text-white",
              isSelected ? "font-bold" : "font-semibold"
            )}
          >
            {title}
          </p>
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
