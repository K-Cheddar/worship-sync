import Button from "../Button/Button";
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import { forwardRef, FunctionComponent } from "react";
import cn from "classnames";
import { borderColorMap, iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import { Link } from "react-router-dom";
import "./LeftPanelButton.scss";
import { formatTime } from "../DisplayWindow/TimerDisplay";

type LeftPanelButtonProps = {
  isSelected: boolean;
  style?: React.CSSProperties | undefined;
  to: string;
  title: string;
  type: string;
  id: string;
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
      ...rest
    },
    ref
  ) => {
    return (
      <li
        id={displayId}
        ref={ref}
        style={style}
        className={cn(
          "flex min-h-8",
          actions && !isSelected && "hover:bg-gray-500 active:bg-gray-400",
          isSelected && "bg-gray-900",
          className
        )}
        {...rest}
      >
        <Button
          variant={actions ? "none" : "tertiary"}
          className={`left-panel-button ${borderColorMap.get(type)}`}
          iconSize="md"
          wrap
          svg={image ? undefined : svgMap.get(type) || UnknownSVG}
          gap="gap-2"
          color={iconColorMap.get(type)}
          isSelected={isSelected}
          padding="py-1 px-2"
        >
          {image && !isActive && (
            <img src={image} className="w-12" alt={title} />
          )}
          {isActive && (
            <span className="bg-gray-950 text-white font-semibold rounded-lg px-2 py-1 text-xs">
              {formatTime(timerValue || 0, false, true)}
            </span>
          )}
          <p className="font-semibold pl-1">{title}</p>
          <Link
            to={to}
            className="font-semibold w-full h-full flex items-center absolute left-0"
          />
        </Button>
        {actions &&
          actions.map((action) => (
            <Button
              svg={action.svg}
              key={action.id}
              onClick={() => action.action(id)}
              variant="tertiary"
              className="left-panel-action-button"
            />
          ))}
      </li>
    );
  }
);

export default LeftPanelButton;
