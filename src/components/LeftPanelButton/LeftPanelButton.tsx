import Button from "../Button/Button";
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import { FunctionComponent } from "react";
import cn from "classnames";
import { borderColorMap, iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import { Link } from "react-router-dom";

type LeftPanelButtonProps = {
  isSelected: boolean;
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

const LeftPanelButton = ({
  isSelected,
  to,
  title,
  type,
  actions,
  id,
}: LeftPanelButtonProps) => {
  return (
    <li
      className={cn(
        "flex",
        actions && !isSelected && "hover:bg-gray-500 active:bg-gray-400",
        isSelected && "bg-gray-900"
      )}
    >
      <Button
        variant={actions ? "none" : "tertiary"}
        className={`relative w-full text-sm border-l-4 ${borderColorMap.get(
          type
        )}`}
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
          className="font-semibold w-full h-full flex items-center absolute"
        />
      </Button>
      {actions &&
        actions.map((action) => {
          return (
            <Button
              svg={action.svg}
              key={action.id}
              onClick={() => action.action(id)}
              variant="tertiary"
            />
          );
        })}
    </li>
  );
};

export default LeftPanelButton;
