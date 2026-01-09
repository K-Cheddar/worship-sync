import { ComponentPropsWithoutRef, ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/DropdownMenu";
import { MenuItemType } from "../../types";
import { ButtonProps } from "../Button/Button";
import cn from "classnames";

interface MenuProps extends ComponentPropsWithoutRef<"ul"> {
  TriggeringButton: ReactElement<ButtonProps>;
  menuItems: MenuItemType[];
}

const Menu = ({ menuItems, TriggeringButton, ...rest }: MenuProps) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{TriggeringButton}</DropdownMenuTrigger>
      <DropdownMenuContent
        className={cn("bg-gray-600 text-white", rest.className)}
        align="end"
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
              ...itemRest
            },
            index
          ) => {
            const content = element || text;

            const handleSelect = preventClose
              ? (e: Event) => {
                  e.preventDefault();
                }
              : undefined;

            return (
              <DropdownMenuItem
                key={index}
                className={cn(" hover:bg-gray-500 max-md:text-base", className)}
                onClick={!to ? onClick : undefined}
                onSelect={handleSelect}
                asChild={to ? true : undefined}
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
