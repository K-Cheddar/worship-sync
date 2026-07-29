import { NavLink, useLocation } from "react-router-dom";
import Icon from "../../../components/Icon/Icon";
import { cn } from "@/utils/cnHelper";
import {
  getActiveDomain,
  servicesNavSections,
  teamsNavSections,
  type TeamsNavDomain,
} from "../teamsNavSections";

type TeamsSidebarNavProps = {
  /** Called after a section link is chosen (e.g. close the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
};

const DOMAIN_TABS: { domain: TeamsNavDomain; label: string; defaultPath: string }[] = [
  { domain: "teams", label: "Teams", defaultPath: teamsNavSections[0].path },
  { domain: "services", label: "Services", defaultPath: servicesNavSections[0].path },
];

/**
 * Teams and Services share this one page/sidebar shell — scheduling always
 * happens for a specific service, so switching between "who's assigned" and
 * "what's happening" for it should be a click, not a different page. The
 * domain tabs at the top act as the "back" affordance: switching domains
 * swaps which subsection list is shown below.
 */
const TeamsSidebarNav = ({ onNavigate, className }: TeamsSidebarNavProps) => {
  const location = useLocation();
  const activeDomain = getActiveDomain(location.pathname);
  const sections = activeDomain === "services" ? servicesNavSections : teamsNavSections;

  return (
    <nav className={cn("flex flex-col gap-3", className)} aria-label="Teams sections">
      <div
        className="flex gap-1 rounded-lg bg-gray-950/70 p-1"
        role="tablist"
        aria-label="Teams area"
      >
        {DOMAIN_TABS.map((tab) => (
          <NavLink
            key={tab.domain}
            to={tab.defaultPath}
            role="tab"
            aria-selected={activeDomain === tab.domain}
            onClick={() => onNavigate?.()}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-center text-sm font-semibold transition-colors",
              activeDomain === tab.domain
                ? "bg-cyan-500/20 text-white ring-1 ring-cyan-400/40"
                : "text-gray-300 hover:bg-gray-800 hover:text-white",
            )}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {sections.map((section) => (
        <NavLink
          key={section.path}
          to={section.path}
          aria-label={section.label}
          onClick={() => onNavigate?.()}
          className={({ isActive }) =>
            cn(
              "group flex items-start gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors",
              isActive
                ? "bg-cyan-500/15 text-white ring-1 ring-cyan-400/40"
                : "text-gray-200 hover:bg-gray-800 hover:text-white",
            )
          }
        >
          <Icon
            svg={section.icon}
            size="md"
            className="mt-0.5 shrink-0 text-cyan-300"
          />
          <span className="min-w-0">
            <span className="block font-semibold">{section.label}</span>
            <span className="mt-0.5 block text-xs leading-snug text-gray-400 group-hover:text-gray-300">
              {section.description}
            </span>
          </span>
        </NavLink>
      ))}
    </nav>
  );
};

export default TeamsSidebarNav;
