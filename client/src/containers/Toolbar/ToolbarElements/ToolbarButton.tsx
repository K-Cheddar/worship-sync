import React from "react";
import Button from "../../../components/Button/Button";
import cn from "classnames";

export type ToolbarButtonProps = {
  variant?: "none";
  svg: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  onClick: () => void;
  disabled?: boolean;
  hidden?: boolean;
  isActive?: boolean;
  children: React.ReactNode;
};

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  variant = "none",
  svg,
  onClick,
  disabled = false,
  hidden = false,
  isActive = false,
  children,
}) => {
  return (
    <Button
      variant={variant}
      svg={svg}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-xs rounded-none",
        isActive && "bg-gray-800",
        hidden && "hidden"
      )}
    >
      {children}
    </Button>
  );
};

export default ToolbarButton;
