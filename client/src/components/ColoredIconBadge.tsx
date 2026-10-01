import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/utils/cnHelper";
import {
  contrastingInkForFill,
  normalizeHexColor,
} from "../utils/richTextColorContrast";

type ColoredIconBadgeProps = {
  fillColor: string;
  inkColor?: string;
  defaultColor?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  "data-testid"?: string;
};

/** Shared filled icon tile with automatically contrasting glyph ink. */
const ColoredIconBadge = ({
  fillColor,
  inkColor,
  defaultColor = "#9ca3af",
  className,
  style,
  children,
  "data-testid": dataTestId,
}: ColoredIconBadgeProps) => {
  const normalizedFill = normalizeHexColor(fillColor);
  const fill = normalizedFill || (fillColor.startsWith("var(") ? fillColor : defaultColor);
  const ink = inkColor || contrastingInkForFill(normalizedFill || defaultColor);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-current/40",
        className,
      )}
      style={{ backgroundColor: fill, color: ink, ...style }}
      aria-hidden
      data-testid={dataTestId}
    >
      {children}
    </span>
  );
};

export default ColoredIconBadge;
