import { ComponentPropsWithoutRef, ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
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
              subItems,
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

            if (subItems?.length) {
              return (
                <DropdownMenuSub key={index}>
                  <DropdownMenuSubTrigger
                    className={cn("hover:bg-gray-500 max-md:text-base", className)}
                    {...itemRest}
                  >
                    {text}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="bg-gray-600 text-white">
                    {subItems.map((sub, subIndex) => (
                      <DropdownMenuItem
                        key={subIndex}
                        className="hover:bg-gray-500 max-md:text-base"
                        onClick={sub.onClick}
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
