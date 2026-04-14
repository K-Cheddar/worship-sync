import type { LucideProps } from "lucide-react";

/** Default size for toolbar / menu orange folder icons. */
export const MEDIA_LIBRARY_ORANGE_FOLDER_CLASS =
  "size-3.5 shrink-0 text-orange-400";

/** Filled folder look (Lucide defaults to hollow stroke-only). */
export const MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE: Pick<
  LucideProps,
  "fill" | "stroke" | "strokeWidth"
> = {
  fill: "currentColor",
  stroke: "currentColor",
  strokeWidth: 1.25,
};
