import { ComponentPropsWithoutRef, ReactNode } from "react";
import { Link } from "react-router-dom";
import { MenuItemType } from "../../types";
import cn from "classnames";

export interface MenuItemProps
  extends MenuItemType,
    Omit<ComponentPropsWithoutRef<"li">, "onClick"> {
  children: ReactNode;
}

const MenuItem = ({ children, onClick, to, className }: MenuItemProps) => {
  const innerClasses = "px-3 py-2 h-full w-full block text-left";
  const isLinkOrButton = to || onClick;
  return (
    <li
      className={cn(
        "bg-gray-200 font-semibold hover:bg-gray-300 active:bg-gray-400 cursor-pointer w-full text-sm text-black",
        !isLinkOrButton && "px-3 py-2",
        className
      )}
    >
      {onClick && (
        <button className={innerClasses} onClick={onClick}>
          {children}
        </button>
      )}
      {to && (
        <Link className={innerClasses} to={to}>
          {children}
        </Link>
      )}
      {!onClick && !to && children}
    </li>
  );
};

export default MenuItem;
