import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import Icon from "../../../components/Icon/Icon";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../components/ui/tabs";
import { cn } from "../../../utils/cnHelper";
import { useTeamsPage } from "../TeamsPageContext";
import {
  usePendingTeamsNavigation,
  useTeamsNavigationGuard,
} from "../TeamsNavigationGuardContext";
import {
  getAvailableTeamsNavGroups,
  matchesTeamsNavPath,
} from "../teamsNavSections";
import TeamsNavigationLink from "./TeamsNavigationLink";

type TeamsMobileShortcutsProps = {
  secondary?: boolean;
  /** The layout's resolved route, including the saved default for its index route. */
  activePath?: string;
  children?: ReactNode;
};

const TeamsMobileShortcuts = ({
  secondary = false,
  activePath: resolvedActivePath,
  children,
}: TeamsMobileShortcutsProps) => {
  const { availableNavSections } = useTeamsPage();
  const location = useLocation();
  const { pathname: pendingPathname } = usePendingTeamsNavigation();
  const { requestNavigation } = useTeamsNavigationGuard();
  const activePath =
    resolvedActivePath || pendingPathname || location.pathname;
  const groups = getAvailableTeamsNavGroups(availableNavSections);
  const activeGroup = groups.find((group) =>
    group.sections.some((section) => matchesTeamsNavPath(activePath, section.path)),
  );
  const activeSection = activeGroup?.sections.find((section) =>
    matchesTeamsNavPath(activePath, section.path),
  );
  const tabsRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    // Scroll only the tab strip, never its page or ancestor scrollports.
    const shell = tabsRef.current;
    const strip = shell?.querySelector<HTMLElement>('[role="tablist"]');
    if (!shell || !strip) return;

    const revealSelected = () => {
      const selected = strip.querySelector<HTMLElement>('[data-state="active"]');
      if (!selected) return;
      const tab = selected.getBoundingClientRect();
      const viewport = strip.getBoundingClientRect();
      if (tab.left < viewport.left) strip.scrollLeft += tab.left - viewport.left;
      else if (tab.right > viewport.right) strip.scrollLeft += tab.right - viewport.right;
    };

    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(shell);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [activePath, activeGroup?.label, activeSection?.path]);

  if (secondary) {
    if (!activeGroup || !activeSection) return <>{children}</>;

    return (
      <Tabs
        value={activeSection.path}
        onValueChange={requestNavigation}
        className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-0"
      >
        <nav
          ref={tabsRef}
          aria-label={`${activeGroup.label} pages`}
          className="sticky top-0 z-20 shrink-0 bg-gray-950 lg:hidden"
        >
          <TabsList
            variant="navigation"
            aria-label={`${activeGroup.label} pages`}
          >
            {activeGroup.sections.map((section) => (
              <TabsTrigger
                key={section.path}
                value={section.path}
                aria-busy={
                  pendingPathname &&
                  matchesTeamsNavPath(pendingPathname, section.path)
                    ? true
                    : undefined
                }
              >
                {section.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </nav>
        <TabsContent
          value={activeSection.path}
          className="min-h-0 min-w-0 w-full flex-1"
        >
          {children}
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--teams-bottom-navigation-height)] items-center border-t border-gray-800/80 bg-gray-950 pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pt-1 lg:hidden"
    >
      {groups.map((group) => {
        const selected = activeGroup?.label === group.label;
        return (
          <TeamsNavigationLink
            key={group.label}
            path={group.sections[0].path}
            active={selected}
            aria-label={group.label}
            className={cn(
              "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-none border-0 px-1 py-1 text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300",
              selected
                ? "font-semibold text-cyan-300"
                : "font-medium text-gray-400 hover:text-gray-200",
            )}
          >
            <span
              aria-hidden="true"
              data-testid="teams-primary-navigation-icon-pill"
              className={cn(
                "flex h-8 min-w-11 items-center justify-center rounded-full px-3 transition-colors",
                selected ? "bg-cyan-500/15 text-cyan-300" : "text-gray-400",
              )}
            >
              <Icon svg={group.icon} size="md" />
            </span>
            <span>{group.label}</span>
          </TeamsNavigationLink>
        );
      })}
    </nav>
  );
};

export default TeamsMobileShortcuts;
