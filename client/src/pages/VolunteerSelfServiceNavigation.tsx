import { useEffect, useState } from "react";
import { CalendarCheck, CalendarClock, CircleAlert, Menu as MenuIcon } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import Sidebar from "../components/Sidebar/Sidebar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import type { MenuItemType } from "../types";
import type { PersonalScheduleAccess } from "./myScheduleOperations";

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

/** Shared desktop and mobile page navigation for the two volunteer workspaces. */
const VolunteerSelfServiceNavigation = ({
  access,
  active,
}: {
  access?: PersonalScheduleAccess;
  active: VolunteerPage;
}) => {
  const links = linksFor(access);
  return (
    <>
      <Sidebar className="hidden w-44 flex-col gap-1 border-r lg:flex">
        <h2 className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
          My workspace
        </h2>
        <nav aria-label="Volunteer pages" className="flex flex-col gap-1">
          {links.map((link) => (
            <Link
              key={link.id}
              to={link.to}
              aria-current={active === link.id ? "page" : undefined}
              className={navigationLinkClass(active === link.id)}
            >
              <span aria-hidden="true"><Icon svg={link.icon} size="sm" /></span>
              {link.label}
            </Link>
          ))}
        </nav>
      </Sidebar>

      <nav
        aria-label="Volunteer pages"
        className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(57px_+_env(safe-area-inset-bottom))] items-center border-t border-gray-800/80 bg-gray-950 pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {links.map((link) => {
          const selected = active === link.id;
          return (
            <Link
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
            </Link>
          );
        })}
      </nav>
    </>
  );
};

/** App menu drawer plus volunteer page links, without Teams-only providers. */
export const VolunteerSelfServiceDrawer = ({
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
                  onClick={() => {
                    item.onClick?.();
                    if (!item.to) setOpen(false);
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
                <Link
                  key={link.id}
                  to={link.to}
                  aria-current={active === link.id ? "page" : undefined}
                  className={navigationLinkClass(active === link.id)}
                  onClick={(event) => {
                    if (!event.defaultPrevented) setOpen(false);
                  }}
                >
                  <span aria-hidden="true"><Icon svg={link.icon} size="sm" /></span>
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default VolunteerSelfServiceNavigation;
