import { Link, useLocation } from "react-router-dom";
import Icon from "../../../components/Icon/Icon";
import { cn } from "@/utils/cnHelper";
import { ACCOUNT_NAV_GROUPS, getActiveAccountSection } from "../accountConstants";
import {
  isUnmodifiedLeftClick,
  usePendingRouteNavigation,
} from "../../../hooks/usePendingRouteNavigation";

type AccountSidebarNavProps = {
  /** Called after a section link is chosen (e.g. close the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
};

const AccountSidebarNav = ({ onNavigate, className }: AccountSidebarNavProps) => {
  const location = useLocation();
  const { pathname: pendingPathname, request } = usePendingRouteNavigation();
  const selectedSection = getActiveAccountSection(
    pendingPathname || location.pathname,
  );

  return (
    <nav
      className={cn("flex flex-col gap-3", className)}
      aria-label="Church administration sections"
    >
      {ACCOUNT_NAV_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          <h2 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {group.label}
          </h2>
          {group.sections.map((section) => (
            <Link
              key={section.id}
              to={section.path}
              aria-label={section.label}
              aria-current={selectedSection.id === section.id ? "page" : undefined}
              aria-busy={pendingPathname && selectedSection.id === section.id ? true : undefined}
              onClick={(event) => {
                if (!isUnmodifiedLeftClick(event)) return;
                event.preventDefault();
                request(section.path);
                onNavigate?.();
              }}
              className={cn(
                "group flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-2 py-2 text-left text-sm transition-colors",
                selectedSection.id === section.id
                  ? "border-cyan-400/30 bg-cyan-500/10 text-white"
                  : "border-transparent text-gray-200 hover:bg-gray-800 hover:text-white",
              )}
            >
              <Icon svg={section.icon} size="sm" className="shrink-0 text-cyan-300" />
              <span className="min-w-0 truncate font-medium">{section.label}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
};

export default AccountSidebarNav;
