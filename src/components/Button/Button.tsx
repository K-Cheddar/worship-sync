import React, { ComponentPropsWithoutRef, FunctionComponent, ReactNode, RefObject, useRef } from "react";
import Icon from "../Icon/Icon";
import cn from "classnames";
import './Button.scss'

export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
    children?: ReactNode,
    ref?: RefObject<HTMLButtonElement>,
    svg?: FunctionComponent<React.SVGProps<SVGSVGElement>>,
    variant?: 'primary' | 'secondary' | 'tertiary' | 'cta' | 'none',
    className?: string,
    color?: string,
    wrap?: boolean,
    iconPosition?: 'left' | 'right',
    gap?: string,
    isSelected?: boolean,
    truncate?: boolean
}

const Button = ({ 
  children, 
  ref, 
  svg, 
  className, 
  color, 
  variant = 'primary', 
  wrap = false, 
  iconPosition = 'left',
  gap = "gap-1", 
  isSelected = false,
  truncate = false,
  ...rest
  } : ButtonProps) => {
  const fallbackRef = useRef(null);
  const buttonRef = ref || fallbackRef;

  return (
    <button 
      className={cn(
        `font-semibold rounded-sm flex items-center max-w-full ${gap}`, 
        children && "py-2 px-4",
        !children && "p-1",
        !isSelected && variant,
        wrap ? "whitespace-normal text-left break-all" : "whitespace-nowrap",
        truncate && "truncate",
        className,
      )}
      ref={buttonRef} 
      {...rest}
    >
      {svg && iconPosition === 'left' && <Icon svg={svg} color={color}/> }
      {children}
      {svg && iconPosition === 'right' && <Icon svg={svg} color={color}/> }
    </button>
  )

}


export default Button