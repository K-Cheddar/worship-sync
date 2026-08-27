import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Icon from "../Icon/Icon";
import HomeToolbarMenu from "../HomeToolbarMenu/HomeToolbarMenu";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import { ChurchLogoImg } from "../ChurchLogoImg";

type AppWorkspaceShellProps = {
  title: string;
  icon: LucideIcon;
  toolbarLogoUrl?: string | null;
  churchName?: string | null;
  scrollbarWidth?: number;
  toolbarActions?: ReactNode;
  children: ReactNode;
};

/** Shared full-window shell for pages with a fixed toolbar and workspace body. */
const AppWorkspaceShell = ({
  title,
  icon,
  toolbarLogoUrl,
  churchName,
  scrollbarWidth,
  toolbarActions,
  children,
}: AppWorkspaceShellProps) => {
  return (
    <main
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-homepage-canvas text-white"
      style={{ "--scrollbar-width": scrollbarWidth } as CSSProperties}
    >
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col">
        <div className="grid w-full shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-gray-700 px-4 py-2 text-lg lg:px-6">
          <div className="flex flex-wrap items-center gap-3 justify-self-start">
            <HomeToolbarMenu />
            <h1 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
              <Icon svg={icon} size="md" className="text-orange-400" />
              {title}
            </h1>
          </div>
          <div className="flex max-w-[min(22rem,calc(100vw-6rem))] justify-center justify-self-center px-1 sm:max-w-[min(26rem,calc(100vw-10rem))]">
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
