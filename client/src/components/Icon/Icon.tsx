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
  const width = useMemo(() => {
    switch (size) {
      case "xs":
        return "w-3 h-3";
      case "sm":
        return "w-4 h-4";
      case "md":
        return "w-5 h-5";
      case "lg":
        return "w-6 h-6";
      case "xl":
        return "w-8 h-8";
      default:
        return `w-[${size}px] h-full`;
    }
  }, [size]);

  return (
    <span className={cn("flex items-center justify-center", className)}>
      <SVG
        className={cn(width, !overrideSmallMobile && "max-md:min-h-6 max-md:min-w-6", svgClassName)}
        color={color}
      />
    </span>
  );
};

export default Icon;
