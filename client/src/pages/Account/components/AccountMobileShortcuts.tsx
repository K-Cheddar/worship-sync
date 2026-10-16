import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Icon from "../../../components/Icon/Icon";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { cn } from "../../../utils/cnHelper";
import { ACCOUNT_NAV_GROUPS, getActiveAccountNavGroup, getActiveAccountSection } from "../accountConstants";

type AccountMobileShortcutsProps = {
  children?: ReactNode;
};

/** Mobile group shortcuts and route tabs, kept outside the administration scrollport. */
const AccountMobileShortcuts = ({ children }: AccountMobileShortcutsProps) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeGroup = getActiveAccountNavGroup(pathname);
  const activeSection = getActiveAccountSection(pathname);
  const tabsRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const shell = tabsRef.current;
    const strip = shell?.querySelector<HTMLElement>('[role="tablist"]');
    if (!shell || !strip) return;

    const revealSelected = () => {
      const selected = strip.querySelector<HTMLElement>('[data-state="active"]');
      if (!selected) return;
      const tab = selected.getBoundingClientRect();
      const viewport = shell.getBoundingClientRect();
      if (tab.left < viewport.left) strip.scrollLeft += tab.left - viewport.left;
      else if (tab.right > viewport.right) strip.scrollLeft += tab.right - viewport.right;
    };

    revealSelected();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(revealSelected);
    observer.observe(shell);
    observer.observe(strip);
    const selected = strip.querySelector<HTMLElement>('[data-state="active"]');
    if (selected) observer.observe(selected);
    return () => observer.disconnect();
  }, [pathname, activeGroup.id, activeSection.path]);

  return (
    <>
      <Tabs
        value={activeSection.path}
        onValueChange={(path) => navigate(path)}
        className="contents"
      >
        <nav
          ref={tabsRef}
          aria-label={`${activeGroup.label} pages`}
          className="shrink-0 bg-gray-950 lg:hidden"
        >
          <TabsList variant="navigation" aria-label={`${activeGroup.label} pages`}>
            {activeGroup.sections.map((section) => (
              <TabsTrigger key={section.path} value={section.path}>
                {section.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </nav>
      </Tabs>
      {children}
      <nav
        aria-label="Primary navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--account-bottom-navigation-height)] items-center border-t border-gray-800/80 bg-gray-950 pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {ACCOUNT_NAV_GROUPS.map((group) => {
          const selected = activeGroup.id === group.id;
          const defaultSection = group.sections.find(
            (section) => section.id === group.defaultSectionId,
          )!;
          return (
            <Link
              key={group.id}
              to={defaultSection.path}
              aria-label={group.label}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "flex h-[56px] min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-none border-0 px-1 py-1 text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300",
                selected
                  ? "font-semibold text-white"
                  : "font-medium text-gray-400 hover:text-gray-200",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-[30px] w-[60px] items-center justify-center rounded-full transition-colors",
                  selected ? "bg-cyan-500/15 text-cyan-300" : "text-gray-400",
                )}
              >
                <Icon svg={group.icon} size="md" />
              </span>
              <span>{group.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
};

export default AccountMobileShortcuts;
