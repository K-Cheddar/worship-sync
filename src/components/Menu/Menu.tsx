import { ComponentPropsWithoutRef, useState, cloneElement, ReactElement, useMemo, useEffect, useRef } from "react";
import { ButtonProps } from "../Button/Button";
import generateRandomId from "../../utils/generateRandomId";
import cn from 'classnames'
import './Menu.scss'
import { MenuItemType } from "../../types";
import MenuItem from "./MenuItem";

interface MenuProps extends ComponentPropsWithoutRef<"ul"> {
    TriggeringButton: ReactElement<ButtonProps>,
    menuItems: MenuItemType[]
}

const Menu = ({ TriggeringButton, menuItems, ...rest } : MenuProps) => {
  const [show, setShow] = useState(false);
  const buttonId = useMemo(() => generateRandomId(), []);
  const [menuTop, setMenuTop] = useState(0);
  const [menuLeft, setMenuLeft] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null)

  const menuItemsWIds = useMemo(() => {
    return menuItems.map((item, index) => {
      return { ...item, id: generateRandomId() }
    })
  }, [ menuItems])

  const triggeringButton = cloneElement(TriggeringButton, {onClick: () => setShow((val) => !val), id: buttonId })

  useEffect(() => {
    const updateMenuPosition = () => {
      const element = document.getElementById(buttonId);
      const topPosition = element?.offsetTop;
      const height = element?.offsetHeight;
      const leftPostion = element?.offsetLeft
      if (typeof topPosition === 'number' && typeof height === 'number' && typeof leftPostion === 'number') {
        setMenuTop(height + topPosition)
        setMenuLeft(leftPostion)
      }
    }

    updateMenuPosition();

    window.addEventListener('resize', updateMenuPosition)

    return () => {
      window.removeEventListener('resize', updateMenuPosition)
    }

  }, [buttonId])

  useEffect(() => {

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setShow(false);
      }
    }

    window.addEventListener('click', handleOutsideClick);

    return () => {
      window.removeEventListener('click', handleOutsideClick);
    }
  }, [])

  return (
    <div ref={menuRef} className="relative">
      {triggeringButton}
      <ul 
        className={cn("menu", !show && 'hidden')} 
        style={{
          '--menu-top': `${menuTop}px`,
          '--menu-left': `${menuLeft}px`
        } as React.CSSProperties}
        {...rest}
      >
      {menuItemsWIds.map(({ onClick, text, to, id }) => {
        return (
          <MenuItem key={id} onClick={onClick} to={to}>
            {text}
          </MenuItem>
        )
      })}
      </ul>
      
    </div>

  )
}

export default Menu;