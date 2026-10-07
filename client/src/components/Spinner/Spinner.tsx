import { cn } from "../../utils/cnHelper";

const Spinner = ({
  className,
  width,
  borderWidth,
  size = "lg",
  "aria-label": ariaLabel,
}: {
  className?: string;
  width?: string;
  borderWidth?: string;
  size?: "xs" | "sm" | "md" | "lg";
  "aria-label"?: string;
}) => {
  return (
    <span
      role={ariaLabel ? "status" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn(
        "inline-block shrink-0 box-border rounded-full border-solid border-current border-b-transparent text-white animate-spin motion-reduce:animate-none",
        className
      )}
      style={{
        width: width || { xs: "14px", sm: "16px", md: "24px", lg: "48px" }[size],
        height: width || { xs: "14px", sm: "16px", md: "24px", lg: "48px" }[size],
        borderWidth: borderWidth || { xs: "2px", sm: "2px", md: "3px", lg: "5px" }[size],
      }}
    />
  );
};

export default Spinner;
