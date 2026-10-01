/** Inclusive overlap for plain YYYY-MM-DD windows. Missing endpoints collapse
 * to the endpoint that is present; fully undated legacy records remain visible.
 */
export const overlapsInclusiveDateRange = (
  item: { startDate?: string | null; endDate?: string | null },
  range: { startDate: string; endDate: string },
) => {
  if (!range.startDate && !range.endDate) return true;
  const itemStart = item.startDate || item.endDate || "";
  const itemEnd = item.endDate || item.startDate || "";
  if (!itemStart || !itemEnd) return true;
  if (range.startDate && itemEnd < range.startDate) return false;
  if (range.endDate && itemStart > range.endDate) return false;
  return true;
};
