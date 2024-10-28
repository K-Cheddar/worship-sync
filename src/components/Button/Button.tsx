import React, { ComponentPropsWithoutRef, forwardRef, FunctionComponent, ReactNode, RefObject, useRef } from "react";
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import Icon from "../Icon/Icon";
import cn from "classnames";
import './Button.scss'

export type ButtonProps = Omit<React.HTMLProps<HTMLButtonElement>, 'wrap'> & {
    children?: ReactNode,
    svg?: FunctionComponent<React.SVGProps<SVGSVGElement>>,
    variant?: 'primary' | 'secondary' | 'tertiary' | 'cta' | 'none',
    className?: string,
    color?: string,
    wrap?: boolean,
    iconPosition?: 'left' | 'right',
    gap?: string,
    isSelected?: boolean,
    truncate?: boolean,
    padding?: string,
    iconSize?: string,
    type?: 'button' | 'submit' | 'reset' | undefined
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  children, 
  svg, 
  className, 
  color, 
  variant = 'primary', 
  wrap = false, 
  iconPosition = 'left',
  gap = "gap-1", 
  padding="py-2 px-2",
  isSelected = false,
  truncate = false,
  iconSize = 'md',
  type="button",
  ...rest
  }, ref) => {
  const fallbackRef = useRef(null);
  const buttonRef = ref || fallbackRef;

  const iconWProps = <Icon svg={svg || UnknownSVG} color={color} size={iconSize}/>

  return (
    <button 
      className={cn(
        `font-semibold rounded-md flex items-center max-w-full disabled:opacity-65 disabled:pointer-events-none ${gap}`, 
        children && padding,
        !children && "p-1",
        !isSelected && variant,
        wrap ? "whitespace-normal text-left button-wrap" : "whitespace-nowrap",
        truncate && "truncate",
        className,
      )}
      type={type}
      ref={buttonRef} 
      {...rest}
    >
      {svg && iconPosition === 'left' && iconWProps}
      {children}
      {svg && iconPosition === 'right' && iconWProps}
    </button>
  )

})

export default Button