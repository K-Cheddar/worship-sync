import type { ComponentPropsWithoutRef, ReactNode } from "react";

type AuthScreenMainProps = Omit<ComponentPropsWithoutRef<"main">, "className"> & {
  children: ReactNode;
  className?: string;
};

/**
 * Pre-app shell: sign in, invite accept, password reset, and the bootstrap
 * splash. Deliberately has no navigation — the reader is not in the app yet.
 *
 * Signed-in product pages use `AppPageShell` instead, which adds the app menu
 * and user popover and scrolls its body under a fixed header.
 *
 * `html` / `body` / `#root` use `overflow: hidden`, so this surface must own
 * scrolling. Use a bounded viewport height (`h-dvh`), not `min-h-dvh`, or the
 * main grows with content and nothing scrolls. `my-auto` centers the short
 * cards these screens are made of.
 */
const AuthScreenMain = ({ children, className, ...rest }: AuthScreenMainProps) => (
  <main
    className={[
      "flex h-dvh min-h-0 w-full flex-col overflow-y-auto overscroll-y-contain bg-homepage-canvas px-4 py-8 text-white",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    <div className="my-auto flex w-full justify-center">{children}</div>
  </main>
);

export default AuthScreenMain;
