import Menu from "../../../components/Menu/Menu";
import Button from "../../../components/Button/Button";
import { ReactComponent as MenuSVG } from "../../../assets/icons/menu.svg";
import { MenuItemType } from "../../../types";

const ToolbarMenu = () => {
  const menuItems: MenuItemType[] = [
    {
      text: "Open Stage Monitor",
      onClick: async () => {
        try {
          // TODO place on existing monitor
          window.open("#/monitor", "_monitor", "width=500,height=360");
        } catch (err) {
          console.error(err);
        }
      },
    },
    {
      text: "Home",
      to: "/",
    },
    // {
    //   text: isLoggedIn ? "Logout" : "Login",
    //   onClick: async () => {
    //     if (isLoggedIn && logout) {
    //       logout();
    //     } else {
    //       navigate("/login");
    //     }
    //   },
    // },
  ];

  return (
    <Menu
      menuItems={menuItems}
      TriggeringButton={<Button variant="tertiary" svg={MenuSVG} />}
    />
  );
};

export default ToolbarMenu;
