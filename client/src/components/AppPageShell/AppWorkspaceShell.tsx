import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type TransitionEvent, type UIEvent } from "react";
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
  compactMobileToolbar?: boolean;
  className?: string;
  children: ReactNode;
};

type HeaderTransitionHandlers = {
  onTransitionRun: (event: TransitionEvent<HTMLElement>) => void;
  onTransitionEnd: (event: TransitionEvent<HTMLElement>) => void;
  onTransitionCancel: (event: TransitionEvent<HTMLElement>) => void;
};

type CollapsibleWorkspaceContentProps = {
  pathname: string;
  renderHeader: (collapsed: boolean, transitionHandlers: HeaderTransitionHandlers) => ReactNode;
  children: ReactNode;
};

/** Owns scroll state and listeners only for shells that opt into header collapse. */
const CollapsibleWorkspaceContent = ({ pathname, renderHeader, children }: CollapsibleWorkspaceContentProps) => {
  const [collapsedAtPath, setCollapsedAtPath] = useState<string | null>(null);
  const collapsed = collapsedAtPath === pathname;
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollOwnerRef = useRef<HTMLElement | null>(null);
  const scrollPositionRef = useRef(0);
  const upwardScrollDistanceRef = useRef(0);
  const headerTransitioningRef = useRef(false);
  const transitionRebaseFrameRef = useRef<number | null>(null);
  const pointerDownRef = useRef(false);
  const pointerFocusRevealPendingRef = useRef(false);
  const pointerFocusFallbackRef = useRef<number | null>(null);
  const pointerFocusRevealFrameRef = useRef<number | null>(null);

  const resolveScrollOwner = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    for (let current: Element | null = target; current && contentRef.current?.contains(current); current = current.parentElement) {
      if (!(current instanceof HTMLElement)) continue;
      const element = current;
      const ownerType = element.dataset.mobileHeaderScrollOwner;
      if (ownerType === "page" || ownerType === "workspace") return element;
      const overflowY = getComputedStyle(element).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight) {
        return null;
      }
    }
    return null;
  };

  const noteScrollOwnerInteraction = (target: EventTarget | null, preservePosition = false) => {
    const owner = resolveScrollOwner(target);
    if (!owner) return;
    if (owner !== scrollOwnerRef.current) {
      scrollOwnerRef.current = owner;
      upwardScrollDistanceRef.current = 0;
    }
    if (!preservePosition) scrollPositionRef.current = owner.scrollTop;
  };

  const resetScrollTracking = useCallback(() => {
    if (transitionRebaseFrameRef.current !== null) {
      cancelAnimationFrame(transitionRebaseFrameRef.current);
      transitionRebaseFrameRef.current = null;
    }
    const owner = contentRef.current?.querySelector<HTMLElement>(
      '[data-mobile-header-scroll-owner="workspace"]',
    ) ?? null;
    scrollOwnerRef.current = owner;
    scrollPositionRef.current = owner?.scrollTop ?? 0;
    upwardScrollDistanceRef.current = 0;
    headerTransitioningRef.current = false;
    pointerDownRef.current = false;
    pointerFocusRevealPendingRef.current = false;
    if (pointerFocusFallbackRef.current !== null) {
      window.clearTimeout(pointerFocusFallbackRef.current);
      pointerFocusFallbackRef.current = null;
    }
    if (pointerFocusRevealFrameRef.current !== null) {
      cancelAnimationFrame(pointerFocusRevealFrameRef.current);
      pointerFocusRevealFrameRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    setCollapsedAtPath(null);
    resetScrollTracking();
  }, [pathname, resetScrollTracking]);

  useLayoutEffect(() => () => {
    if (transitionRebaseFrameRef.current !== null) {
      cancelAnimationFrame(transitionRebaseFrameRef.current);
    }
  }, []);

  useEffect(() => {
    const finishPointerInteraction = () => {
      pointerDownRef.current = false;
      if (!pointerFocusRevealPendingRef.current) return;
      pointerFocusFallbackRef.current = window.setTimeout(() => {
        pointerFocusFallbackRef.current = null;
        if (!pointerFocusRevealPendingRef.current) return;
        pointerFocusRevealPendingRef.current = false;
        setCollapsedAtPath(null);
      }, 120);
    };
    window.addEventListener("pointerup", finishPointerInteraction, true);
    window.addEventListener("pointercancel", finishPointerInteraction, true);
    return () => {
      window.removeEventListener("pointerup", finishPointerInteraction, true);
      window.removeEventListener("pointercancel", finishPointerInteraction, true);
      if (pointerFocusFallbackRef.current !== null) window.clearTimeout(pointerFocusFallbackRef.current);
      if (pointerFocusRevealFrameRef.current !== null) cancelAnimationFrame(pointerFocusRevealFrameRef.current);
    };
  }, []);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!window.matchMedia("(max-width: 1023px)").matches || !(target instanceof HTMLElement) || target.scrollHeight <= target.clientHeight) return;
    if (target !== scrollOwnerRef.current) {
      if (target.dataset.mobileHeaderScrollOwner !== "page") return;
      scrollOwnerRef.current = target;
      scrollPositionRef.current = target.scrollTop;
      upwardScrollDistanceRef.current = 0;
      return;
    }
    const next = Math.max(0, target.scrollTop);
    const previous = scrollPositionRef.current;
    scrollPositionRef.current = next;
    if (headerTransitioningRef.current) {
      upwardScrollDistanceRef.current = 0;
      return;
    }
    if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') ||
      document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) {
      upwardScrollDistanceRef.current = 0;
      return;
    }
    const delta = next - previous;
    if (delta < 0) {
      upwardScrollDistanceRef.current += Math.abs(delta);
      if (next <= 0 || upwardScrollDistanceRef.current >= 48) {
        upwardScrollDistanceRef.current = 0;
        setCollapsedAtPath(null);
      }
    } else if (delta > 0) {
      upwardScrollDistanceRef.current = 0;
      if (next > 64) setCollapsedAtPath(pathname);
    }
  };

  const handleHeaderTransition = (event: TransitionEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "grid-template-rows") return;
    upwardScrollDistanceRef.current = 0;
    if (event.type === "transitionrun") {
      if (transitionRebaseFrameRef.current !== null) {
        cancelAnimationFrame(transitionRebaseFrameRef.current);
        transitionRebaseFrameRef.current = null;
      }
      headerTransitioningRef.current = true;
      scrollPositionRef.current = scrollOwnerRef.current?.scrollTop ?? 0;
      return;
    }
    if (event.type === "transitioncancel") {
      if (transitionRebaseFrameRef.current !== null) {
        cancelAnimationFrame(transitionRebaseFrameRef.current);
        transitionRebaseFrameRef.current = null;
      }
      scrollPositionRef.current = scrollOwnerRef.current?.scrollTop ?? 0;
      headerTransitioningRef.current = false;
      return;
    }
    headerTransitioningRef.current = true;
    let stableFrames = 0;
    let previousScrollTop = scrollOwnerRef.current?.scrollTop ?? 0;
    const rebaseWhenStable = () => {
      const nextScrollTop = scrollOwnerRef.current?.scrollTop ?? 0;
      if (nextScrollTop === previousScrollTop) stableFrames += 1;
      else {
        previousScrollTop = nextScrollTop;
        stableFrames = 0;
      }
      scrollPositionRef.current = nextScrollTop;
      if (stableFrames >= 2) {
        transitionRebaseFrameRef.current = null;
        headerTransitioningRef.current = false;
        return;
      }
      transitionRebaseFrameRef.current = requestAnimationFrame(rebaseWhenStable);
    };
    transitionRebaseFrameRef.current = requestAnimationFrame(rebaseWhenStable);
  };

  return (
    <div
      ref={contentRef}
      className="mx-auto flex min-h-0 w-full flex-1 flex-col"
      onScrollCapture={handleScroll}
      onWheelCapture={(event) => noteScrollOwnerInteraction(event.target, true)}
      onTouchStartCapture={(event) => noteScrollOwnerInteraction(event.target)}
      onKeyDownCapture={(event) => noteScrollOwnerInteraction(event.target)}
      onPointerMoveCapture={(event) => noteScrollOwnerInteraction(event.target)}
      onPointerDownCapture={(event) => {
        pointerDownRef.current = true;
        noteScrollOwnerInteraction(event.target);
      }}
      onFocusCapture={() => {
        if (pointerDownRef.current) {
          pointerFocusRevealPendingRef.current = true;
          return;
        }
        setCollapsedAtPath(null);
      }}
      onClickCapture={() => {
        if (!pointerFocusRevealPendingRef.current) return;
        pointerFocusRevealPendingRef.current = false;
        if (pointerFocusFallbackRef.current !== null) {
          window.clearTimeout(pointerFocusFallbackRef.current);
          pointerFocusFallbackRef.current = null;
        }
        pointerFocusRevealFrameRef.current = requestAnimationFrame(() => {
          pointerFocusRevealFrameRef.current = null;
          setCollapsedAtPath(null);
        });
      }}
    >
      {renderHeader(collapsed, {
        onTransitionRun: handleHeaderTransition,
        onTransitionEnd: handleHeaderTransition,
        onTransitionCancel: handleHeaderTransition,
      })}
      {children}
    </div>
  );
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
  compactMobileToolbar = false,
  className,
  children,
}: AppWorkspaceShellProps) => {
  const { pathname } = useLocation();
  const logoAlt = churchName ? churchName + " logo" : "Church logo";
  const compactLogoUrl = toolbarLogos?.compact?.trim() || "";
  const expandedLogoUrl = toolbarLogos?.expanded?.trim() || compactLogoUrl;
  const hasDistinctExpandedLogo =
    Boolean(compactLogoUrl) && compactLogoUrl !== expandedLogoUrl;

  const renderHeader = (
    collapsed: boolean,
    transitionHandlers?: HeaderTransitionHandlers,
  ) => (
    <header
      aria-label="Application header"
      {...transitionHandlers}
      className={cn(
        collapseMobileHeader
          ? "grid shrink-0 grid-rows-[1fr] transition-[grid-template-rows] duration-200 motion-reduce:transition-none"
          : "contents",
        collapsed && "max-lg:grid-rows-[0fr]",
      )}
    >
      <div className={collapseMobileHeader ? "min-h-0 overflow-hidden" : "contents"}>
        <div
          data-app-toolbar
          data-testid="app-workspace-toolbar"
          className={cn(
            "relative grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-gray-700",
            compactMobileToolbar
              ? "h-[48px] min-h-[48px] gap-2 px-2 py-0 text-base lg:h-auto lg:min-h-0 lg:grid-cols-[1fr_auto_1fr] lg:gap-4 lg:px-6 lg:py-2 lg:text-lg"
              : "gap-1 px-2 py-1 text-lg sm:grid-cols-[1fr_auto_1fr] sm:gap-4 sm:px-4 sm:py-2 lg:px-6",
          )}
        >
          <div className="flex min-w-0 items-center gap-1 justify-self-start sm:gap-3">
            <HomeToolbarMenu mobileMenuRenderer={mobileNavigation} menuRenderer={workspaceNavigation} />
            <h1 data-testid="app-workspace-title" className={cn(
              "flex min-w-0 items-center gap-1 truncate text-sm font-semibold sm:gap-2 sm:text-lg",
              compactMobileToolbar && "hidden lg:flex",
              centerTitleOnMobile && "max-sm:absolute max-sm:left-1/2 max-sm:max-w-[45vw] max-sm:-translate-x-1/2",
            )}>
              <Icon svg={icon} size="sm" className="shrink-0 text-orange-400 sm:size-5" />
              <span className="truncate sm:hidden">{mobileTitle ?? title}</span>
              <span className="hidden truncate sm:inline">{title}</span>
            </h1>
          </div>
          <div className={cn(
            "hidden max-w-[min(26rem,calc(100vw-10rem))] justify-center justify-self-center px-1",
            compactMobileToolbar ? "lg:flex" : "sm:flex",
          )}>
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
          <div className={cn(
            "flex min-w-0 items-center justify-end justify-self-end",
            compactMobileToolbar ? "flex-nowrap gap-2 lg:flex-wrap lg:gap-4" : "flex-wrap gap-4",
          )}>
            {toolbarActions}
            <UserSection variant={compactMobileToolbar ? "responsiveCompact" : "default"} />
          </div>
        </div>
      </div>
    </header>
  );

  return (
    <main
      className={cn("flex h-dvh min-h-0 flex-col overflow-hidden bg-homepage-canvas text-white", className)}
      style={{ "--scrollbar-width": scrollbarWidth } as CSSProperties}
    >
      {collapseMobileHeader ? (
        <CollapsibleWorkspaceContent pathname={pathname} renderHeader={renderHeader}>
          {children}
        </CollapsibleWorkspaceContent>
      ) : (
        <div className="mx-auto flex min-h-0 w-full flex-1 flex-col">
          {renderHeader(false)}
          {children}
        </div>
      )}
    </main>
  );
};

export default AppWorkspaceShell;
