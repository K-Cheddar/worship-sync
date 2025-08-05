import React, {
  forwardRef,
  FunctionComponent,
  ReactNode,
  useContext,
  useMemo,
  useRef,
} from "react";
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import Icon from "../Icon/Icon";
import cn from "classnames";
import "./Button.scss";
import Spinner from "../Spinner/Spinner";
import { ControllerInfoContext } from "../../context/controllerInfo";

export type ButtonProps = Omit<React.HTMLProps<HTMLButtonElement>, "wrap"> & {
  children?: ReactNode;
  svg?: FunctionComponent<React.SVGProps<SVGSVGElement>>;
  image?: string;
  variant?: "primary" | "secondary" | "tertiary" | "cta" | "none";
  className?: string;
  color?: string;
  wrap?: boolean;
  iconPosition?: "left" | "right";
  gap?: string;
  isSelected?: boolean;
  truncate?: boolean;
  padding?: string;
  iconSize?: "xs" | "sm" | "md" | "lg" | "xl" | number;
  type?: "button" | "submit" | "reset" | undefined;
  isLoading?: boolean;
  position?: "relative" | "absolute";
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      svg,
      className,
      color,
      variant = "primary",
      wrap = false,
      iconPosition = "left",
      gap = "gap-1",
      padding,
      isSelected = false,
      truncate = false,
      iconSize: _iconSize,
      type = "button",
      isLoading = false,
      image,
      position = "relative",
      ...rest
    },
    ref
  ) => {
    const fallbackRef = useRef(null);
    const buttonRef = ref || fallbackRef;

    const { isMobile } = useContext(ControllerInfoContext) || {};
    // const _iconSize = typeof iconSize === "number" ? iconSize :  undefined;
    // const _iconSize = isMobile && !iconSize ? 'lg'

    const iconSize = useMemo(() => {
      if (isMobile) {
        return _iconSize || "xl";
      }
      return _iconSize || "md";
    }, [isMobile, _iconSize]);

    const iconWProps = (
      <Icon svg={svg || UnknownSVG} color={color} size={iconSize} />
    );

    const _padding = padding ? padding : children ? "py-1 px-2" : "p-1";

    return (
      <button
        className={cn(
          `font-semibold rounded-md flex items-center max-w-full disabled:opacity-65 disabled:pointer-events-none ${gap}`,
          _padding,
          !isSelected && variant,
          wrap
            ? "whitespace-normal text-left button-wrap"
            : "whitespace-nowrap",
          truncate && "truncate",
          position,
          className
        )}
        type={type}
        ref={buttonRef}
        {...rest}
      >
        {svg && iconPosition === "left" && iconWProps}
        {children}
        {svg && iconPosition === "right" && iconWProps}
        {image && <img src={image} alt={image} />}
        {isLoading && (
          <Spinner
            className="absolute top-0 bottom-0 left-0 right-0 m-auto"
            width="24px"
            borderWidth="3px"
          />
        )}
      </button>
    );
  }
);

export default Button;
