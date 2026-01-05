import React, {
  forwardRef,
  FunctionComponent,
  ReactNode,
  useContext,
  useMemo,
  useRef,
} from "react";
import { FileQuestion } from "lucide-react";
import Icon from "../Icon/Icon";
import cn from "classnames";
import Spinner from "../Spinner/Spinner";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { Link } from "react-router-dom";

export type ButtonProps = Omit<
  React.HTMLProps<HTMLButtonElement | HTMLAnchorElement>,
  "wrap"
> & {
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
  component?: "button" | "link";
  to?: string;
};

const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
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
      component = "button",
      ...rest
    },
    ref
  ) => {
    const fallbackRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
    const buttonRef = ref || fallbackRef;

    const { isMobile } = useContext(ControllerInfoContext) || {};

    const iconSize = useMemo(() => {
      if (isMobile) {
        return _iconSize || "xl";
      }
      return _iconSize || "md";
    }, [isMobile, _iconSize]);

    const iconWProps = (
      <Icon svg={svg || FileQuestion} color={color} size={iconSize} />
    );

    const _padding = padding ? padding : children ? "py-1 px-2" : "p-1";

    const variantClasses: Record<
      NonNullable<ButtonProps["variant"]>,
      string
    > = {
      cta: "bg-green-600 hover:bg-green-700 active:bg-green-800 border-2 border-green-600 hover:border-green-700 active:border-green-800 text-white",
      primary:
        "bg-black hover:bg-gray-900 active:bg-gray-800 border-2 border-black hover:border-gray-900 active:border-gray-800 text-white",
      secondary:
        "bg-white hover:bg-gray-200 active:bg-gray-300 border-2 border-white hover:border-gray-200 active:border-gray-300 text-black",
      tertiary:
        "bg-transparent hover:bg-gray-500 active:bg-gray-400 border-2 border-transparent hover:border-gray-500 active:border-gray-400 text-white",
      none: "",
    };

    const commonClassName = cn(
      `font-semibold rounded-md flex items-center max-w-full max-md:min-h-14 cursor-pointer disabled:opacity-65 disabled:pointer-events-none ${gap}`,
      _padding,
      !isSelected && variant && variantClasses[variant],
      wrap ? "whitespace-normal text-left break-words" : "whitespace-nowrap",
      truncate && "truncate",
      position,
      className
    );

    const commonContent = (
      <>
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
      </>
    );

    if (component === "link") {
      return (
        <Link
          className={commonClassName}
          ref={buttonRef as React.Ref<HTMLAnchorElement>}
          to={rest.to || "#"}
          {...rest}
        >
          {commonContent}
        </Link>
      );
    }

    return (
      <button
        className={commonClassName}
        type={type}
        ref={buttonRef as React.Ref<HTMLButtonElement>}
        {...rest}
      >
        {commonContent}
      </button>
    );
  }
);

export default Button;
