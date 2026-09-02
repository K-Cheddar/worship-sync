import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Icon from "../Icon/Icon";
import HomeToolbarMenu from "../HomeToolbarMenu/HomeToolbarMenu";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import { ChurchLogoImg } from "../ChurchLogoImg";
import { cn } from "../../utils/cnHelper";
import type { MenuItemType } from "../../types";

type AppWorkspaceShellProps = {
  title: string;
  mobileTitle?: string;
  centerTitleOnMobile?: boolean;
  icon: LucideIcon;
  toolbarLogoUrl?: string | null;
  churchName?: string | null;
  scrollbarWidth?: number;
  toolbarActions?: ReactNode;
  /** Replaces the standard dropdown menu on narrow screens. */
  mobileNavigation?: (menuItems: MenuItemType[]) => ReactNode;
  children: ReactNode;
};

/** Shared full-window shell for pages with a fixed toolbar and workspace body. */
const AppWorkspaceShell = ({
  title,
  mobileTitle,
  centerTitleOnMobile = false,
  icon,
  toolbarLogoUrl,
  churchName,
  scrollbarWidth,
  toolbarActions,
  mobileNavigation,
  children,
}: AppWorkspaceShellProps) => {
  return (
    <main
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-homepage-canvas text-white"
      style={{ "--scrollbar-width": scrollbarWidth } as CSSProperties}
    >
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col">
        <div className="relative grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-b border-gray-700 px-2 py-1 text-lg sm:grid-cols-[1fr_auto_1fr] sm:gap-4 sm:px-4 sm:py-2 lg:px-6">
          <div className="flex min-w-0 items-center gap-1 justify-self-start sm:gap-3">
            <HomeToolbarMenu mobileMenuRenderer={mobileNavigation} />
            <h1 className={cn(
              "flex min-w-0 items-center gap-1 truncate text-sm font-semibold sm:gap-2 sm:text-lg",
              centerTitleOnMobile && "max-sm:absolute max-sm:left-1/2 max-sm:max-w-[45vw] max-sm:-translate-x-1/2",
            )}>
              <Icon svg={icon} size="sm" className="shrink-0 text-orange-400 sm:size-5" />
              <span className="truncate sm:hidden">{mobileTitle ?? title}</span>
              <span className="hidden truncate sm:inline">{title}</span>
            </h1>
          </div>
          <div className="hidden max-w-[min(26rem,calc(100vw-10rem))] justify-center justify-self-center px-1 sm:flex">
            {toolbarLogoUrl ? (
              <ChurchLogoImg
                src={toolbarLogoUrl}
                alt={churchName ? `${churchName} logo` : "Church logo"}
                variant="account-header"
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end justify-self-end gap-4">
            {toolbarActions}
            <UserSection />
          </div>
        </div>
        {children}
      </div>
    </main>
  );
};

export default AppWorkspaceShell;
