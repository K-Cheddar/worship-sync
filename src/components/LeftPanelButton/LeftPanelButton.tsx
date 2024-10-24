import Button from "../Button/Button"
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import { FunctionComponent, MouseEvent } from "react";
import cn from "classnames";
import { borderColorMap, iconColorMap, svgMap, } from "../../utils/itemTypeMaps";


type LeftPanelButtonProps = {
  selectedItem: string,
  id: string,
  handleClick: (itemId: string) => void,
  title: string,
  type: string,
  actions?: { action: (event: MouseEvent<HTMLButtonElement>) => void, svg: FunctionComponent<{}>, id: string }[]
}

const LeftPanelButton = ({ selectedItem, id, handleClick, title, type, actions } : LeftPanelButtonProps) => {
  const isSelected = selectedItem === id;
  
  return (
    <li 
      className={cn(
        "flex", 
        actions && !isSelected && "hover:bg-gray-500 active:bg-gray-400", 
        isSelected && 'bg-gray-900')
      }>
      <Button 
        variant={actions ? "none" : "tertiary"} 
        className={`w-full text-sm border-l-4 ${borderColorMap.get(type)}`}
        onClick={() => handleClick(id)} 
        wrap
        svg={svgMap.get(type) || UnknownSVG}
        gap="gap-3"
        color={iconColorMap.get(type)}
        isSelected={isSelected}
        iconSize="md"
        padding="py-1 px-2"
      >
        <p className="font-semibold">{title}</p>
      </Button>
      {actions && actions.map((action) => {
        return (
          <Button svg={action.svg} key={action.id} onClick={action.action} variant="tertiary"/>
        )
      })}
    </li>
  )
}

export default LeftPanelButton;
