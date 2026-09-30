import { bibleStructure } from "../../utils/bibleStructure";
import { parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";
import type { ServicePlanImportAmbiguity } from "../../types/servicePlan";

export const SERVICE_PLANNING_EMPTY_TITLE_REASON = "The source title is empty.";

/** Reasons that explain an import condition without asking the operator to choose an interpretation. */
export const servicePlanningReasonRequiresReview = (reason: string): boolean =>
  reason !== SERVICE_PLANNING_EMPTY_TITLE_REASON;

export const servicePlanningReasonsRequireReview = (reasons: string[]): boolean =>
  reasons.some(servicePlanningReasonRequiresReview);

/** Shared review predicate for importer output, refreshes, and row indicators. */
export const servicePlanImportAmbiguityNeedsReview = (
  ambiguity: Pick<
    ServicePlanImportAmbiguity,
    "authorizationPending" | "status" | "parts" | "songMappings" | "reasons"
  >,
): boolean => Boolean(
  ambiguity.authorizationPending ||
  (ambiguity.status !== "confirmed" &&
    ambiguity.status !== "acknowledged" &&
    (ambiguity.parts.length > 0 ||
      Boolean(ambiguity.songMappings?.length) ||
      servicePlanningReasonsRequireReview(ambiguity.reasons))),
);

/** A deferred item remains visible to the row, but is not re-opened by the next refresh. */
export const servicePlanImportAmbiguityShouldQueue = (
  ambiguity: Pick<
    ServicePlanImportAmbiguity,
    "authorizationPending" | "status" | "parts" | "songMappings" | "reasons"
  >,
): boolean => ambiguity.status !== "deferred" && servicePlanImportAmbiguityNeedsReview(ambiguity);

export type ServicePlanningTitlePart = {
  kind: "scripture" | "url" | "person" | "description";
  value: string;
  destination: "scripture" | "resource" | "assignee" | "content" | "notes" | "unassigned";
  sourceField?: "title" | "note" | "ledBy";
};

export type ServicePlanningTitleClassification = {
  parts: ServicePlanningTitlePart[];
  reasons: string[];
  suggestedAssignees: string[];
  scripture?: ReturnType<typeof parseBibleReference>;
  urls: string[];
  content: string;
};

const bookNames = [...bibleStructure.books.map(({ name }) => name), "Psalm", "Ps", "Psa"];
const bookPattern = bookNames
  .sort((left, right) => right.length - left.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"))
  .join("|");
const scripturePattern = new RegExp(
  `\\b(?:[1-3]\\s+)?(?:${bookPattern})\\.?\\s+\\d+(?:\\s*:\\s*\\d+(?:\\s*-\\s*\\d+)?)?(?:\\s*\\(\\s*[A-Za-z0-9]+\\s*\\))?(?:\\s+[A-Za-z0-9]+)?`,
  "gi",
);
const urlPattern = /https?:\/\/[^\s<>()"']+/gi;
const stripUrlPunctuation = (url: string) => url.replace(/[.,;!?]+$/g, "");
const hasMalformedUrlLike = (...values: string[]) =>
  values
    .flatMap((value) => [...value.matchAll(/(?:https?:\/\/|www\.)[^\s<>()"']*/gi)])
    .map((match) => stripUrlPunctuation(match[0]))
    .some((candidate) => {
      try {
        const url = new URL(candidate);
        return !["http:", "https:"].includes(url.protocol) || !url.hostname;
      } catch {
        return true;
      }
    });
const normalizeUrlForDuplicate = (value: string) => {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return value;
  }
};

const extractUrls = (...values: string[]) => {
  const rawUrls = values.flatMap((value) =>
    [...value.matchAll(urlPattern)].map((match) => stripUrlPunctuation(match[0])),
  );
  const validUrls = rawUrls.filter((url) => {
    try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; }
  });
  const urlsByKey = new Map<string, string>();
  validUrls.forEach((url) => {
    const key = normalizeUrlForDuplicate(url);
    if (!urlsByKey.has(key)) urlsByKey.set(key, url);
  });
  return [...urlsByKey.values()];
};

const extractUrlParts = (title: string, note: string): ServicePlanningTitlePart[] =>
  extractUrls(title, note).map((url) => ({
    kind: "url",
    value: url,
    destination: "resource",
    sourceField: title.includes(url) ? "title" : "note",
  }));

const unique = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const splitNames = (value: string): string[] => {
  const withoutRole = value.replace(/^\s*Co[- ]?Hosts?\s*[:–—-]\s*/i, "");
  return unique(withoutRole.split(/\s*(?:,|;|\n|\s+&\s+|\s+and\s+|\s+\+\s+)\s*/i).map((name) => name.trim()).filter(Boolean));
};

const looksLikeName = (value: string) => {
  if (!/^[\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){1,2}$/u.test(value)) return false;
  if (/\b(?:team|choir|group|band|conference|ministry|church|committee|class|department|service)\b/i.test(value)) return false;
  return !/\b(?:with|the|of|and|for|to)\b/i.test(value);
};

const knownNameMatch = (candidate: string, knownPeople: string[]) => {
  const normalized = candidate.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  return knownPeople.some((name) => name.toLocaleLowerCase().replace(/\s+/g, " ").trim() === normalized);
};

const extractScripture = (source: string) => {
  for (const match of source.matchAll(scripturePattern)) {
    const matched = match[0].trim();
    const tokens = matched.split(/\s+/);
    for (let length = tokens.length; length > 0; length -= 1) {
      const text = tokens.slice(0, length).join(" ");
      const parsed = parseBibleReference(text);
      if (parsed) return { text, parsed, index: match.index ?? 0 };
    }
  }
  const parsed = parseBibleReference(source);
  return parsed ? { text: source.trim(), parsed, index: 0 } : undefined;
};

const removeRange = (value: string, index: number, text: string) =>
  `${value.slice(0, index)} ${value.slice(index + text.length)}`
    .replace(/\s+/g, " ")
    .replace(/[\s–—:;-]+$/g, "")
    .replace(/^[\s–—:;-]+/g, "")
    .trim();

/** Deterministically separates supported content from an external Service Planning Title. */
export const classifyServicePlanningTitle = ({
  title,
  note = "",
  ledBy = "",
  songTitle = "",
  knownPeople = [],
}: {
  title: string;
  note?: string;
  ledBy?: string;
  songTitle?: string;
  knownPeople?: string[];
}): ServicePlanningTitleClassification => {
  if (songTitle.trim()) {
    const urlParts = extractUrlParts(title, note);
    const urls = urlParts.map(({ value }) => value);
    return {
      parts: urlParts,
      reasons: hasMalformedUrlLike(title, note)
        ? ["A link-like value could not be validated."]
        : [],
      suggestedAssignees: [],
      urls,
      content: title,
    };
  }

  let remaining = title.trim();
  const parts: ServicePlanningTitlePart[] = [];
  const reasons: string[] = [];
  if (!remaining) reasons.push(SERVICE_PLANNING_EMPTY_TITLE_REASON);
  const scripture = extractScripture(remaining);
  if (scripture) {
    parts.push({ kind: "scripture", value: scripture.text, destination: "scripture" });
    remaining = removeRange(remaining, scripture.index, scripture.text);
    if (remaining) reasons.push("Additional title text remains after the scripture reference.");
  }

  const urlParts = extractUrlParts(title, note);
  const urls = urlParts.map(({ value }) => value);
  for (const url of urls) {
    const index = remaining.indexOf(url);
    if (index >= 0) remaining = removeRange(remaining, index, url);
    parts.push(urlParts.find((part) => part.value === url)!);
  }
  const malformedUrlLike = hasMalformedUrlLike(title, note);
  if (malformedUrlLike) reasons.push("A link-like value could not be validated.");

  const rolePrefix = remaining.match(/^\s*(Co[- ]?Hosts?\s*[:–—-]\s*)/i)?.[1] || "";
  if (rolePrefix) remaining = remaining.slice(rolePrefix.length).trim();
  let nameSource = remaining;
  let contentPrefix = "";
  const finalDash = remaining.match(/^(.*?)(?:\s+[–—-]\s+)([^–—-]+)$/);
  if (finalDash) {
    const suffix = finalDash[2].trim();
    const suffixNames = splitNames(suffix);
    if (suffixNames.length && suffixNames.every((name) => looksLikeName(name) || knownNameMatch(name, knownPeople))) {
      contentPrefix = finalDash[1].trim();
      nameSource = suffix;
    }
  }
  const nameCandidates = splitNames(nameSource);
  const allKnown = nameCandidates.length > 0 && nameCandidates.every((name) => knownNameMatch(name, knownPeople));
  const looksLikeNameList = nameCandidates.length > 0 && nameCandidates.every(looksLikeName);
  const suggestedAssignees = (allKnown || looksLikeNameList) ? nameCandidates : [];
  if (suggestedAssignees.length) {
    suggestedAssignees.forEach((name) => parts.push({ kind: "person", value: name, destination: "assignee" }));
    if (!allKnown) reasons.push("The title resembles a list of names, but not every name matches a known person.");
    else {
      const additionalTextReason = "Additional title text remains after the scripture reference.";
      const index = reasons.indexOf(additionalTextReason);
      if (index >= 0) reasons.splice(index, 1);
    }
    if (rolePrefix) parts.push({ kind: "description", value: rolePrefix.trim().replace(/[:–—-]$/, "").trim(), destination: "content" });
    if (contentPrefix) parts.push({ kind: "description", value: contentPrefix, destination: "content" });
    remaining = contentPrefix;
  } else if (remaining) {
    parts.push({ kind: "description", value: remaining, destination: "content" });
    if (!scripture && !urls.length && !songTitle.trim()) reasons.push("The title could be descriptive content or an assignee.");
  }

  return {
    parts: parts.map((part) => ({ sourceField: "title", ...part })),
    reasons: unique(reasons),
    suggestedAssignees,
    ...(scripture ? { scripture: scripture.parsed } : {}),
    urls,
    content: remaining,
  };
};
