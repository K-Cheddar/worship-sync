import React, { ReactNode } from "react";
import cn from "classnames";
import "./ButtonGroup.scss";

export type ButtonGroupProps = {
  children: ReactNode;
  className?: string;
  orientation?: "horizontal" | "vertical";
};

const ButtonGroup: React.FC<ButtonGroupProps> = ({
  children,
  className,
  orientation = "horizontal",
}) => {
  return (
    <div
      className={cn(
        {
          "flex-row": orientation === "horizontal",
          "flex-col": orientation === "vertical",
        },
        "button-group",
        className
      )}
    >
      {children}
    </div>
  );
};

export default ButtonGroup;
