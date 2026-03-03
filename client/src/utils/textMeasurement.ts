import { REFERENCE_WIDTH, REFERENCE_HEIGHT } from "../constants";

export type GetMaxLinesProps = {
  fontSizePx: number;
  height: number;
  topMargin?: number;
  isBold?: boolean;
  isItalic?: boolean;
};

export type MaxLinesResult = {
  maxLines: number;
  lineHeight: number;
};

export const getMaxLines = ({
  fontSizePx,
  height,
  topMargin: _topMargin,
  isBold,
  isItalic,
}: GetMaxLinesProps): MaxLinesResult => {
  try {
    const verticalMarginFactor = _topMargin ? (_topMargin * 2) / 100 : 0.06;
    const boxHeight = REFERENCE_HEIGHT * (height / 100);
    const calculatedHeight = boxHeight - verticalMarginFactor * boxHeight;

    const measureSpan = document.createElement("span");
    measureSpan.style.cssText = `
      font-size: ${fontSizePx}px;
      font-family: Inter, sans-serif;
      overflow-wrap: break-word;
      position: fixed;
      font-weight: ${isBold ? "bold" : "normal"};
      font-style: ${isItalic ? "italic" : "normal"};
      line-height: 1.25;
      visibility: hidden;
      padding: 0;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      box-sizing: border-box;
      width: ${REFERENCE_WIDTH}px;
    `;

    measureSpan.textContent = "Sample Text";
    document.body.appendChild(measureSpan);
    const singleLineHeight = measureSpan.getBoundingClientRect().height;

    measureSpan.textContent = "Sample\nText\nWith\nMultiple\nLines";
    const multiLineHeight = measureSpan.getBoundingClientRect().height;
    document.body.removeChild(measureSpan);

    const lineHeight = Math.max(singleLineHeight, multiLineHeight / 5);
    const maxLines = Math.floor(calculatedHeight / lineHeight);

    return {
      maxLines: Math.max(1, maxLines),
      lineHeight,
    };
  } catch (error) {
    console.error("Error calculating max lines:", error);
    return {
      maxLines: 1,
      lineHeight: fontSizePx * 1.25,
    };
  }
};

export type GetNumLinesProps = {
  text: string;
  fontSizePx: number;
  lineHeight: number;
  width: number;
  sideMargin?: number;
  isBold?: boolean;
  isItalic?: boolean;
};

export const getNumLines = ({
  text,
  fontSizePx,
  lineHeight,
  width,
  sideMargin: _sideMargin,
  isBold,
  isItalic,
}: GetNumLinesProps): number => {
  try {
    const sideMarginFactor = _sideMargin ? 1 - (_sideMargin * 2) / 100 : 0.92;
    const boxWidth = (REFERENCE_WIDTH * width) / 100;
    const calculatedWidth = boxWidth * sideMarginFactor;

    const measureSpan = document.createElement("span");
    measureSpan.style.cssText = `
      font-size: ${fontSizePx}px;
      font-family: Inter, sans-serif;
      overflow-wrap: break-word;
      white-space: pre-wrap;
      width: ${calculatedWidth}px;
      position: fixed;
      line-height: ${lineHeight}px;
      font-weight: ${isBold ? "bold" : "normal"};
      font-style: ${isItalic ? "italic" : "normal"};
      padding: 0;
      margin: 0;
      box-sizing: border-box;
      word-break: break-word;
    `;
    measureSpan.textContent = text;
    document.body.appendChild(measureSpan);

    const textHeight = measureSpan.getBoundingClientRect().height;
    document.body.removeChild(measureSpan);

    const numLines = Math.ceil(textHeight / lineHeight);
    return Math.max(1, numLines);
  } catch (error) {
    console.error("Error calculating number of lines:", error);
    return 1;
  }
};
