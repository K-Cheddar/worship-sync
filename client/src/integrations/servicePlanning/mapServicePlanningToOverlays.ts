import type { EventData } from "../../containers/Overlays/eventParser";
import type {
  NameColumnKey,
  ServicePlanningConfig,
  ServicePlanningElementRule,
  ServicePlanningMatchMode,
  ServicePlanningPerson,
} from "../../types/integrations";
import { normalizeElementTypeForMatch } from "./normalizeElementForMatch";

export type ServicePlanningFieldPatch = {
  name?: string;
  title?: string;
  event?: string;
  heading?: string;
  subHeading?: string;
};

export type ServicePlanningCandidate = {
  personIndex: number;
  rawNameToken: string;
  patch: ServicePlanningFieldPatch;
};

export type ServicePlanningMappedRow = {
  source: EventData;
  rule: ServicePlanningElementRule;
  matchKey: string;
  candidates: ServicePlanningCandidate[];
};

const applyTemplate = (
  tpl: string | undefined,
  ctx: Record<string, string>,
): string | undefined => {
  if (tpl == null || !String(tpl).trim()) return undefined;
  let out = String(tpl);
  for (const [k, v] of Object.entries(ctx)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out.trim();
};

/** Default overlay event label: custom `displayName`, or when blank the rule's "Match element type" value. */
export const effectiveRuleEventLabel = (
  rule: ServicePlanningElementRule,
): string => {
  const custom = rule.displayName.trim();
  if (custom.length > 0) return custom;
  return rule.matchElementType.trim();
};

export const ruleAppliesToOverlaySync = (
  rule: ServicePlanningElementRule,
): boolean => rule.overlaySyncEnabled !== false;

export const ruleMatchesElementType = (
  elementType: string,
  rule: ServicePlanningElementRule,
): boolean => {
  const t = elementType.toLowerCase().trim();
  const m = rule.matchElementType.toLowerCase().trim();
  if (!m) return false;
  if (rule.matchMode === "exact") return t === m;
  if (rule.matchMode === "contains") return t.includes(m) || m.includes(t);
  const nt = normalizeElementTypeForMatch(elementType);
  const nm = normalizeElementTypeForMatch(rule.matchElementType);
  return nt.includes(nm) || nm.includes(nt) || t.includes(m) || m.includes(t);
};

const matchModeWeight = (matchMode: ServicePlanningMatchMode): number => {
  if (matchMode === "exact") return 3;
  if (matchMode === "contains") return 2;
  return 1;
};

const ruleSpecificityScore = (rule: ServicePlanningElementRule): number =>
  rule.matchElementType.trim().length;

export const findBestMatchingElementRule = (
  elementType: string,
  rules: ServicePlanningElementRule[],
  options?: {
    filter?: (rule: ServicePlanningElementRule) => boolean;
  },
): ServicePlanningElementRule | null => {
  let bestRule: ServicePlanningElementRule | null = null;
  let bestWeight = -1;
  let bestSpecificity = -1;

  for (const rule of rules) {
    if (options?.filter && !options.filter(rule)) continue;
    if (!ruleMatchesElementType(elementType, rule)) continue;

    const currentWeight = matchModeWeight(rule.matchMode);
    const currentSpecificity = ruleSpecificityScore(rule);

    if (
      currentWeight > bestWeight ||
      (currentWeight === bestWeight && currentSpecificity > bestSpecificity)
    ) {
      bestRule = rule;
      bestWeight = currentWeight;
      bestSpecificity = currentSpecificity;
    }
  }

  return bestRule;
};

const mergeColumns = (row: EventData, keys: NameColumnKey[]): string => {
  const parts: string[] = [];
  for (const k of keys) {
    const v = row[k]?.trim();
    if (v) parts.push(v);
  }
  return parts.join(" ");
};

export const findPersonForToken = (
  token: string,
  people: ServicePlanningPerson[],
): ServicePlanningPerson | null => {
  const t = token.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return null;
  let best: ServicePlanningPerson | null = null;
  let bestLen = 0;
  for (const p of people) {
    for (const n of [p.displayName, ...p.names]) {
      const nl = n.toLowerCase().replace(/\s+/g, " ").trim();
      if (!nl) continue;
      if (t.includes(nl) || nl.includes(t)) {
        if (nl.length > bestLen) {
          bestLen = nl.length;
          best = p;
        }
      }
    }
  }
  return best;
};

const chunkMergedText = (merged: string): string[] =>
  merged
    .split(/\s*,\s*|\s*&\s*|\s+and\s+/i)
    .map((s) => s.replace(/^co-host-/i, "").trim())
    .filter(Boolean);

/**
 * Split each enabled column’s text into name tokens, then concatenate in column order.
 * Joining columns with a space before splitting (old `mergeColumns` + chunk) merged the last
 * title token with the first led-by token into one string (e.g. "Bob Charlie").
 */
const tokensPerColumnThenFlatten = (
  row: EventData,
  keys: NameColumnKey[],
  splitOneCell: (cell: string) => string[],
): string[] => {
  const out: string[] = [];
  for (const k of keys) {
    const cell = row[k]?.trim();
    if (!cell) continue;
    out.push(...splitOneCell(cell));
  }
  return out;
};

/**
 * RTDB may deserialize numeric-key arrays as plain objects; `.filter` would crash on objects.
 */
export const normalizeEventSuffixList = (
  raw: unknown,
): string[] | undefined => {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    return raw.length > 0
      ? raw.map((x) => (x == null ? "" : String(x)))
      : undefined;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => /^\d+$/.test(k));
    if (keys.length === 0) return undefined;
    keys.sort((a, b) => Number(a) - Number(b));
    return keys.map((k) => (o[k] == null ? "" : String(o[k])));
  }
  return undefined;
};

const collectPeopleFromColumnTokens = (
  chunks: string[],
  merged: string,
  people: ServicePlanningPerson[],
): ServicePlanningPerson[] => {
  const found: ServicePlanningPerson[] = [];
  const seen = new Set<string>();
  const consider = (chunk: string) => {
    const p = findPersonForToken(chunk, people);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      found.push(p);
    }
  };
  for (const chunk of chunks) consider(chunk);
  if (found.length === 0 && merged.trim()) {
    consider(merged);
  }
  return found;
};

/** Resolve suffix string for split token index (supports repeating the last configured suffix). */
export const resolveEventSuffixForSplitIndex = (
  suffixes: string[] | undefined,
  personIndex: number,
  repeatLastForOverflow: boolean | undefined,
): string | undefined => {
  const list = suffixes?.filter((s) => s != null) ?? [];
  if (list.length === 0) return undefined;
  if (personIndex < list.length) return list[personIndex];
  if (repeatLastForOverflow) return list[list.length - 1];
  return undefined;
};

const splitTokensForMulti = (
  merged: string,
  separators?: string[],
): string[] => {
  if (!merged.trim()) return [];
  const extra = separators?.length ? separators : [",", "&"];
  let parts: string[] = [merged];
  for (const sep of extra) {
    parts = parts.flatMap((p) => p.split(sep));
  }
  parts = parts.flatMap((p) => p.split(/\s+and\s+/i));
  return parts.map((p) => p.replace(/^co-host-/i, "").trim()).filter(Boolean);
};

export const mapServicePlanningRows = (
  rows: EventData[],
  config: ServicePlanningConfig,
): ServicePlanningMappedRow[] => {
  const out: ServicePlanningMappedRow[] = [];

  for (const row of rows) {
    const rule = findBestMatchingElementRule(
      row.elementType,
      config.elementRules,
    );
    if (!rule || !ruleAppliesToOverlaySync(rule)) continue;

    const merged = mergeColumns(row, rule.nameSources);
    const personMatchChunks = tokensPerColumnThenFlatten(
      row,
      rule.nameSources,
      chunkMergedText,
    );
    const matchKey = normalizeElementTypeForMatch(row.elementType);
    const eventDefaultLabel = effectiveRuleEventLabel(rule);
    const eventSuffixList = normalizeEventSuffixList(
      rule.multiOverlay.eventSuffixByPersonIndex,
    );

    if (rule.multiOverlay.mode === "single") {
      const matchedPeople = collectPeopleFromColumnTokens(
        personMatchChunks,
        merged,
        config.people,
      );
      const namesJoined = matchedPeople.map((p) => p.displayName).join(" & ");
      const titlesJoined = matchedPeople
        .map((p) => p.title)
        .filter(Boolean)
        .join(" & ");

      const ctx: Record<string, string> = {
        displayName: eventDefaultLabel,
        names: namesJoined || merged,
        name: matchedPeople[0]?.displayName || namesJoined || merged,
        title: titlesJoined,
        rawTitle: row.title,
        rawLedBy: row.ledBy,
        rawElementType: row.elementType,
      };

      const patch: ServicePlanningFieldPatch = {
        name:
          applyTemplate(rule.fieldTemplates?.name, ctx) ??
          (namesJoined || merged),
        title:
          applyTemplate(rule.fieldTemplates?.title, ctx) ??
          (titlesJoined || undefined),
        event:
          applyTemplate(rule.fieldTemplates?.event, ctx) ?? eventDefaultLabel,
      };

      out.push({
        source: row,
        rule,
        matchKey,
        candidates: [
          {
            personIndex: 0,
            rawNameToken: merged,
            patch,
          },
        ],
      });
      continue;
    }

    const tokens = tokensPerColumnThenFlatten(row, rule.nameSources, (cell) =>
      splitTokensForMulti(cell, rule.multiOverlay.splitSeparators),
    );
    const candidates: ServicePlanningCandidate[] = tokens.map((token, idx) => {
      const person = findPersonForToken(token, config.people);
      const rawSuffix = resolveEventSuffixForSplitIndex(
        eventSuffixList,
        idx,
        rule.multiOverlay.repeatLastEventSuffix,
      );
      const trimmedSuffix = rawSuffix != null ? String(rawSuffix).trim() : "";
      const eventBase = trimmedSuffix
        ? `${eventDefaultLabel} ${trimmedSuffix}`.replace(/\s+/g, " ")
        : eventDefaultLabel;

      const ctx: Record<string, string> = {
        displayName: eventDefaultLabel,
        names: person?.displayName || token,
        name: person?.displayName || token,
        title: person?.title || "",
        rawTitle: row.title,
        rawLedBy: row.ledBy,
        rawElementType: row.elementType,
        event: eventBase,
      };

      const patch: ServicePlanningFieldPatch = {
        name: applyTemplate(rule.fieldTemplates?.name, ctx) ?? ctx.name,
        title:
          applyTemplate(rule.fieldTemplates?.title, ctx) ??
          (person?.title || undefined),
        event: applyTemplate(rule.fieldTemplates?.event, ctx) ?? eventBase,
      };

      return {
        personIndex: idx,
        rawNameToken: token,
        patch,
      };
    });

    out.push({
      source: row,
      rule,
      matchKey,
      candidates,
    });
  }

  return out;
};
