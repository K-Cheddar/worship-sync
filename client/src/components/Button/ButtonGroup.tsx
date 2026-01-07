import React, {
  ReactNode,
  Children,
  isValidElement,
  cloneElement,
} from "react";
import cn from "classnames";

export type ButtonGroupProps = {
  children: ReactNode;
  className?: string;
  orientation?: "horizontal" | "vertical";
  display?: string;
};

const ButtonGroup: React.FC<ButtonGroupProps> = ({
  children,
  className,
  orientation = "horizontal",
  display,
}) => {
  const childArray = Children.toArray(children);

  return (
    <div
      className={cn(
        "border border-gray-400 rounded-md",
        orientation === "horizontal" ? "flex-row" : "flex-col",
        display ? display : "inline-flex",
        className
      )}
    >
      {childArray.map((child, index) => {
        if (!isValidElement(child)) return child;

        const isFirst = index === 0;
        const isLast = index === childArray.length - 1;
        const isOnly = childArray.length === 1;

        const baseItemClasses = "justify-center flex-1";

        const horizontalRadiusClasses = isOnly
          ? "rounded-md"
          : isFirst
            ? "rounded-l-md rounded-r-none"
            : isLast
              ? "rounded-r-md rounded-l-none"
              : "rounded-none";

        const verticalRadiusClasses = isOnly
          ? "rounded-md"
          : isFirst
            ? "rounded-t-md rounded-b-none rounded-l-md rounded-r-md"
            : isLast
              ? "rounded-b-md rounded-t-none rounded-l-md rounded-r-md"
              : "rounded-none";

        const radiusClasses =
          orientation === "horizontal"
            ? horizontalRadiusClasses
            : verticalRadiusClasses;

        return cloneElement(child as React.ReactElement, {
          className: cn(
            baseItemClasses,
            radiusClasses,
            (child as React.ReactElement).props.className
          ),
        });
      })}
    </div>
  );
};

export default ButtonGroup;
