import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type UIEvent } from "react";
import { useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import Icon from "../Icon/Icon";
import HomeToolbarMenu from "../HomeToolbarMenu/HomeToolbarMenu";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import { ChurchLogoImg } from "../ChurchLogoImg";
import { cn } from "../../utils/cnHelper";
import type { MenuItemType } from "../../types";
import type { ChurchToolbarLogoUrls } from "../../utils/churchBranding";

type AppWorkspaceShellProps = {
  title: string;
  mobileTitle?: string;
  centerTitleOnMobile?: boolean;
  icon: LucideIcon;
  toolbarLogos?: ChurchToolbarLogoUrls | null;
  churchName?: string | null;
  scrollbarWidth?: string | number;
  toolbarActions?: ReactNode;
  /** Replaces the standard dropdown menu on narrow screens. */
  mobileNavigation?: (menuItems: MenuItemType[]) => ReactNode;
  workspaceNavigation?: (menuItems: MenuItemType[], updateReady: boolean) => ReactNode;
  collapseMobileHeader?: boolean;
  className?: string;
  children: ReactNode;
};

/** Shared full-window shell for pages with a fixed toolbar and workspace body. */
const AppWorkspaceShell = ({
  title,
  mobileTitle,
  centerTitleOnMobile = false,
  icon,
  toolbarLogos,
  churchName,
  scrollbarWidth,
  toolbarActions,
  mobileNavigation,
  workspaceNavigation,
  collapseMobileHeader = false,
  className,
  children,
}: AppWorkspaceShellProps) => {
  const { pathname } = useLocation();
  const [collapsedAtPath, setCollapsedAtPath] = useState<string | null>(null);
  const collapsed = collapseMobileHeader && collapsedAtPath === pathname;
  const scrollPositions = useRef(new WeakMap<HTMLElement, number>());
  useLayoutEffect(() => {
    setCollapsedAtPath(null);
    scrollPositions.current = new WeakMap();
  }, [pathname]);
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!collapseMobileHeader || !window.matchMedia("(max-width: 1023px)").matches ||
      !(target instanceof HTMLElement) || !event.currentTarget.contains(target) ||
      target.scrollHeight <= target.clientHeight) return;
    const previous = scrollPositions.current.get(target) ?? 0;
    const next = Math.max(0, target.scrollTop);
    if (Math.abs(next - previous) < 8 && next > 0) return;
    scrollPositions.current.set(target, next);
    if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') ||
      document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return;
    if (next <= 0 || next < previous) setCollapsedAtPath(null);
    else if (next > 64) setCollapsedAtPath(pathname);
  };
  const logoAlt = churchName ? `${churchName} logo` : "Church logo";
  const compactLogoUrl = toolbarLogos?.compact?.trim() || "";
  const expandedLogoUrl = toolbarLogos?.expanded?.trim() || compactLogoUrl;
  const hasDistinctExpandedLogo =
    Boolean(compactLogoUrl) && compactLogoUrl !== expandedLogoUrl;

  return (
    <main
      className={cn("flex h-dvh min-h-0 flex-col overflow-hidden bg-homepage-canvas text-white", className)}
      style={{ "--scrollbar-width": scrollbarWidth } as CSSProperties}
    >
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col" onScrollCapture={handleScroll} onFocusCapture={() => setCollapsedAtPath(null)}>
        <header aria-label="Application header" className={cn(collapseMobileHeader ? "grid shrink-0 grid-rows-[1fr] transition-[grid-template-rows] duration-200 motion-reduce:transition-none" : "contents", collapsed && "max-lg:grid-rows-[0fr]")}>
          <div className={collapseMobileHeader ? "min-h-0 overflow-hidden" : "contents"}>
            <div className="relative grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-b border-gray-700 px-2 py-1 text-lg sm:grid-cols-[1fr_auto_1fr] sm:gap-4 sm:px-4 sm:py-2 lg:px-6">
              <div className="flex min-w-0 items-center gap-1 justify-self-start sm:gap-3">
                <HomeToolbarMenu mobileMenuRenderer={mobileNavigation} menuRenderer={workspaceNavigation} />
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
                {compactLogoUrl ? (
                  hasDistinctExpandedLogo ? (
                    <>
                      <ChurchLogoImg
                        src={compactLogoUrl}
                        alt={logoAlt}
                        variant="account-header"
                        className="lg:hidden"
                      />
                      <ChurchLogoImg
                        src={expandedLogoUrl}
                        alt={logoAlt}
                        variant="account-header"
                        className="hidden lg:block"
                      />
                    </>
                  ) : (
                    <ChurchLogoImg
                      src={compactLogoUrl}
                      alt={logoAlt}
                      variant="account-header"
                    />
                  )
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-end justify-self-end gap-4">
                {toolbarActions}
                <UserSection />
              </div>
            </div>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
};

export default AppWorkspaceShell;
