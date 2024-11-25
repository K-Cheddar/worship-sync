import "./Spinner.scss";

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
      className={`spinner ${className || ""}`}
      style={{
        width: width || "48px",
        height: width || "48px",
        borderWidth: borderWidth || "5px",
      }}
    />
  );
};

export default Spinner;
