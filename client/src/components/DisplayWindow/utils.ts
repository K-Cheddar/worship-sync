export const getFontSize = ({
  width,
  fontSize = 15,
}: {
  width: number;
  fontSize?: number;
}) => {
  return `${((fontSize || 15) / 10) * (width / 50)}vw`;
};

export const getBorderWidth = ({
  width,
  borderWidth,
}: {
  width: number;
  borderWidth?: number;
}) => {
  return `${(borderWidth || 0) * (width / 400)}vw`;
};

export const getMargin = (margin: number | "auto" | "unset" | undefined) => {
  return typeof margin === "number" ? `${margin}%` : margin;
};
