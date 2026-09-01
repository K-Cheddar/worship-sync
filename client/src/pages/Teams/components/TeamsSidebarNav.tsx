import { NavLink } from "react-router-dom";
import Icon from "../../../components/Icon/Icon";
import { cn } from "@/utils/cnHelper";
import {
  servicesNavSections,
  teamsNavSections,
  type TeamsNavSection,
} from "../teamsNavSections";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";

type TeamsSidebarNavProps = {
  /** Called after a section link is chosen (e.g. close the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
  /** Desktop-only: hide labels and section headers and show icons only. */
  collapsed?: boolean;
  /** Let a parent drawer provide the scroll container. */
  scrollable?: boolean;
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
  const { requestNavigation } = useTeamsNavigationGuard();

  return (
    <div className={cn("flex flex-col", collapsed ? "items-center gap-2" : "gap-1")}>
      {sections.map((section) => (
        <NavLink
          key={section.path}
          to={section.path}
          aria-label={section.label}
          title={collapsed ? section.label : undefined}
          onClick={(event) => {
            if (
              event.button !== 0
              || event.metaKey
              || event.altKey
              || event.ctrlKey
              || event.shiftKey
            ) {
              return;
            }
            event.preventDefault();
            requestNavigation(section.path, { onNavigated: onNavigate });
          }}
          className={({ isActive }) =>
            cn(
              // Border (not ring) so overflow scrollports do not clip the active outline.
              "group rounded-lg border text-left text-sm transition-colors",
              collapsed
                ? "flex size-10 items-center justify-center p-0"
                : "flex items-center gap-2 px-2 py-2.5",
              isActive
                ? "border-cyan-400/40 bg-cyan-500/15 text-white"
                : "border-transparent text-gray-200 hover:bg-gray-800 hover:text-white",
            )
          }
        >
          <Icon svg={section.icon} size="md" className="shrink-0 text-cyan-300" />
          {!collapsed ? (
            <span className="min-w-0 truncate font-semibold">{section.label}</span>
          ) : null}
        </NavLink>
      ))}
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
}: TeamsSidebarNavProps) => (
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
      <SectionGroup
        label="Services"
        sections={servicesNavSections}
        onNavigate={onNavigate}
        collapsed={collapsed}
      />
      <div
        className={cn(
          "border-gray-700",
          collapsed ? "mt-3 border-t pt-3" : "mt-4 border-t pt-2",
        )}
      >
        <SectionGroup
          label="Teams"
          sections={teamsNavSections}
          onNavigate={onNavigate}
          collapsed={collapsed}
        />
      </div>
    </div>
  </nav>
);

export default TeamsSidebarNav;
