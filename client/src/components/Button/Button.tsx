import React, {
  forwardRef,
  FunctionComponent,
  ReactNode,
  useContext,
  useMemo,
  useRef,
} from "react";
import { FileQuestion } from "lucide-react";
import { Link } from "react-router-dom";
import ShadcnButton, { type ButtonVariantProps } from "@/components/ui/Button";
import Icon from "../Icon/Icon";
import { cn } from "@/utils/cnHelper";
import Spinner from "../Spinner/Spinner";
import { ControllerInfoContext } from "../../context/controllerInfo";

export type ButtonProps = Omit<
  React.HTMLProps<HTMLButtonElement | HTMLAnchorElement>,
  "wrap"
> & {
  children?: ReactNode;
  svg?: FunctionComponent<React.SVGProps<SVGSVGElement>>;
  image?: string;
  variant?:
  | "primary"
  | "secondary"
  | "tertiary"
  | "cta"
  | "destructive"
  | "textLink"
  | "none";
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
  state?: unknown;
};

type UiVariant = NonNullable<ButtonVariantProps["variant"]>;

const variantToUi: Record<
  NonNullable<ButtonProps["variant"]>,
  UiVariant
> = {
  primary: "presentPrimary",
  secondary: "presentSecondary",
  tertiary: "presentTertiary",
  cta: "presentCta",
  destructive: "presentDestructive",
  textLink: "presentTextLink",
  none: "none",
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
      to,
      state,
      onClick,
      disabled = false,
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

    const iconColor =
      variant === "cta" || variant === "destructive" || variant === "secondary"
        ? (color ?? "#ffffff")
        : color;

    const iconWProps = (
      <Icon svg={svg || FileQuestion} color={iconColor} size={iconSize} />
    );

    const _padding = padding
      ? padding
      : variant === "textLink"
        ? "py-0.5 px-0"
        : children
          ? "py-1 px-2"
          : "p-1";

    const uiVariant: UiVariant = isSelected ? "none" : variantToUi[variant];

    const uiSize: NonNullable<ButtonVariantProps["size"]> =
      variant === "textLink" ? "bare" : "present";

    const layoutClassName = cn(
      variant === "textLink" ? "font-normal" : "font-semibold",
      "max-w-full justify-start",
      gap,
      variant !== "textLink" && "max-md:min-h-14",
      variant !== "textLink" && "disabled:opacity-65",
      disabled && "pointer-events-none cursor-not-allowed opacity-65",
      _padding,
      wrap
        ? "text-wrap whitespace-normal text-left break-words"
        : "whitespace-nowrap",
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

    const refProp = buttonRef as React.Ref<HTMLButtonElement>;

    if (component === "link") {
      return (
        <ShadcnButton
          ref={refProp}
          asChild
          variant={uiVariant}
          size={uiSize}
          className={layoutClassName}
        >
          <Link
            to={disabled ? "#" : to || "#"}
            state={state}
            {...rest}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : rest.tabIndex}
            onClick={(e) => {
              if (disabled) {
                e.preventDefault();
                return;
              }
              if (e.shiftKey || e.ctrlKey || e.metaKey) {
                e.preventDefault();
              }
              onClick?.(e as React.MouseEvent<HTMLAnchorElement>);
            }}
          >
            {commonContent}
          </Link>
        </ShadcnButton>
      );
    }

    return (
      <ShadcnButton
        ref={refProp}
        type={type}
        disabled={disabled}
        variant={uiVariant}
        size={uiSize}
        className={layoutClassName}
        onClick={onClick as React.ComponentProps<"button">["onClick"]}
        {...rest}
      >
        {commonContent}
      </ShadcnButton>
    );
  }
);

Button.displayName = "Button";

export default Button;
