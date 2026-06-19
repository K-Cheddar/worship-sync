import type {
  ComponentPropsWithoutRef,
  ReactElement,
} from "react";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/DropdownMenu";
import { MenuItemType } from "../../types";
import { ButtonProps } from "../Button/Button";

interface MenuProps extends ComponentPropsWithoutRef<"ul"> {
  TriggeringButton: ReactElement<ButtonProps>;
  menuItems: MenuItemType[];
  align?: "start" | "center" | "end";
  contentClassName?: string;
  /** Called when the menu opens/closes, e.g. to clear a display "identify" glow on close. */
  onOpenChange?: (open: boolean) => void;
}

const Menu = ({
  menuItems,
  TriggeringButton,
  align = "end",
  contentClassName,
  onOpenChange,
  ...rest
}: MenuProps) => {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{TriggeringButton}</DropdownMenuTrigger>
      <DropdownMenuContent
        className={contentClassName ?? rest.className}
        align={align}
      >
        {menuItems.map(
          (
            {
              text,
              element,
              onClick,
              to,
              className,
              preventClose,
              subItems,
              variant,
              disabled,
              ...itemRest
            },
            index
          ) => {
            const content = element || text;

            let handleItemSelect: ((e: Event) => void) | undefined;

            if (preventClose) {
              handleItemSelect = (e: Event) => {
                e.preventDefault();
              };
            } else if (!to && onClick) {
              handleItemSelect = () => {
                onClick();
              };
            }

            if (subItems?.length) {
              return (
                <DropdownMenuSub key={index}>
                  <DropdownMenuSubTrigger
                    className={className}
                    {...itemRest}
                  >
                    {content}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className={contentClassName}>
                    {subItems.map((sub, subIndex) => (
                      <DropdownMenuItem
                        key={subIndex}
                        onSelect={() => {
                          sub.onClick?.();
                        }}
                        onMouseEnter={sub.onMouseEnter}
                        onMouseLeave={sub.onMouseLeave}
                        onFocus={sub.onFocus}
                        onBlur={sub.onBlur}
                      >
                        {sub.text}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            }

            return (
              <DropdownMenuItem
                key={index}
                className={className}
                onSelect={handleItemSelect}
                asChild={to ? true : undefined}
                variant={variant}
                disabled={disabled}
                {...itemRest}
              >
                {to ? <Link to={to}>{content}</Link> : content}
              </DropdownMenuItem>
            );
          }
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default Menu;
