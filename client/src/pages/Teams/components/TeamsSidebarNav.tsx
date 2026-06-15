import { NavLink } from "react-router-dom";
import Icon from "../../../components/Icon/Icon";
import { cn } from "@/utils/cnHelper";
import { teamsNavSections } from "../teamsNavSections";

type TeamsSidebarNavProps = {
  /** Called after a section link is chosen (e.g. close the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
};

const TeamsSidebarNav = ({ onNavigate, className }: TeamsSidebarNavProps) => (
  <nav
    className={cn("flex flex-col gap-2", className)}
    aria-label="Teams sections"
  >
    {teamsNavSections.map((section) => (
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

export default TeamsSidebarNav;
