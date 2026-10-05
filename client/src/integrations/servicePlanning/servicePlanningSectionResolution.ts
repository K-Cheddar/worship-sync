import type { ServiceItem } from "../../types";
import type { ServicePlanningSectionRule } from "../../types/integrations";

const normalizeWhitespace = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

/** Match section names with the semantics used by the URL preview path. */
export const matchesServicePlanningSectionName = (
  sectionName: string,
  rule: Pick<ServicePlanningSectionRule, "matchSectionName" | "matchMode">,
): boolean => {
  const section = normalizeWhitespace(sectionName);
  const ruleName = normalizeWhitespace(rule.matchSectionName);
  if (!section || !ruleName) return false;
  if (rule.matchMode === "exact") return section === ruleName;
  if (rule.matchMode === "normalize") {
    const normalizedSection = section.replace(/[^a-z0-9 ]/g, "");
    const normalizedRule = ruleName.replace(/[^a-z0-9 ]/g, "");
    return normalizedSection.includes(normalizedRule) || normalizedRule.includes(normalizedSection);
  }
  return section.includes(ruleName) || ruleName.includes(section);
};

/** Canonical identity comparison for an existing outline heading. */
export const normalizeServicePlanningHeadingName = (value: string): string =>
  normalizeWhitespace(value)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type ServicePlanningSectionResolution = {
  rule?: ServicePlanningSectionRule;
  heading?: ServiceItem;
  headingName?: string;
  issue?: {
    sectionName: string;
    headingName?: string;
    reason: "mapped-heading-missing" | "no-matching-heading";
  };
};

/** Resolve a section rule first; direct name matching is only a no-rule fallback. */
export const resolveServicePlanningSection = ({
  sectionName,
  sectionRules,
  outline,
}: {
  sectionName: string;
  sectionRules: ServicePlanningSectionRule[];
  outline: ServiceItem[];
}): ServicePlanningSectionResolution => {
  const rule = sectionRules.find((candidate) =>
    matchesServicePlanningSectionName(sectionName, candidate),
  );
  const headingName = rule ? rule.headingName : sectionName;
  const normalizedHeadingName = normalizeServicePlanningHeadingName(headingName);
  const heading = outline.find(
    (item) =>
      Boolean(normalizedHeadingName) &&
      item.type === "heading" &&
      normalizeServicePlanningHeadingName(item.name) === normalizedHeadingName,
  );

  if (heading) return { rule, heading, headingName };
  return {
    rule,
    headingName,
    issue: {
      sectionName,
      ...(rule ? { headingName: rule.headingName } : {}),
      reason: rule ? "mapped-heading-missing" : "no-matching-heading",
    },
  };
};
