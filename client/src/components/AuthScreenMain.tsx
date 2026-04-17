import type { ComponentPropsWithoutRef, ReactNode } from "react";

type AuthScreenMainProps = Omit<ComponentPropsWithoutRef<"main">, "className"> & {
  children: ReactNode;
  className?: string;
};

/**
 * Public auth/setup shell: `html` / `body` / `#root` use `overflow: hidden`, so this surface
 * must own scrolling. Use a bounded viewport height (`h-dvh`), not `min-h-dvh`, or the main
 * grows with content and nothing scrolls. `my-auto` on the inner row still centers short pages.
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
