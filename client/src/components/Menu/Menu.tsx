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

interface MenuProps extends ComponentPropsWithoutRef<"ul"> {
  TriggeringButton: ReactElement<ButtonProps>;
  menuItems: MenuItemType[];
  align?: "start" | "center" | "end";
  contentClassName?: string;
}

const Menu = ({
  menuItems,
  TriggeringButton,
  align = "end",
  contentClassName,
  ...rest
}: MenuProps) => {
  return (
    <DropdownMenu>
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

            const handleSelect = preventClose
              ? (e: Event) => {
                  e.preventDefault();
                }
              : undefined;

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
                className={className}
                onClick={!to ? onClick : undefined}
                onSelect={handleSelect}
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
