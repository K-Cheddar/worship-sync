import Menu from "../../../components/Menu/Menu";
import Button from "../../../components/Button/Button";
import { ReactComponent as MenuSVG } from "../../../assets/icons/menu.svg";
import { MenuItemType } from "../../../types";
import { useContext } from "react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useNavigate } from "react-router-dom";

const ToolbarMenu = () => {
  const { logout, loginState } = useContext(GlobalInfoContext) || {};
  const navigate = useNavigate();
  const isLoggedIn = loginState === "success";

  const menuItems: MenuItemType[] = [
    {
      text: "Open Stage Monitor",
      onClick: () => {
        const monitorWindow = window.open("#/monitor");
      },
    },
    {
      text: "Home",
      to: "/",
    },
    {
      text: isLoggedIn ? "Logout" : "Login",
      onClick: () => {
        if (isLoggedIn && logout) {
          logout();
        } else {
          navigate("/login");
        }
      },
    },
  ];

  return (
    <Menu
      menuItems={menuItems}
      TriggeringButton={<Button variant="tertiary" svg={MenuSVG} />}
    />
  );
};

export default ToolbarMenu;
