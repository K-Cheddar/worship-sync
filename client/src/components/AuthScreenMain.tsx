import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { MenuItemType } from "../types";
import HomeToolbarMenu from "./HomeToolbarMenu/HomeToolbarMenu";

type AuthScreenMainProps = Omit<ComponentPropsWithoutRef<"main">, "className"> & {
  children: ReactNode;
  className?: string;
  /** Extra toolbar items (e.g. Install on App Entry), same contract as Home. */
  extraMenuItems?: MenuItemType[];
};

/**
 * Pre-app shell: sign in, invite accept, password reset, and the bootstrap
 * splash. Includes the shared app menu so the reader can leave the flow.
 *
 * Signed-in product pages use `AppPageShell` instead, which adds the app menu
 * and user popover and scrolls its body under a fixed header.
 *
 * `html` / `body` / `#root` use `overflow: hidden`, so this surface must own
 * scrolling. Use a bounded viewport height (`h-dvh`), not `min-h-dvh`, or the
 * main grows with content and nothing scrolls. `my-auto` centers the short
 * cards these screens are made of. Children stack in a column (`flex-col
 * items-center`) so multi-node pages (login card + legal footer) stay
 * centered instead of sitting side by side in a row.
 */
const AuthScreenMain = ({
  children,
  className,
  extraMenuItems,
  ...rest
}: AuthScreenMainProps) => (
  <main
    className={[
      "flex h-dvh min-h-0 w-full flex-col overflow-y-auto overscroll-y-contain bg-homepage-canvas px-4 py-8 text-white",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    <div className="mx-auto flex w-full max-w-3xl justify-start pb-4">
      <HomeToolbarMenu extraMenuItems={extraMenuItems} />
    </div>
    <div className="my-auto flex w-full flex-col items-center">{children}</div>
  </main>
);

export default AuthScreenMain;
