import TeamsNavigationLink from "./TeamsNavigationLink";
import { useLocation } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import Icon from "../../../components/Icon/Icon";
import { cn } from "@/utils/cnHelper";
import { getAvailableTeamsNavGroups, matchesTeamsNavPath, type TeamsNavSection } from "../teamsNavSections";
import {
  usePendingTeamsNavigation,
} from "../TeamsNavigationGuardContext";
import { useTeamsPage } from "../TeamsPageContext";

type TeamsSidebarNavProps = {
  /** Called after a section link is chosen (e.g. close the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
  /** Desktop-only: hide labels and section headers and show icons only. */
  collapsed?: boolean;
  /** Let a parent drawer provide the scroll container. */
  scrollable?: boolean;
  includeHome?: boolean;
};

const SectionLinkList = ({
  sections,
  onNavigate,
  collapsed = false,
}: {
  sections: TeamsNavSection[];
  onNavigate?: () => void;
  collapsed?: boolean;
}) => {
  const { pathname: pendingPathname } = usePendingTeamsNavigation();
  const location = useLocation();
  const activePath = pendingPathname || location.pathname;

  return (
    <div className={cn("flex flex-col", collapsed ? "items-center gap-1" : "gap-0.5")}>
      {sections.map((section) => {
        const isActive =
          matchesTeamsNavPath(activePath, section.path);
        const isLoading = Boolean(
          pendingPathname && matchesTeamsNavPath(pendingPathname, section.path),
        );
        return (
          <TeamsNavigationLink
            key={section.path}
            path={section.path}
            aria-label={section.label}
            aria-current={isActive ? "page" : undefined}
            aria-busy={isLoading || undefined}
            title={collapsed ? section.label : undefined}
            onNavigate={onNavigate}
            className={cn(
              // Border (not ring) so overflow scrollports do not clip the active outline.
              "group rounded-lg border text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200",
              collapsed
                ? "flex size-10 items-center justify-center p-0"
                : "flex items-center gap-2 px-2 py-1.5",
              isActive
                ? "border-cyan-400/40 bg-cyan-500/15 text-white"
                : "border-transparent text-gray-200 hover:bg-gray-800 hover:text-white",
            )}
          >
            <Icon svg={section.icon} size="md" className="shrink-0 text-cyan-300" />
            {!collapsed ? (
              <span className="min-w-0 flex-1 truncate font-semibold">{section.label}</span>
            ) : null}
            {isLoading ? (
              <LoaderCircle
                className="size-3.5 shrink-0 animate-spin text-cyan-200"
                aria-hidden
                data-testid="teams-navigation-loading-indicator"
              />
            ) : null}
          </TeamsNavigationLink>
        );
      })}
    </div>
  );
};

const SectionGroup = ({
  label,
  sections,
  onNavigate,
  collapsed = false,
}: {
  label: string;
  sections: TeamsNavSection[];
  onNavigate?: () => void;
  collapsed?: boolean;
}) => (
  <section aria-label={label}>
    {!collapsed ? (
      <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </h2>
    ) : null}
    <SectionLinkList
      sections={sections}
      onNavigate={onNavigate}
      collapsed={collapsed}
    />
  </section>
);

/**
 * Teams and Services share one navigation shell. Keep both groups visible so
 * operators can move directly between service planning and team management.
 */
const TeamsSidebarNav = ({
  onNavigate,
  className,
  collapsed = false,
  scrollable = true,
  includeHome = true,
}: TeamsSidebarNavProps) => {
  const { availableNavSections } = useTeamsPage();
  const groups = getAvailableTeamsNavGroups(availableNavSections).filter((group) => includeHome || group.label !== "Home");

  return (
    <nav
      className={cn(
        "flex flex-col",
        scrollable && "min-h-0 flex-1",
        className,
      )}
      aria-label="Teams and Services sections"
    >
      <div
        className={cn(
          scrollable && "min-h-0 flex-1 overflow-x-hidden overflow-y-auto scrollbar-variable",
          collapsed ? "p-0" : "p-px",
        )}
      >
        {groups.map((group, index) => (
          <div key={group.label} className={cn(index > 0 && "mt-2 border-t border-gray-700 pt-2")}>
            {group.label === "Home" ? (
              <SectionLinkList sections={group.sections} onNavigate={onNavigate} collapsed={collapsed} />
            ) : (
              <SectionGroup label={group.label} sections={group.sections} onNavigate={onNavigate} collapsed={collapsed} />
            )}
          </div>
        ))}
      </div>
    </nav>
  );
};

export default TeamsSidebarNav;
