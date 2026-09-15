import type { FormattedSection, ItemSlideType } from "../types";

export const getFreeSectionNumber = (slide: ItemSlideType): number | null => {
  const match = slide.name?.match(/^Section\s+(\d+)(?:[A-Z])?/);
  return match ? Number(match[1]) : null;
};

export const getFreeSectionDisplayName = (
  slide: ItemSlideType,
  formattedSections: FormattedSection[] = [],
): string => {
  const match = slide.name?.match(/^Section\s+(\d+)([A-Z])?/);
  if (!match) return slide.name;

  const sectionNum = Number(match[1]);
  const suffix = match[2] ? ` ${match[2]}` : "";
  const customName = formattedSections
    .find((section) => section.sectionNum === sectionNum)
    ?.name?.trim();

  return customName
    ? `${customName}${suffix}`
    : `Section ${sectionNum}${match[2] || ""}`;
};
