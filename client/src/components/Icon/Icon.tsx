import cn from "classnames";
import { FunctionComponent, useMemo } from "react";

type IconProps = {
  svg: FunctionComponent<React.SVGProps<SVGSVGElement>>;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | number;
  className?: string;
  svgClassName?: string;
  overrideSmallMobile?: boolean;
  alt?: string;
  color?: string;
};

const Icon = ({ svg: SVG, size = "md", className, svgClassName, overrideSmallMobile = false, color, alt }: IconProps) => {
  /** Use `size-*` (not only `w-*`/`h-*`) so parent shadcn buttons skip `[&_svg:not([class*='size-'])]:size-4`. */
  const width = useMemo(() => {
    switch (size) {
      case "xs":
        return "size-3";
      case "sm":
        return "size-4";
      case "md":
        return "size-5";
      case "lg":
        return "size-6";
      case "xl":
        return "size-8";
      default:
        return `size-[${size}px]`;
    }
  }, [size]);

  return (
    <span className={cn("flex items-center justify-center", className)}>
      <SVG
        className={cn(
          width,
          !overrideSmallMobile && "max-md:min-h-6 max-md:min-w-6",
          svgClassName
        )}
        color={color}
      />
    </span>
  );
};

export default Icon;
