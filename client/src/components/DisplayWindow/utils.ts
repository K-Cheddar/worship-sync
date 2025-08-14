export const getFontSize = ({
  width,
  fontSize = 1.5,
}: {
  width: number;
  fontSize?: number;
}) => {
  return `${(fontSize || 1.5) * (width / 50)}vw`;
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
