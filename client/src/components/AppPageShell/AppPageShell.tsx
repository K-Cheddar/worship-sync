import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Icon from "../Icon/Icon";
import HomeToolbarMenu from "../HomeToolbarMenu/HomeToolbarMenu";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import { useSelector } from "../../hooks";
import type { RootState } from "../../store/store";
import { cn } from "../../utils/cnHelper";

/**
 * Chrome for a signed-in, full-page product surface: the app menu, a title, and
 * the user popover, over a scrolling body.
 *
 * Distinct from `AuthScreenMain`, which is the pre-app shell (sign in, invite,
 * password reset, bootstrap splash) and deliberately has no navigation. A
 * product page rendered in that shell strands the reader with no way back.
 *
 * Scrolling lives on the inner section, not the page: `html` / `body` / `#root`
 * are `overflow: hidden`, and the outer `main` is a bounded `h-dvh` so the
 * header stays put while the body scrolls under it.
 *
 * Extracted from the header that Account and Teams both hand-roll; they can
 * adopt it when convenient rather than being churned for it now.
 */
const AppPageShell = ({
  title,
  icon,
  iconColorClass = "text-orange-300",
  description,
  children,
  showAccountNavigation = true,
  contentClassName,
}: {
  title: string;
  icon?: LucideIcon;
  iconColorClass?: string;
  description?: string;
  children: ReactNode;
  showAccountNavigation?: boolean;
  contentClassName?: string;
}) => {
  const scrollbarWidth = useSelector(
    (state: RootState) => state.undoable.present.preferences.scrollbarWidth,
  );

  return (
    <main
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-homepage-canvas text-white"
      style={{ "--scrollbar-width": scrollbarWidth } as CSSProperties}
    >
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col px-2 pb-6 sm:px-4 lg:px-6">
        <div className="flex h-[48px] min-h-[48px] w-full shrink-0 flex-nowrap items-center justify-between gap-2 border-b border-gray-700 py-0">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2">
            {showAccountNavigation ? <HomeToolbarMenu /> : null}
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="flex min-w-0 items-center gap-2 truncate text-base font-semibold sm:text-lg">
                {icon ? (
                  <Icon svg={icon} size="md" className={iconColorClass} />
                ) : null}
                <span className="truncate">{title}</span>
              </h1>
              {description ? (
                <p className="hidden min-w-0 truncate text-xs text-gray-400 sm:block">{description}</p>
              ) : null}
            </div>
          </div>
          {showAccountNavigation ? <UserSection variant="compact" /> : null}
        </div>

        <section
          className={cn(
            "mx-auto mt-3 flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-y-contain lg:mt-4",
            contentClassName,
          )}
        >
          {children}
        </section>
      </div>
    </main>
  );
};

export default AppPageShell;
