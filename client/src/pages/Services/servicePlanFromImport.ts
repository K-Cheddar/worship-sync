/**
 * Converts a scraped Service Planning plan into ServicePlan sections —
 * reusing the exact same scrape/parse layer the Controller's Service Planning
 * import already uses (eventParser.ts), so a pasted plan URL behaves
 * identically either place. This deliberately doesn't reuse the
 * outline/overlay-specific matching in useServicePlanningImport.ts (that only
 * classifies rows as song/bible/none for the live outline) since a
 * ServicePlan element can be any of a broader set of types.
 */
import type {
  EventData,
  ServicePlanningImportData,
} from "../../containers/Overlays/eventParser";
import { cleanPlanningTitle } from "../../integrations/servicePlanning/cleanPlanningTitle";
import { findBestSongMatchByName } from "../../integrations/servicePlanning/findServicePlanningSongMatch";
import {
  extractPlanningKey,
  hasPlanningKeySuffix,
  libraryServicePlanSongRef,
} from "../../integrations/servicePlanning/formatSongTitleWithKey";
import { parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";
import generateRandomId from "../../utils/generateRandomId";
import {
  multilineTextToRichText,
  plainTextToRichText,
} from "../../types/richText";
import { getServicePlanElementScriptureRefs, getServicePlanElementType } from "../../types/servicePlan";
import type {
  ServicePlanAssignee,
  ServicePlanElement,
  ServicePlanElementType,
  ServicePlanSection,
  ServicePlanSourceImport,
} from "../../types/servicePlan";
import {
  classifyServicePlanningTitle,
  servicePlanningReasonsRequireReview,
} from "./servicePlanningTitleClassifier";
import { createServicePlanTextResource, getImportedTextResourceTitle } from "./servicePlanResources";
import { servicePlanNoteFingerprint, servicePlanResourceFingerprint } from "./servicePlanImportOwnership";

type ImportedAssigneeWithProvenance = ServicePlanAssignee & {
  servicePlanningImport?: {
    fields: Array<"title" | "ledBy">;
    ledByIdentity?: string;
    fingerprint: string;
  };
};

/**
 * These labels describe a content kind rather than a distinct service moment.
 * Keep this list centralized: title selection must not grow a collection of
 * unrelated keyword exceptions in each importer.
 */
const GENERIC_ELEMENT_LABELS = new Set([
  "song",
  "hymn",
  "chorus",
  "anthem",
  "item",
  "service item",
  "content",
]);

const normalizedElementLabel = (value: string): string =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

export const isGenericServicePlanElementLabel = (value: string): boolean =>
  GENERIC_ELEMENT_LABELS.has(normalizedElementLabel(value));

/** Select the visible service moment while retaining the source content title. */
export const chooseServicePlanElementTitle = (
  row: Pick<
    EventData,
    "elementType" | "title" | "contentTitle" | "songTitle"
  >,
): string => {
  const elementLabel = row.elementType?.trim() || "";
  const contentTitle =
    row.contentTitle?.trim() || row.songTitle?.trim() || row.title?.trim() || "";
  return (
    (elementLabel && !isGenericServicePlanElementLabel(elementLabel)
      ? elementLabel
      : "") ||
    contentTitle ||
    elementLabel ||
    "Untitled"
  );
};

const getImportedContentTitle = (row: EventData): string =>
  row.contentTitle?.trim() || row.songTitle?.trim() || row.title?.trim() || "";

/** Words that name a song outright, wherever they appear in the row. */
const SONG_WORDS = /\b(song|hymn|chorus|anthem)\b/;

/** "Praise" and "worship" only sometimes name a song: "Worship" is a set, but
 * "Call to Praise" is a spoken invitation and "Praise Report" is a testimony. */
const AMBIGUOUS_SONG_WORDS = /\b(praise|worship)\b/;

/** Rows whose only song-ish word is an ambiguous one and that read like one of
 * these are not songs. The bias is deliberate: attaching a song to a plain item
 * is one click, while a song wrongly attached during import has to be noticed
 * first and then removed. */
const NON_SONG_PHRASES =
  /\bcall to \w+|\bpraise report\b|\bworship (leader|cent(er|re))\b/;

/** Service Planning stores every person in one free-text Led by cell. Turn the
 * separators its printouts use into distinct assignee slots while retaining
 * the untouched source string for refresh comparisons and overlay rules. */
export const splitServicePlanningLedByNames = (ledBy: string): string[] =>
  ledBy
    .split(/\s*(?:,|;|\n|\s+&\s+|\s+and\s+)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);

/** Whether a row names a song, given that "praise"/"worship" alone don't. */
const readsAsSong = (text: string): boolean =>
  SONG_WORDS.test(text) ||
  (AMBIGUOUS_SONG_WORDS.test(text) && !NON_SONG_PHRASES.test(text));

/** Best-effort classification of a raw Service Planning row into our broader
 * element type vocabulary — the source's own "element type" column is free
 * text set by whoever built the plan, not a fixed enum, so this is a keyword
 * guess rather than an exact mapping. Defaults to "free" when nothing matches. */
export const guessServicePlanElementType = (
  elementType: string,
  title: string,
  /** Set when the source marked its own songs, so wording must not add more. */
  { skipSongWords = false }: { skipSongWords?: boolean } = {},
): ServicePlanElementType => {
  const text = `${elementType} ${title}`.toLowerCase();
  if (!skipSongWords && readsAsSong(text)) return "song";
  if (/\b(video|clip|film)\b/.test(text)) return "video";
  if (/\b(image|photo|slide|graphic)\b/.test(text)) return "image";
  if (/\b(scripture|bible|reading|verse)\b/.test(text)) return "bible";
  if (/\b(announcement|announcements|welcome)\b/.test(text))
    return "announcement";
  if (/\b(header|heading|divider)\b/.test(text)) return "heading";
  return "free";
};

const buildElementFromRow = <
  T extends {
    _id: string;
    name: string;
    songMetadata?: { key?: string } | null;
  },
>(
  row: EventData,
  songs: T[],
  sourceMarksSongs: boolean,
  options: { classifyExternalTitle?: boolean; knownPeople?: string[]; sourceKey?: string } = {},
): ServicePlanElement => {
  const contentTitle = getImportedContentTitle(row);
  const classification = options.classifyExternalTitle
    ? classifyServicePlanningTitle({
        title: contentTitle,
        note: row.note,
        ledBy: row.ledBy,
        songTitle: row.songTitle,
        knownPeople: options.knownPeople,
      })
    : undefined;
  const type =
    row.songTitle || hasPlanningKeySuffix(contentTitle)
      ? "song"
      : guessServicePlanElementType(row.elementType, contentTitle, {
          skipSongWords: sourceMarksSongs,
        });
  const rawTitle = chooseServicePlanElementTitle(row);
  const ledBy = row.ledBy?.trim();
  // Structured imports (Planning Center paste) may already split people; Service
  // Planning printouts still arrive as one Led-by string.
  const assigneeNames = (row.assigneeNames || [])
    .map((name) => name.trim())
    .filter(Boolean);
  const structuredPersonNames = (row.ledByAssignments || [])
    .filter((assignment) => assignment.kind === "person")
    .map((assignment) => assignment.name.trim())
    .filter(Boolean);
  const sourceAssigneeNames = assigneeNames.length
    ? assigneeNames
    : row.ledByAssignments?.length
      ? structuredPersonNames
    : ledBy
      ? splitServicePlanningLedByNames(ledBy)
      : [];
  const resolvedAssigneeNames = Array.from(new Map(
    [
      ...sourceAssigneeNames,
      ...(classification?.suggestedAssignees || []).filter((name) =>
        options.knownPeople?.some((known) => known.toLocaleLowerCase() === name.toLocaleLowerCase()),
      ),
    ].map((name) => [name.toLocaleLowerCase(), name]),
  ).values());
  const sourceLedByRaw =
    row.sourceLedByRaw?.trim() ||
    ledBy ||
    "";

  const sourceLedByAssignments = row.ledByAssignments?.length
    ? row.ledByAssignments.map((assignment) => ({
        kind: assignment.kind,
        ...(assignment.id ? { id: assignment.id } : {}),
        name: assignment.name,
      }))
    : undefined;

  const element: ServicePlanElement = {
    id: generateRandomId(),
    ...((row.sourceOccurrenceId || row.sourcePlanElementId)
      ? { sourceOccurrenceId: row.sourceOccurrenceId || row.sourcePlanElementId }
      : {}),
    sourcePlanningManaged: true,
    type,
    title: plainTextToRichText(rawTitle),
    ...(row.elementType?.trim()
      ? { sourceElementTypeRaw: row.elementType.trim() }
      : {}),
    ...(contentTitle ? { sourceContentTitleRaw: contentTitle } : {}),
    ...(row.note ? { sourceNoteRaw: row.note } : {}),
    ...(sourceLedByAssignments
      ? { sourceLedByAssignments }
      : {}),
    ...(sourceLedByRaw ? { sourceLedByRaw } : {}),
    ...(resolvedAssigneeNames.length
      ? {
          assignees: resolvedAssigneeNames.map((name) => {
            const matchingSource = sourceAssigneeNames.find((sourceName) =>
              sourceName.toLocaleLowerCase() === name.toLocaleLowerCase(),
            );
            const structuredSource = row.ledByAssignments?.find((assignment) =>
              assignment.kind === "person" && assignment.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
            );
            const titleDerived = (classification?.suggestedAssignees || []).some((sourceName) =>
              sourceName.toLocaleLowerCase() === name.toLocaleLowerCase(),
            );
            const fields = [
              ...(titleDerived ? ["title" as const] : []),
              ...(matchingSource ? ["ledBy" as const] : []),
            ];
            return {
              id: generateRandomId(),
              name,
              ...(fields.length ? {
                servicePlanningImport: {
                  fields,
                  ...(structuredSource?.id ? { ledByIdentity: structuredSource.id } : {}),
                  fingerprint: JSON.stringify({ name }),
                },
              } : {}),
            };
          }),
        }
      : {}),
    ...(row.startTime ? { startTime: row.startTime } : {}),
    ...(typeof row.durationMinutes === "number"
      ? {
          durationSeconds: Math.round(row.durationMinutes * 60),
          durationMinutes: row.durationMinutes,
        }
      : {}),
    // Notes are the one imported field that carries line structure (bullet
    // lists of mic assignments and the like), so they keep their own blocks
    // rather than collapsing into a single run-on paragraph.
    ...(row.note ? {
      notes: {
        blocks: multilineTextToRichText(row.note).blocks.map((block) => ({
          ...block,
          id: block.id || generateRandomId(),
        })),
      },
    } : {}),
    ...(row.teamNotes?.length
      ? {
          teamNotes: row.teamNotes.map((teamNote) => ({
            id: generateRandomId(),
            label: teamNote.teamName,
            note: multilineTextToRichText(teamNote.note),
          })),
        }
      : {}),
  };

  if (type === "song") {
    // The marker names the song on its own; the row title can also carry the
    // element type ("Welcome Song") or a second line, so it only stands in
    // when the source marked nothing.
    const songContentTitle = row.songTitle?.trim() || contentTitle || rawTitle;
    const cleanedTitle = cleanPlanningTitle(songContentTitle);
    const planningKey =
      extractPlanningKey(rawTitle) ||
      extractPlanningKey(contentTitle) ||
      extractPlanningKey(row.songTitle?.trim() || "");
    const matched = findBestSongMatchByName(cleanedTitle, songs);
    if (matched) {
      const libraryRef = libraryServicePlanSongRef(matched);
      element.songRef = {
        ...libraryRef,
        ...(!libraryRef.key && planningKey ? { key: planningKey } : {}),
      };
    } else {
      element.songRef = {
        kind: "pending",
        title: cleanedTitle,
        lyricsText: "",
        ...(planningKey ? { key: planningKey } : {}),
      };
    }
  }

  if (row.scriptureRefs?.length) {
    // Prefer structured refs from parsers that already extracted Scripture lines
    // (Planning Center), including when the item title is not itself a reference.
    element.scriptureRefs = row.scriptureRefs;
  } else if (classification?.scripture || type === "bible") {
    // The source's own row is free text ("Reading: John 3:16"), so only attach
    // when it actually parses as a reference — otherwise it stays a plain item
    // the operator can attach scripture to by hand.
    const parsed = classification?.scripture || parseBibleReference(contentTitle);
    if (parsed) {
      element.scriptureRef = {
        id: generateRandomId(),
        label: getBibleImportDisplayName(parsed, parsed.version),
        book: parsed.book,
        chapter: parsed.chapter,
        verseRange: parsed.verseRange,
        version: parsed.version,
      };
    }
  }

  let importedParts = classification?.parts || [];
  if (classification && classification.parts.length) {
    const descriptionParts = classification.parts.filter(
      (part) => part.kind === "description" &&
        part.destination === "content" &&
        part.value.trim().toLocaleLowerCase() !== (row.elementType || "").trim().toLocaleLowerCase(),
    );
    if (descriptionParts.length) {
      element.resources = descriptionParts.map((part) => createServicePlanTextResource({
        title: getImportedTextResourceTitle(part.value),
        text: multilineTextToRichText(part.value),
      }));
    }
    const descriptions = new Map(
      descriptionParts.map((part, index) => [part.value, element.resources![index]]),
    );
    importedParts = importedParts.map((part) => {
        if (part.kind === "description" && part.destination === "content") {
          const resource = descriptions.get(part.value);
          if (resource) return {
            ...part,
            managed: {
              kind: "resource" as const,
              id: resource.id,
              fingerprint: servicePlanResourceFingerprint(resource),
            },
          };
        }
        if (part.kind === "person" && part.destination === "assignee") {
          const wasLedBy = sourceAssigneeNames.some((name) =>
            name.toLocaleLowerCase() === part.value.toLocaleLowerCase(),
          );
          const assignee = !wasLedBy
            ? element.assignees?.find((item) =>
                item.name?.toLocaleLowerCase() === part.value.toLocaleLowerCase(),
              )
            : undefined;
          if (assignee) return {
            ...part,
            managed: {
              kind: "assignee" as const,
              id: assignee.id,
              fingerprint: JSON.stringify({ name: assignee.name }),
            },
          };
        }
        if (part.kind === "scripture" && part.destination === "scripture") {
          const parsed = parseBibleReference(part.value);
          const refs = getServicePlanElementScriptureRefs(element);
          const matches = parsed ? refs.filter((reference) =>
            reference.book.toLocaleLowerCase() === parsed.book.toLocaleLowerCase() &&
            reference.chapter === parsed.chapter && reference.verseRange === parsed.verseRange &&
            reference.version.toLocaleLowerCase() === parsed.version.toLocaleLowerCase(),
          ) : [];
          const scriptureRef = matches.length === 1 ? matches[0] : undefined;
          if (scriptureRef?.id) return {
            ...part,
            managed: {
              kind: "scripture" as const,
              id: scriptureRef.id,
              fingerprint: JSON.stringify({
                label: scriptureRef.label,
                book: scriptureRef.book,
                chapter: scriptureRef.chapter,
                verseRange: scriptureRef.verseRange,
                version: scriptureRef.version,
              }),
            },
          };
        }
        return part;
    });
  }

  if (
    classification &&
    (classification.parts.length > 0 || classification.reasons.length > 0 || classification.urls.length > 0)
  ) {
    const unresolved = servicePlanningReasonsRequireReview(classification.reasons);
    element.importAmbiguity = {
      source: "servicePlanning",
      sourceKey: options.sourceKey || "",
      sourceElementType: row.elementType || "",
      sourceTitle: row.title || "",
      sourceLedBy: row.sourceLedByRaw || row.ledBy || "",
      ...(row.note ? { sourceNote: row.note } : {}),
      parts: importedParts,
      reasons: classification.reasons,
      status: unresolved ? "unresolved" : "confirmed",
      sourceFingerprint: JSON.stringify([
        row.elementType || "",
        row.title || "",
        row.sourceLedByRaw || row.ledBy || "",
        row.note || "",
      ]),
      ...(classification.urls.length ? { authorizationPending: true } : {}),
    };
  }

  const sourceSnapshot = {
    elementType: row.elementType || "",
    title: row.title || "",
    ledBy: row.sourceLedByRaw || row.ledBy || "",
    note: row.note || "",
  };
  const importedAssignees = (element.assignees || []) as ImportedAssigneeWithProvenance[];
  const managedAssignees = importedAssignees.flatMap((assignee) =>
    assignee.servicePlanningImport
      ? [{ id: assignee.id, ...assignee.servicePlanningImport }]
      : [],
  );
  const managedNotes = (element.notes?.blocks || []).flatMap((block) =>
    block.id ? [{ id: block.id, fingerprint: servicePlanNoteFingerprint(block) }] : [],
  );
  if (importedAssignees.length) {
    element.assignees = importedAssignees.map((assignee) => {
      const cleaned = { ...assignee };
      delete cleaned.servicePlanningImport;
      return cleaned;
    });
  }
  element.servicePlanningImport = {
    observed: sourceSnapshot,
    applied: sourceSnapshot,
    pendingFields: [],
    ...(managedAssignees.length ? { managedAssignees } : {}),
    ...(managedNotes.length ? { managedNotes } : {}),
  };

  // Kind follows the attachment that actually resolved, so a "Scripture" row
  // whose reference didn't parse doesn't claim to be a Bible item. Video,
  // image, and announcement are retained in sourceElementTypeRaw for matching,
  // but remain free until the ServicePlan model gains those attachments.
  return { ...element, type: getServicePlanElementType(element) };
};

/** Builds fresh ServicePlanSections from a parsed Service Planning plan — its
 * own section breaks (e.g. "Call to Worship", "Message") map 1:1 onto our
 * sections, so no separate heading-detection pass is needed. */
export const buildServicePlanSectionsFromImport = <
  T extends { _id: string; name: string },
>(
  data: ServicePlanningImportData,
  songs: T[],
  options: { classifyExternalTitle?: boolean; knownPeople?: string[] } = {},
): ServicePlanSection[] => {
  // Service Planning marks its own songs with a music icon. When a plan uses
  // those markers they settle the question completely — an unmarked row is not
  // a song, whatever it is called. Wording only decides it for the older
  // layouts that mark nothing.
  const sourceMarksSongs = data.sections.some((section) =>
    section.rows.some((row) => Boolean(row.songTitle)),
  );

  return data.sections.map((section, sectionIndex) => ({
    id: generateRandomId(),
    sourcePlanningManaged: true,
    name: section.sectionName?.trim() || "Section",
    elements: section.rows.map((row, rowIndex) =>
      buildElementFromRow(row, songs, sourceMarksSongs, {
        ...options,
        sourceKey: `${section.sectionName || sectionIndex}:${rowIndex}`,
      }),
    ),
  }));
};

export const buildServicePlanSourceImport = (
  data: ServicePlanningImportData,
  sourceUrl: string,
  source: ServicePlanSourceImport["source"] = "servicePlanning",
  extras: {
    planningCenterServiceTypeId?: string;
    planningCenterPlanId?: string;
  } = {},
): ServicePlanSourceImport => ({
  source,
  sourceUrl,
  loadedAt: new Date().toISOString(),
  planLabel: data.planLabel || "Imported plan",
  ...(extras.planningCenterServiceTypeId
    ? { planningCenterServiceTypeId: extras.planningCenterServiceTypeId }
    : {}),
  ...(extras.planningCenterPlanId
    ? { planningCenterPlanId: extras.planningCenterPlanId }
    : {}),
});
