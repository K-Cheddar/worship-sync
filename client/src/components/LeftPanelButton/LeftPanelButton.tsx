import Button from "../Button/Button";
import { FileQuestion } from "lucide-react";
import { forwardRef, FunctionComponent } from "react";
import cn from "classnames";
import { borderColorMap, iconColorMap, svgMap } from "../../utils/itemTypeMaps";
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
            isSelected && "bg-gray-900",
            !isSelected &&
            "bg-gray-700 group-hover:bg-gray-500 group-active:bg-gray-400"
          )}
        />
        <Button
          variant="none"
          className={cn(
            "relative z-10 min-h-8 min-w-0 flex-1 shrink self-stretch bg-transparent text-sm border-l-3 rounded-tl-none rounded-bl-none",
            borderColorMap.get(type)
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
            <span className="bg-gray-950 text-white font-semibold rounded-lg px-2 py-1 text-xs tabular-nums">
              {formatTime(timerValue || 0, false, true)}
            </span>
          )}
          <p className="font-semibold pl-1">{title}</p>
        </Button>
        {actions &&
          actions.map((action) => (
            <Button
              svg={action.svg}
              key={action.id}
              onClick={() => action.action(id)}
              variant="tertiary"
              className="relative z-10 shrink-0 transition-colors duration-150 ease-out hover:bg-black/20 active:bg-black/30"
            />
          ))}
      </li>
    );
  }
);

export default LeftPanelButton;
