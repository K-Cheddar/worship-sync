import type { LucideProps } from "lucide-react";

/** Frosted glass chip (folder rows + Up). Overrides mobile Button min-height. */
export const MEDIA_LIBRARY_FOLDER_CHIP_BUTTON_CLASS =
  "inline-flex max-h-8 max-w-full min-h-8 min-w-0 shrink-0 flex-row items-center gap-1.5 rounded-md border border-white/20 bg-white/[0.08] px-1.5 py-0.5 text-left text-xs font-medium text-zinc-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-md transition-[background-color,border-color] hover:border-white/30 hover:bg-white/[0.14] max-md:min-h-8";

/** Long names truncate so the chip stays compact; short names keep tight width. */
export const MEDIA_LIBRARY_FOLDER_CHIP_LABEL_CLASS =
  "min-w-0 max-w-[14rem] truncate text-left text-zinc-100";

/** Default size for toolbar / menu orange folder icons. */
export const MEDIA_LIBRARY_ORANGE_FOLDER_CLASS =
  "size-3.5 max-md:size-5 shrink-0 text-orange-400";

/** Filled folder look (Lucide defaults to hollow stroke-only). */
export const MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE: Pick<
  LucideProps,
  "fill" | "stroke" | "strokeWidth"
> = {
  fill: "currentColor",
  stroke: "currentColor",
  strokeWidth: 1.25,
};
