import Button from "../Button/Button";
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import { forwardRef, FunctionComponent } from "react";
import cn from "classnames";
import { borderColorMap, iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import { Link } from "react-router-dom";
import "./LeftPanelButton.scss";

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
      ...rest
    },
    ref
  ) => {
    return (
      <li
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
          svg={svgMap.get(type) || UnknownSVG}
          gap="gap-2"
          color={iconColorMap.get(type)}
          isSelected={isSelected}
          padding="py-1 px-2"
        >
          {image && <img src={image} className="w-10" alt="" />}
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
