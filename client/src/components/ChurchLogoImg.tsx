import { cn } from "../utils/cnHelper";

export type ChurchLogoImgVariant =
  | "board-attendee"
  | "board-presentation"
  | "account-header"
  | "popover";

const variantClass: Record<ChurchLogoImgVariant, string> = {
  "board-attendee": cn(
    "mt-0.5 size-16 shrink-0 rounded-md border border-stone-600/90 bg-stone-950",
    "sm:mt-0 md:size-20",
  ),
  "board-presentation": cn(
    "size-20 shrink-0 rounded-lg border border-cyan-400/25 bg-slate-950/80",
    "md:size-24",
  ),
  "account-header": cn(
    "max-h-16 w-auto max-w-full shrink-0 rounded-md border border-gray-600/80 bg-gray-900",
    "sm:max-h-16 md:max-h-16 lg:max-h-14",
  ),
  popover: cn(
    "size-16 shrink-0 rounded-md border border-gray-600/80 bg-gray-900",
    "md:size-12",
  ),
};

type ChurchLogoImgProps = {
  src: string;
  alt?: string;
  variant: ChurchLogoImgVariant;
  className?: string;
};

/** Shared church logo sizing and framing across board, account, and menu surfaces. */
export function ChurchLogoImg({ src, alt = "", variant, className }: ChurchLogoImgProps) {
  if (!src.trim()) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={cn("object-contain", variantClass[variant], className)}
    />
  );
}
