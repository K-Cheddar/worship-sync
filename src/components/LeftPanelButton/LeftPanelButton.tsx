import Button, { ButtonProps } from "../Button/Button"
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import { ReactElement } from "react";
import cn from "classnames";
import { borderColorMap, iconColorMap, svgMap, } from "../../utils/itemTypeMaps";


type LeftPanelButtonProps = {
  selectedItem: string,
  id: string,
  handleClick: (itemId: string) => void,
  title: string,
  type: string,
  actions?: ReactElement<ButtonProps>[],
}

const LeftPanelButton = ({ selectedItem, id, handleClick, title, type, actions } : LeftPanelButtonProps) => {
  const isSelected = selectedItem === id;
  
  return (
    <span className={cn("flex", isSelected && 'bg-gray-900')}>
      <Button 
        variant="tertiary" 
        className={`w-full border-l-4 ${borderColorMap.get(type)}`}
        onClick={() => handleClick(id)} 
        wrap
        svg={svgMap.get(type) || UnknownSVG}
        gap="gap-3"
        color={iconColorMap.get(type)}
        isSelected={isSelected}
      >
        <p className="font-semibold">{title}</p>
      </Button>
      {actions && actions.map((action) => action)}
    </span>
  )
}

export default LeftPanelButton;
