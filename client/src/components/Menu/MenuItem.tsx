import { ComponentPropsWithoutRef, ReactNode } from "react"
import { Link } from "react-router-dom";
import { MenuItemType } from "../../types";

export interface MenuItemProps extends MenuItemType, Omit<ComponentPropsWithoutRef<"li">, "onClick"> {
  children: ReactNode
}

const MenuItem = ({children, onClick, to} : MenuItemProps) => {

  return (
    <li className="bg-slate-200 font-semibold hover:bg-slate-300 active:bg-slate-400 cursor-pointer w-full px-3 py-2 text-sm text-black">
      {onClick && <button onClick={onClick}>{children}</button>}
      {to && <Link to={to}>{children}</Link>}
      {!onClick && !to && children}
    </li>
  )
}

export default MenuItem;
