import { NavLink } from "react-router-dom";
import Icon from "../../../components/Icon/Icon";
import { cn } from "@/utils/cnHelper";
import { ACCOUNT_SECTIONS } from "../accountConstants";

type AccountSidebarNavProps = {
  /** Called after a section link is chosen (e.g. close the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
};

const AccountSidebarNav = ({ onNavigate, className }: AccountSidebarNavProps) => (
  <nav
    className={cn("flex flex-col gap-2", className)}
    aria-label="Church administration sections"
  >
    {ACCOUNT_SECTIONS.map((section) => (
      <NavLink
        key={section.id}
        to={section.path}
        aria-label={section.label}
        onClick={() => onNavigate?.()}
        className={({ isActive }) =>
          cn(
            "group flex items-center gap-2 rounded-none border px-2 py-2.5 text-left text-sm transition-colors",
            isActive
              ? "border-cyan-400/40 bg-cyan-500/15 text-white"
              : "border-transparent text-gray-200 hover:bg-gray-800 hover:text-white",
          )
        }
      >
        <Icon svg={section.icon} size="md" className="shrink-0 text-cyan-300" />
        <span className="min-w-0 truncate font-semibold">{section.label}</span>
      </NavLink>
    ))}
  </nav>
);

export default AccountSidebarNav;
