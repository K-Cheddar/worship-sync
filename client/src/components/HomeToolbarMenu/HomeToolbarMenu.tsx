import { useContext, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { CircleAlert, Home as HomeIcon, Menu as MenuIcon } from "lucide-react";
import Button from "../Button/Button";
import Icon from "../Icon/Icon";
import Menu from "../Menu/Menu";
import { useAboutChangelogMenu } from "../../hooks/useAboutChangelogMenu";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { MenuItemType } from "../../types";

export type HomeToolbarMenuProps = {
  /** Inserted after optional Home, before Changelog and About */
  extraMenuItems?: MenuItemType[];
};

const HomeToolbarMenu = ({ extraMenuItems }: HomeToolbarMenuProps = {}) => {
  const { pathname } = useLocation();
  const hideHomeMenuItem = pathname === "/home";
  const { loginState, exitGuestMode } = useContext(GlobalInfoContext) || {};
  const isGuest = loginState === "guest";
  const {
    aboutChangelogMenuItems,
    aboutChangelogModals,
    updateReadyVersion,
  } = useAboutChangelogMenu();

  const homeMenuItem = useMemo((): MenuItemType => {
    return {
      element: (
        <div className="flex items-center gap-2 max-md:min-h-12">
          <Icon svg={HomeIcon} color="#d1d5dc" />
          {isGuest ? "Return to start" : "Home"}
        </div>
      ),
      ...(isGuest
        ? {
          onClick: () => {
            void exitGuestMode?.();
          },
        }
        : { to: "/" }),
    };
  }, [exitGuestMode, isGuest]);

  const menuItems = useMemo(() => {
    const trailing = [...(extraMenuItems ?? []), ...aboutChangelogMenuItems];
    if (hideHomeMenuItem) {
      return trailing;
    }
    return [homeMenuItem, ...trailing];
  }, [
    aboutChangelogMenuItems,
    extraMenuItems,
    hideHomeMenuItem,
    homeMenuItem,
  ]);

  return (
    <>
      <Menu
        menuItems={menuItems}
        align="start"
        TriggeringButton={
          <Button
            variant="tertiary"
            className="w-fit"
            aria-label="Open menu"
            svg={MenuIcon}
            iconSize="md"
            gap="gap-1.5"
          >
            Menu
            {updateReadyVersion ? (
              <Icon svg={CircleAlert} color="#f59e0b" size="sm" />
            ) : null}
          </Button>
        }
      />
      {aboutChangelogModals}
    </>
  );
};

export default HomeToolbarMenu;
