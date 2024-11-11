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
};

const LeftPanelButton = forwardRef<HTMLLIElement, LeftPanelButtonProps>(
  ({ isSelected, to, title, type, actions, id, style, ...rest }, ref) => {
    return (
      <li
        ref={ref}
        style={style}
        className={cn(
          "flex",
          actions && !isSelected && "hover:bg-gray-500 active:bg-gray-400",
          isSelected && "bg-gray-900"
        )}
        {...rest}
      >
        <Button
          variant={actions ? "none" : "tertiary"}
          className={`left-panel-button ${borderColorMap.get(type)}`}
          wrap
          svg={svgMap.get(type) || UnknownSVG}
          gap="gap-3"
          color={iconColorMap.get(type)}
          isSelected={isSelected}
          iconSize="md"
          padding="py-1 px-2"
        >
          <p className="font-semibold">{title}</p>
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
