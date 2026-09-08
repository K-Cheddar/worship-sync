const NARROW_LAYOUT_MAX_PX = 640;
const NARROW_MIN_TILE_WIDTH_PX = 168;
const WIDE_MIN_TILE_WIDTH_PX = 150;
const NARROW_MIN_COLS = 2;
const NARROW_MAX_COLS = 3;
const WIDE_MIN_COLS = 4;
const WIDE_MAX_COLS = 12;

/** Default thumbnail columns for the Media Library modal at a given width. */
export const calculateMediaLibraryGridColumns = (
  containerWidth: number,
): number => {
  const width = Math.max(0, containerWidth);
  const isNarrow = width < NARROW_LAYOUT_MAX_PX;
  const minTileWidth = isNarrow
    ? NARROW_MIN_TILE_WIDTH_PX
    : WIDE_MIN_TILE_WIDTH_PX;
  const minCols = isNarrow ? NARROW_MIN_COLS : WIDE_MIN_COLS;
  const maxCols = isNarrow ? NARROW_MAX_COLS : WIDE_MAX_COLS;
  const fitted = Math.floor(width / minTileWidth);
  return Math.min(maxCols, Math.max(minCols, fitted || minCols));
};
