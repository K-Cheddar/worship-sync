import React from "react";
import Button from "../../../components/Button/Button";
import cn from "classnames";

export type ToolbarButtonProps = {
  svg: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  onClick: () => void;
  disabled?: boolean;
  hidden?: boolean;
  isActive?: boolean;
  children: React.ReactNode;
};

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  svg,
  onClick,
  disabled = false,
  hidden = false,
  isActive = false,
  children,
}) => {
  return (
    <Button
      variant={isActive ? "none" : "tertiary"}
      svg={svg}
      color={isActive ? "#ffffff" : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-xs rounded-none transition-colors duration-150",
        isActive &&
        "border-2 border-transparent border-b-cyan-500 bg-gray-950 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]",
        !isActive &&
        "bg-black/25 hover:border-gray-600/90 hover:bg-gray-600/50",
        hidden && "hidden"
      )}
    >
      {children}
    </Button>
  );
};

export default ToolbarButton;
