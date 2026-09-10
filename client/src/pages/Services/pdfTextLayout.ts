/** Rebuild readable lines from PDF.js text items (position-aware). */
export type PdfTextLayoutItem = {
  str?: string;
  transform?: number[];
};

/** Group PDF.js text items into top-to-bottom, left-to-right lines. */
export const reconstructPdfPageText = (items: PdfTextLayoutItem[]): string => {
  const lines: Array<{ y: number; parts: Array<{ x: number; text: string }> }> =
    [];

  for (const item of items) {
    if (typeof item.str !== "string" || !Array.isArray(item.transform))
      continue;
    const text = item.str.replace(/\s+/g, " ");
    if (!text.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const existing = lines.find((line) => Math.abs(line.y - y) < 2.5);
    if (existing) {
      existing.parts.push({ x, text });
    } else {
      lines.push({ y, parts: [{ x, text }] });
    }
  }

  // PDF coordinates grow upward; sort so the top of the page comes first.
  lines.sort((a, b) => b.y - a.y);

  return lines
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
};
