import Menu from "../../../components/Menu/Menu";
import Button from "../../../components/Button/Button";
import { Menu as MenuIcon } from "lucide-react";
import { MenuItemType } from "../../../types";
import { RedoButton, UndoButton } from "./Undo";
import ChangelogModal from "../../../components/ChangelogModal/ChangelogModal";
import { useState } from "react";

const ToolbarMenu = ({
  isPhone,
  isEditMode,
}: {
  isPhone?: boolean;
  isEditMode?: boolean;
}) => {
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);

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
      text: "Open Projector",
      onClick: async () => {
        try {
          window.open("#/projector", "_projector", "width=500,height=360");
        } catch (err) {
          console.error(err);
        }
      },
    },
    {
      text: "Home",
      to: "/",
    },
    {
      text: "Changelog",
      onClick: () => setIsChangelogOpen(true),
    },
    ...(isPhone && !isEditMode
      ? [
          {
            element: (
              <UndoButton color="black" className="w-full justify-center" />
            ),
            padding: "p-0",
          },
          {
            element: (
              <RedoButton color="black" className="w-full justify-center" />
            ),
            padding: "p-0",
          },
        ]
      : []),
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
    <>
      <Menu
        menuItems={menuItems}
        TriggeringButton={<Button variant="tertiary" svg={MenuIcon} />}
      />
      <ChangelogModal
        isOpen={isChangelogOpen}
        onClose={() => setIsChangelogOpen(false)}
      />
    </>
  );
};

export default ToolbarMenu;
