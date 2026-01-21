import Menu from "../../../components/Menu/Menu";
import Button from "../../../components/Button/Button";
import { Menu as MenuIcon, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { MenuItemType } from "../../../types";
import { RedoButton, UndoButton } from "./Undo";
import ChangelogModal from "../../../components/ChangelogModal/ChangelogModal";
import { useState, useEffect } from "react";
import { useElectronWindows } from "../../../hooks/useElectronWindows";

const ToolbarMenu = ({
  isPhone,
  isEditMode,
}: {
  isPhone?: boolean;
  isEditMode?: boolean;
}) => {
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const { isElectron, openMonitorWindow, openProjectorWindow } = useElectronWindows();

  useEffect(() => {
    // Base font size from index.css (92.5%)
    const baseFontSize = 100;
    const scale = zoomLevel / 100;
    const newFontSize = baseFontSize * scale;

    // Apply zoom by adjusting the root font size
    // This scales all rem-based units (which Tailwind uses)
    document.documentElement.style.fontSize = `${newFontSize}%`;

    // Cleanup function to reset font size when component unmounts
    return () => {
      document.documentElement.style.fontSize = `${baseFontSize}%`;
    };
  }, [zoomLevel]);

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 10, 200)); // Max 200%
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 10, 50)); // Min 50%
  };

  const handleReset = () => {
    setZoomLevel(100);
  };

  const menuItems: MenuItemType[] = [
    {
      text: "Open Stage Monitor",
      onClick: async () => {
        try {
          if (isElectron) {
            await openMonitorWindow();
          } else {
            window.open("#/monitor", "_monitor", "width=500,height=360");
          }
        } catch (err) {
          console.error(err);
        }
      },
    },
    {
      text: "Open Projector",
      onClick: async () => {
        try {
          if (isElectron) {
            await openProjectorWindow();
          } else {
            window.open("#/projector", "_projector", "width=500,height=360");
          }
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
    {
      element: (
        <div className="flex flex-col gap-2 w-full">
          <div className="flex items-center justify-center gap-2">
            <span className="text-xs font-semibold min-w-12 text-center">
              {zoomLevel}%
            </span>
            <Button
              svg={RotateCcw}
              onClick={handleReset}
              className="justify-center"
              disabled={zoomLevel === 100}
              variant="secondary"
            ></Button>
          </div>
          <div className="flex items-center gap-2 w-full">
            <Button
              svg={ZoomOut}
              onClick={handleZoomOut}
              className="flex-1 justify-center"
              disabled={zoomLevel <= 50}
              variant="secondary"
            ></Button>
            <Button
              svg={ZoomIn}
              onClick={handleZoomIn}
              className="flex-1 justify-center"
              disabled={zoomLevel >= 200}
              variant="secondary"
            ></Button>
          </div>
        </div>
      ),
      preventClose: true,
    },
    ...(isPhone && !isEditMode
      ? [
          {
            element: (
              <div className="flex gap-2 w-full">
                <UndoButton
                  variant="secondary"
                  color="black"
                  className="w-full justify-center"
                />
                <RedoButton
                  variant="secondary"
                  color="black"
                  className="w-full justify-center"
                />
              </div>
            ),
            preventClose: true,
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
