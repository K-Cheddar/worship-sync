import { ComponentPropsWithoutRef, ReactNode } from "react";
import { Link } from "react-router-dom";
import { MenuItemType } from "../../types";

export interface MenuItemProps
  extends MenuItemType,
    Omit<ComponentPropsWithoutRef<"li">, "onClick"> {
  children: ReactNode;
}

const MenuItem = ({ children, onClick, to }: MenuItemProps) => {
  const innerClasses = "px-3 py-2 h-full w-full block text-left";
  const isLinkOrButton = to || onClick;
  return (
    <li
      className={`bg-slate-200 font-semibold hover:bg-slate-300 active:bg-slate-400 cursor-pointer w-full text-sm text-black ${
        !isLinkOrButton && "px-3 py-2"
      }`}
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
