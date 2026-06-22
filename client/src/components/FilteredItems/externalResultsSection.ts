import { cn } from "../../utils/cnHelper";

export type ExternalSectionPosition = "only" | "start" | "middle" | "end";

export const EXTERNAL_SECTION_HEADER_HEIGHT = 52;
export const EXTERNAL_SECTION_FOOTER_HEIGHT = 32;

export const isExternalSectionRowKind = (kind: string) =>
  kind.startsWith("external");

export const getExternalSectionPosition = (
  rowIndex: number,
  rowKinds: string[],
): ExternalSectionPosition | null => {
  const kind = rowKinds[rowIndex];
  if (!kind || !isExternalSectionRowKind(kind)) return null;

  const prevIsExternal =
    rowIndex > 0 && isExternalSectionRowKind(rowKinds[rowIndex - 1] ?? "");
  const nextIsExternal =
    rowIndex < rowKinds.length - 1 &&
    isExternalSectionRowKind(rowKinds[rowIndex + 1] ?? "");

  if (!prevIsExternal && !nextIsExternal) return "only";
  if (!prevIsExternal) return "start";
  if (!nextIsExternal) return "end";
  return "middle";
};

/** Per-item card styling — matches library row radii with a cyan accent border. */
export const getExternalSectionClassName = (
  _position: ExternalSectionPosition | null = null,
) =>
  cn(
    "rounded-lg border border-cyan-500/20 transition-colors hover:border-cyan-500/30",
  );
