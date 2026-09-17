import { REFERENCE_HEIGHT, REFERENCE_WIDTH } from "../../constants";
import { calculateReferenceScaleFactor } from "../../components/DisplayWindow/referenceCanvas";
import { calculateStaticThumbnailScaleFactor } from "./staticThumbnailGeometry";

describe("calculateStaticThumbnailScaleFactor", () => {
  it("derives the tile scale from shared grid geometry", () => {
    expect(
      calculateStaticThumbnailScaleFactor({
        containerWidth: 1920,
        columns: 1,
      }),
    ).toBe(1);
  });

  it("preserves uniform scaling for fractional tile widths", () => {
    const containerWidth = 1000;
    const columns = 3;
    const columnGap = 4;
    const horizontalPadding = 16;
    const horizontalBorder = 4;
    const tileWidth =
      (containerWidth - horizontalPadding - columnGap * (columns - 1)) /
        columns -
      horizontalBorder;

    expect(
      calculateStaticThumbnailScaleFactor({
        containerWidth,
        columns,
        columnGap,
        horizontalPadding,
        horizontalBorder,
      }),
    ).toBe(
      calculateReferenceScaleFactor(
        tileWidth,
        (tileWidth * REFERENCE_HEIGHT) / REFERENCE_WIDTH,
      ),
    );
  });

  it("uses the constrained dimension when the available height is smaller", () => {
    expect(
      calculateStaticThumbnailScaleFactor({
        containerWidth: 1920,
        containerHeight: 540,
        columns: 1,
      }),
    ).toBe(0.5);
  });
});
