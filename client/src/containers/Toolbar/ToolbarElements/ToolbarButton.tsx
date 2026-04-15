import React from "react";
import Button from "../../../components/Button/Button";
import cn from "classnames";

export type ToolbarButtonProps = {
  svg: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  /** When set, renders as a router link (same tab styling as the main toolbar row). */
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  hidden?: boolean;
  isActive?: boolean;
  children: React.ReactNode;
  "aria-label"?: string;
};

/** Shared with outline switcher and other toolbar-row controls that should match tab styling. */
export const toolbarTabClassName = (isActive: boolean, hidden: boolean) =>
  cn(
    "text-xs rounded-none transition-colors duration-150",
    isActive &&
    "border-2 border-transparent border-b-cyan-500 bg-gray-950 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]",
    !isActive && "bg-black/25 hover:border-gray-600/90 hover:bg-gray-600/50",
    hidden && "hidden"
  );

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  svg,
  to,
  onClick,
  disabled = false,
  hidden = false,
  isActive = false,
  children,
  "aria-label": ariaLabel,
}) => {
  const variant = isActive ? "none" : "tertiary";
  const color = isActive ? "#ffffff" : undefined;
  const className = toolbarTabClassName(isActive, hidden);

  if (to) {
    return (
      <Button
        variant={variant}
        svg={svg}
        color={color}
        component="link"
        to={to}
        disabled={disabled}
        className={className}
        aria-label={ariaLabel}
      >
        {children}
      </Button>
    );
  }

  return (
    <Button
      variant={variant}
      svg={svg}
      color={color}
      onClick={onClick}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </Button>
  );
};

export default ToolbarButton;
