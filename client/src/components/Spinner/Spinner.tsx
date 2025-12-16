import { cn } from "../../utils/cnHelper";

const Spinner = ({
  className,
  width,
  borderWidth,
}: {
  className?: string;
  width?: string;
  borderWidth?: string;
}) => {
  return (
    <span
      className={cn(
        "inline-block box-border rounded-full border-solid border-white border-b-transparent animate-spin",
        className
      )}
      style={{
        width: width || "48px",
        height: width || "48px",
        borderWidth: borderWidth || "5px",
      }}
    />
  );
};

export default Spinner;
