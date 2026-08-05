import { NavLink, useLocation } from "react-router-dom";
import { CalendarRange, Users } from "lucide-react";
import Icon from "../../../components/Icon/Icon";
import Button from "../../../components/Button/Button";
import { SectionTabs } from "../../../components/SectionTabs/SectionTabs";
import { cn } from "@/utils/cnHelper";
import {
  getActiveDomain,
  servicesNavSections,
  teamsNavSections,
  type TeamsNavDomain,
  type TeamsNavSection,
} from "../teamsNavSections";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";

type TeamsSidebarNavProps = {
  /** Called after a section link is chosen (e.g. close the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
  /** Desktop-only: hide labels/descriptions and show icons only. */
  collapsed?: boolean;
};

const DOMAIN_TABS: {
  domain: TeamsNavDomain;
  label: string;
  defaultPath: string;
  icon: typeof Users;
}[] = [
    {
      domain: "teams",
      label: "Teams",
      defaultPath: teamsNavSections[0].path,
      icon: Users,
    },
    {
      domain: "services",
      label: "Services",
      defaultPath: servicesNavSections[0].path,
      icon: CalendarRange,
    },
  ];

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
    <div className={cn("flex flex-col", collapsed ? "items-center gap-2" : "gap-3")}>
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
                : "flex items-start gap-3 px-3 py-3",
              isActive
                ? "border-cyan-400/40 bg-cyan-500/15 text-white"
                : "border-transparent text-gray-200 hover:bg-gray-800 hover:text-white",
            )
          }
        >
          <Icon
            svg={section.icon}
            size="md"
            className={cn(
              "shrink-0 text-cyan-300",
              !collapsed && "mt-0.5",
            )}
          />
          {!collapsed ? (
            <span className="min-w-0">
              <span className="block font-semibold">{section.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-gray-400 group-hover:text-gray-300">
                {section.description}
              </span>
            </span>
          ) : null}
        </NavLink>
      ))}
    </div>
  );
};

/**
 * Teams and Services share this one page/sidebar shell — scheduling always
 * happens for a specific service, so switching between "who's assigned" and
 * "what's happening" for it should be a click, not a different page. The
 * domain tabs at the top act as the "back" affordance: switching domains
 * swaps which subsection list is shown below.
 */
const TeamsSidebarNav = ({
  onNavigate,
  className,
  collapsed = false,
}: TeamsSidebarNavProps) => {
  const location = useLocation();
  const { requestNavigation } = useTeamsNavigationGuard();
  const activeDomain = getActiveDomain(location.pathname);
  const activeSections =
    activeDomain === "services" ? servicesNavSections : teamsNavSections;

  if (collapsed) {
    return (
      <nav
        className={cn("flex min-h-0 flex-1 flex-col items-center", className)}
        aria-label="Teams sections"
      >
        <div
          className="flex shrink-0 flex-col items-center gap-1 rounded-xl bg-gray-950 p-1"
          role="tablist"
          aria-label="Teams or Services"
        >
          {DOMAIN_TABS.map((tab) => {
            const isActive = tab.domain === activeDomain;
            return (
              <Button
                key={tab.domain}
                type="button"
                variant="tertiary"
                padding="p-0"
                role="tab"
                aria-selected={isActive}
                aria-label={tab.label}
                title={tab.label}
                className={cn(
                  "flex size-9 min-h-0 max-md:min-h-0 items-center justify-center rounded-lg",
                  isActive
                    ? "bg-cyan-500/15 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white",
                )}
                onClick={() => {
                  if (isActive) return;
                  requestNavigation(tab.defaultPath, { onNavigated: onNavigate });
                }}
              >
                <Icon svg={tab.icon} size="sm" className="text-cyan-300" />
              </Button>
            );
          })}
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-px scrollbar-variable">
          <SectionLinkList
            sections={activeSections}
            onNavigate={onNavigate}
            collapsed
          />
        </div>
      </nav>
    );
  }

  return (
    <nav
      className={cn("flex min-h-0 flex-1 flex-col", className)}
      aria-label="Teams sections"
    >
      <SectionTabs<TeamsNavDomain>
        value={activeDomain}
        onValueChange={(domain) => {
          const next = DOMAIN_TABS.find((tab) => tab.domain === domain);
          if (!next) return;
          requestNavigation(next.defaultPath, { onNavigated: onNavigate });
        }}
        className="flex min-h-0 flex-1 flex-col"
        tabBarClassName="shrink-0 overflow-visible rounded-xl bg-gray-950"
        tabsContentClassName="mt-3 min-h-0 flex-1 space-y-0 overflow-x-hidden overflow-y-auto p-px scrollbar-variable"
        items={DOMAIN_TABS.map((tab) => ({
          value: tab.domain,
          label: tab.label,
          icon: tab.icon,
          content: (
            <SectionLinkList
              sections={
                tab.domain === "services"
                  ? servicesNavSections
                  : teamsNavSections
              }
              onNavigate={onNavigate}
            />
          ),
          contentClassName: "outline-none",
        }))}
      />
    </nav>
  );
};

export default TeamsSidebarNav;
