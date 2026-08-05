import type { CSSProperties } from "react";
import { normalizeHexColor } from "../utils/richTextColorContrast";

const hexChannel = (hex: string, offset: number) =>
  Number.parseInt(hex.slice(offset, offset + 2), 16);

/**
 * Soft border/fill tint from a microphone's catalog color. Label text stays
 * white for readability on dark surfaces. Undefined when the color is missing
 * or invalid so callers can keep a neutral violet fallback.
 */
export const servicePlanMicrophoneChromeStyle = (
  color: string | undefined | null,
): CSSProperties | undefined => {
  const fill = normalizeHexColor(color);
  if (!fill) return undefined;
  const r = hexChannel(fill, 1);
  const g = hexChannel(fill, 3);
  const b = hexChannel(fill, 5);
  return {
    borderColor: `rgba(${r}, ${g}, ${b}, 0.45)`,
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.14)`,
    color: "#ffffff",
  };
};
