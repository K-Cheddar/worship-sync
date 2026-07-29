import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/utils/cnHelper";

export const ANIMATE_COLLAPSE_DURATION_MS = 200;

export type AnimateCollapseProps = {
  open: boolean;
  children: ReactNode;
  className?: string;
  /**
   * When true, children unmount after the close animation finishes.
   * Open still animates from zero height on mount.
   */
  unmountOnExit?: boolean;
};

const collapseFrameClassName = (
  open: boolean,
  className: string | undefined,
) =>
  cn(
    "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
    open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
    className,
  );

/**
 * Height-animates open/closed via grid-template-rows (same pattern as
 * MemberChip / ItemSlides). Collapsed content is inert + aria-hidden.
 * Reduced-motion users get an instant snap via `motion-reduce:transition-none`.
 */
const AnimateCollapse = ({
  open,
  children,
  className,
  unmountOnExit = false,
}: AnimateCollapseProps) => {
  const [rendered, setRendered] = useState(open);
  const [gridOpen, setGridOpen] = useState(open);
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;

  useEffect(() => {
    if (!unmountOnExit) return undefined;

    if (open) {
      setRendered(true);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setGridOpen(true));
      });
      return () => cancelAnimationFrame(id);
    }

    setGridOpen(false);
    if (!renderedRef.current) return undefined;

    const t = window.setTimeout(() => {
      setRendered(false);
    }, ANIMATE_COLLAPSE_DURATION_MS);
    return () => clearTimeout(t);
  }, [open, unmountOnExit]);

  // Keep-mounted path: drive height + a11y from `open` on the same render.
  if (!unmountOnExit) {
    return (
      <div className={collapseFrameClassName(open, className)}>
        <div
          className="min-h-0 overflow-hidden"
          inert={open ? undefined : true}
          aria-hidden={open ? undefined : true}
        >
          {children}
        </div>
      </div>
    );
  }

  if (!rendered) return null;

  return (
    <div className={collapseFrameClassName(gridOpen, className)}>
      <div
        className="min-h-0 overflow-hidden"
        inert={open ? undefined : true}
        aria-hidden={open ? undefined : true}
      >
        {children}
      </div>
    </div>
  );
};

export default AnimateCollapse;
