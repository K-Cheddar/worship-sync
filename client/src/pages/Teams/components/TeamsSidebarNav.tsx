import { NavLink, useLocation, useNavigate } from "react-router-dom";
import Icon from "../../../components/Icon/Icon";
import { SectionTabs } from "../../../components/SectionTabs/SectionTabs";
import { cn } from "@/utils/cnHelper";
import {
  getActiveDomain,
  servicesNavSections,
  teamsNavSections,
  type TeamsNavDomain,
  type TeamsNavSection,
} from "../teamsNavSections";

type TeamsSidebarNavProps = {
  /** Called after a section link is chosen (e.g. close the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
};

const DOMAIN_TABS: {
  domain: TeamsNavDomain;
  label: string;
  defaultPath: string;
}[] = [
    { domain: "teams", label: "Teams", defaultPath: teamsNavSections[0].path },
    {
      domain: "services",
      label: "Services",
      defaultPath: servicesNavSections[0].path,
    },
  ];

const SectionLinkList = ({
  sections,
  onNavigate,
}: {
  sections: TeamsNavSection[];
  onNavigate?: () => void;
}) => (
  <div className="flex flex-col gap-3">
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
  </div>
);

/**
 * Teams and Services share this one page/sidebar shell — scheduling always
 * happens for a specific service, so switching between "who's assigned" and
 * "what's happening" for it should be a click, not a different page. The
 * domain tabs at the top act as the "back" affordance: switching domains
 * swaps which subsection list is shown below.
 */
const TeamsSidebarNav = ({ onNavigate, className }: TeamsSidebarNavProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const activeDomain = getActiveDomain(location.pathname);

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
          navigate(next.defaultPath);
          onNavigate?.();
        }}
        className="flex min-h-0 flex-1 flex-col"
        tabBarClassName="mx-0 shrink-0 rounded-xl bg-gray-950"
        tabsContentClassName="mt-3 min-h-0 flex-1 space-y-0 overflow-y-auto scrollbar-variable"
        items={[
          {
            value: "teams",
            label: "Teams",
            content: (
              <SectionLinkList
                sections={teamsNavSections}
                onNavigate={onNavigate}
              />
            ),
            contentClassName: "outline-none",
          },
          {
            value: "services",
            label: "Services",
            content: (
              <SectionLinkList
                sections={servicesNavSections}
                onNavigate={onNavigate}
              />
            ),
            contentClassName: "outline-none",
          },
        ]}
      />
    </nav>
  );
};

export default TeamsSidebarNav;
