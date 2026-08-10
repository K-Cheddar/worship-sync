import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Icon from "../Icon/Icon";
import HomeToolbarMenu from "../HomeToolbarMenu/HomeToolbarMenu";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import { useSelector } from "../../hooks";
import type { RootState } from "../../store/store";

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
  description,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  description?: string;
  children: ReactNode;
}) => {
  const scrollbarWidth = useSelector(
    (state: RootState) => state.undoable.present.preferences.scrollbarWidth,
  );

  return (
    <main
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-homepage-canvas text-white"
      style={{ "--scrollbar-width": scrollbarWidth } as CSSProperties}
    >
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col px-4 pb-6 lg:px-6">
        <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-4 border-b border-gray-700 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <HomeToolbarMenu />
            <div>
              <h1 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
                {icon ? (
                  <Icon svg={icon} size="md" className="text-orange-300" />
                ) : null}
                {title}
              </h1>
              {description ? (
                <p className="mt-0.5 text-sm text-gray-400">{description}</p>
              ) : null}
            </div>
          </div>
          <UserSection />
        </div>

        <section className="mt-3 flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-y-contain lg:mt-4">
          {children}
        </section>
      </div>
    </main>
  );
};

export default AppPageShell;
