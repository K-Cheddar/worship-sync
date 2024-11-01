import Menu from "../../../components/Menu/Menu";
import Button from "../../../components/Button/Button";
import { ReactComponent as MenuSVG } from "../../../assets/icons/menu.svg";
import { MenuItemType } from "../../../types";

const menuItems: MenuItemType[] = [
  {
    text: 'Open Stage Monitor',
    onClick: () => {
      const monitorWindow = window.open('/monitor');
    }
  },
  {
    text: 'Home',
    to: '/'
  },
  {
    text: 'Logout'
  }
]

const ToolbarMenu = () => {
  return (
    <Menu 
      menuItems={menuItems}
      TriggeringButton={<Button variant="tertiary" svg={MenuSVG}/>}
     />
  )
}

export default ToolbarMenu;