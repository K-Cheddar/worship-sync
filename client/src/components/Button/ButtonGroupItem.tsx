import React, { forwardRef } from "react";
import Button, { ButtonProps } from "./Button";
import cn from "classnames";

export type ButtonGroupItemProps = ButtonProps & {
  isActive?: boolean;
};

const ButtonGroupItem = forwardRef<HTMLButtonElement, ButtonGroupItemProps>(
  ({ className, isActive, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        className={cn("button-group-item", className)}
        variant={isActive ? "secondary" : "tertiary"}
        {...props}
      />
    );
  },
);

ButtonGroupItem.displayName = "ButtonGroupItem";

export default ButtonGroupItem;
