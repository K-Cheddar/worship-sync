import { useEffect, useState } from "react";
import { CalendarCheck, CalendarClock, ChevronLeft, ChevronRight, CircleAlert, Menu as MenuIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import Sidebar, { APP_SIDEBAR_WIDTH_CLASS } from "../components/Sidebar/Sidebar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import type { MenuItemType } from "../types";
import type { PersonalScheduleAccess } from "./myScheduleOperations";
import VolunteerNavigationLink, { useVolunteerNavigationGuard } from "./VolunteerNavigationGuard";

type VolunteerPage = "schedule" | "availability";

const linksFor = (access?: PersonalScheduleAccess) => access
  ? [
      { id: "schedule" as const, label: "My Schedule", to: "/s?view=schedule", icon: CalendarClock },
      { id: "availability" as const, label: "My Availability", to: "/s?view=availability", icon: CalendarCheck },
    ]
  : [
      { id: "schedule" as const, label: "My Schedule", to: "/my-schedule", icon: CalendarClock },
      { id: "availability" as const, label: "My Availability", to: "/my-availability", icon: CalendarCheck },
    ];

const navigationLinkClass = (active: boolean) =>
  `flex min-h-11 items-center gap-2 rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 ${
    active
      ? "bg-teal-900/50 font-semibold text-teal-100"
      : "text-gray-300 hover:bg-gray-800 hover:text-white"
  }`;

/** Desktop sidebar and mobile bottom bar for both volunteer workspaces. */
const VolunteerSelfServiceNavigation = ({
  access,
  active,
  collapsed,
  onToggleCollapsed,
}: {
  access?: PersonalScheduleAccess;
  active: VolunteerPage;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) => {
  const links = linksFor(access);
  return (
    <>
      <Sidebar
        data-testid="volunteer-desktop-sidebar"
        className={`relative hidden min-w-0 flex-col gap-1 transition-[width,padding] duration-300 ease-in-out lg:flex lg:border-r ${
          collapsed ? "w-14 lg:p-2" : `${APP_SIDEBAR_WIDTH_CLASS} lg:p-2`
        }`}
      >
        <Button
          type="button"
          variant="tertiary"
          padding="p-0"
          position="absolute"
          className="right-0 top-1/2 z-20 flex size-8 min-h-0 shrink-0 -translate-y-1/2 items-center justify-center rounded-full border border-gray-700 bg-gray-950 shadow-sm max-md:min-h-0"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sections" : "Collapse sections"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronRight className="size-4 shrink-0" aria-hidden /> : <ChevronLeft className="size-4 shrink-0" aria-hidden />}
        </Button>
        {!collapsed ? (
          <h2 className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            My workspace
          </h2>
        ) : null}
        <nav aria-label="Volunteer pages" className={`flex flex-col gap-1 ${collapsed ? "items-center" : ""}`}>
          {links.map((link) => (
            <VolunteerNavigationLink
              key={link.id}
              to={link.to}
              aria-label={link.label}
              aria-current={active === link.id ? "page" : undefined}
              title={collapsed ? link.label : undefined}
              className={`${navigationLinkClass(active === link.id)} ${collapsed ? "size-10 min-h-10 justify-center px-0" : ""}`}
            >
              <span aria-hidden="true"><Icon svg={link.icon} size="sm" /></span>
              {!collapsed ? <span className="min-w-0 truncate">{link.label}</span> : null}
            </VolunteerNavigationLink>
          ))}
        </nav>
      </Sidebar>

      <nav
        aria-label="Volunteer pages"
        data-testid="volunteer-mobile-bottom-navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(57px_+_env(safe-area-inset-bottom))] items-center border-t border-gray-800/80 bg-gray-950 pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {links.map((link) => {
          const selected = active === link.id;
          return (
            <VolunteerNavigationLink
              key={link.id}
              to={link.to}
              aria-current={selected ? "page" : undefined}
              className={`flex h-[56px] min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-none px-1 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-300 ${
                selected ? "font-semibold text-white" : "font-medium text-gray-400 hover:text-gray-200"
              }`}
            >
              <span className={`flex h-[30px] w-[60px] items-center justify-center rounded-full ${selected ? "bg-teal-500/15 text-teal-300" : "text-gray-400"}`}>
                <Icon svg={link.icon} size="md" />
              </span>
              <span>{link.label}</span>
            </VolunteerNavigationLink>
          );
        })}
      </nav>
    </>
  );
};

const VolunteerSelfServiceDrawer = ({
  access,
  active,
  menuItems = [],
  updateReady = false,
}: {
  access?: PersonalScheduleAccess;
  active: VolunteerPage;
  menuItems?: MenuItemType[];
  updateReady?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const { pathname, search, hash } = useLocation();
  const { requestNavigation } = useVolunteerNavigationGuard();
  const links = linksFor(access);

  useEffect(() => setOpen(false), [pathname, search, hash]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="tertiary"
        className="w-fit max-lg:min-h-[44px] max-lg:px-2 max-lg:py-1"
        aria-label="Open menu"
        aria-haspopup="dialog"
        svg={MenuIcon}
        iconSize="md"
        gap="gap-1.5"
        onClick={() => setOpen(true)}
      >
        Menu
        {updateReady ? <CircleAlert className="size-4 text-amber-400" aria-label="Update available" /> : null}
      </Button>
      <SheetContent side="left" className="flex w-[18rem] max-w-[88vw] flex-col border-gray-700 bg-gray-950/95 p-0" aria-describedby={undefined}>
        <SheetHeader className="border-gray-700 bg-gray-950/95">
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto p-4">
          {menuItems.length ? <div className="flex flex-col gap-1">
            {menuItems.map((item, index) => {
              const content = item.element || item.text;
              if (item.preventClose) {
                return (
                  <div key={index} className="mt-2 border-t border-gray-700 pt-2">
                    <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Interface zoom</p>
                    {content}
                  </div>
                );
              }
              return (
                <Button
                  key={index}
                  variant="tertiary"
                  className="w-full justify-start rounded-lg px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-800 hover:text-white max-md:min-h-10 max-md:[&>div]:min-h-0"
                  component={item.to ? "link" : "button"}
                  to={item.to}
                  onClick={(event) => {
                    item.onClick?.();
                    if (item.to) {
                      event.preventDefault();
                      requestNavigation(item.to, { onNavigated: () => setOpen(false) });
                    } else {
                      setOpen(false);
                    }
                  }}
                >
                  {content}
                </Button>
              );
            })}
          </div> : null}
          <div className={menuItems.length ? "mt-4 border-t border-gray-700 pt-3" : "pt-3"}>
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">My workspace</p>
            <nav aria-label="Volunteer pages" className="flex flex-col gap-1">
              {links.map((link) => (
                <VolunteerNavigationLink
                  key={link.id}
                  to={link.to}
                  aria-current={active === link.id ? "page" : undefined}
                  className={navigationLinkClass(active === link.id)}
                  onNavigate={() => setOpen(false)}
                >
                  <span aria-hidden="true"><Icon svg={link.icon} size="sm" /></span>
                  {link.label}
                </VolunteerNavigationLink>
              ))}
            </nav>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default VolunteerSelfServiceNavigation;
export { VolunteerSelfServiceDrawer };
