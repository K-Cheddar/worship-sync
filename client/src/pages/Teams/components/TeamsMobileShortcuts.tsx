import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import Icon from "../../../components/Icon/Icon";
import { useTeamsPage } from "../TeamsPageContext";
import { usePendingTeamsNavigation } from "../TeamsNavigationGuardContext";
import { getAvailableTeamsNavGroups, matchesTeamsNavPath } from "../teamsNavSections";
import TeamsNavigationLink from "./TeamsNavigationLink";

const linkStyle = "rounded-md border border-transparent text-gray-300 hover:bg-gray-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 aria-[current=page]:border-cyan-400/40 aria-[current=page]:bg-cyan-500/15 aria-[current=page]:text-cyan-300";

const TeamsMobileShortcuts = ({ secondary = false }: { secondary?: boolean }) => {
  const { availableNavSections } = useTeamsPage();
  const location = useLocation();
  const { pathname } = usePendingTeamsNavigation();
  const activePath = pathname || location.pathname;
  const groups = getAvailableTeamsNavGroups(availableNavSections);
  const activeGroup = groups.find((group) => group.sections.some((section) => matchesTeamsNavPath(activePath, section.path)));
  const tabsRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    // Scroll only the tab strip, never its page or ancestor scrollports.
    const strip = tabsRef.current;
    if (!strip) return;
    const revealSelected = () => {
      const selected = strip.querySelector<HTMLElement>('[aria-current="page"]');
      if (!selected) return;
      const tab = selected.getBoundingClientRect();
      const viewport = strip.getBoundingClientRect();
      if (tab.left < viewport.left) strip.scrollLeft += tab.left - viewport.left;
      else if (tab.right > viewport.right) strip.scrollLeft += tab.right - viewport.right;
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [activePath, activeGroup?.label]);

  if (secondary) {
    if (!activeGroup || activeGroup.label === "Home") return null;
    return (
      <nav ref={tabsRef} aria-label={`${activeGroup.label} pages`} className="scrollbar-variable flex min-h-12 shrink-0 gap-1 overflow-x-auto border-b border-gray-700 bg-gray-950 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] py-1 lg:hidden">
        {activeGroup.sections.map((section) => (
          <TeamsNavigationLink key={section.path} path={section.path} className={`${linkStyle} flex min-h-10 shrink-0 items-center whitespace-nowrap px-3 text-sm font-semibold`}>
            {section.label}
          </TeamsNavigationLink>
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label="Primary navigation" className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--teams-bottom-navigation-height)] items-start border-t border-gray-700 bg-gray-950 pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pt-1 lg:hidden">
      {groups.map((group) => (
        <TeamsNavigationLink key={group.label} path={group.sections[0].path} active={group === activeGroup} className={`${linkStyle} flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs font-semibold`}>
          <Icon svg={group.icon} size="md" />
          <span>{group.label}</span>
        </TeamsNavigationLink>
      ))}
    </nav>
  );
};

export default TeamsMobileShortcuts;
