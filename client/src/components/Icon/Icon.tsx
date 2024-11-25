import cn from "classnames";
import { FunctionComponent, useMemo } from "react";
import "./Icon.scss";

type IconProps = {
  svg: FunctionComponent<React.SVGProps<SVGSVGElement>>;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | number;
  className?: string;
  alt?: string;
  color?: string;
};

const Icon = ({ svg: SVG, size = "md", className, color, alt }: IconProps) => {
  const width = useMemo(() => {
    switch (size) {
      case "xs":
        return "w-2 2xl:w-3 h-2 2xl:h-3";
      case "sm":
        return "w-3 2xl:w-4 h-3 2xl:h-4";
      case "md":
        return "w-4 2xl:w-5 h-4 2xl:h-5";
      case "lg":
        return "w-5 2xl:w-6 h-5 2xl:h-6";
      case "xl":
        return "w-6 2xl:w-8 h-6 2xl:h-8";
      default:
        return `w-[${size}px] h-full`;
    }
  }, [size]);

  return (
    <span
      className={cn("icon", className)}
      style={
        { "--icon-color": color ? color : undefined } as React.CSSProperties
      }
    >
      <SVG className={width} />
    </span>
  );
};

export default Icon;
