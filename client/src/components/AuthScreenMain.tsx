import type { ComponentPropsWithoutRef, ReactNode } from "react";

type AuthScreenMainProps = Omit<ComponentPropsWithoutRef<"main">, "className"> & {
  children: ReactNode;
  className?: string;
  /**
   * `center` vertically centers content when it fits, and still scrolls from
   * the top when content is taller than the viewport (via `min-h-full` +
   * `items-center`, not `my-auto` on a short flex child).
   * `start` keeps content top-aligned.
   */
  contentAlign?: "center" | "start";
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
 * main grows with content and nothing scrolls.
 */
const AuthScreenMain = ({
  children,
  className,
  contentAlign = "center",
  ...rest
}: AuthScreenMainProps) => (
  <main
    className={[
      "h-dvh min-h-0 w-full overflow-y-auto overscroll-y-contain bg-homepage-canvas text-white",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    <div
      className={[
        "flex min-h-full w-full justify-center px-4 py-8",
        contentAlign === "center" ? "items-center" : "items-start",
      ].join(" ")}
    >
      {children}
    </div>
  </main>
);

export default AuthScreenMain;
