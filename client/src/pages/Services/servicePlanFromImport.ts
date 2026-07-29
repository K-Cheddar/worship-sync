/**
 * Converts a scraped Service Planning plan into ServicePlan sections —
 * reusing the exact same scrape/parse layer the Controller's Service Planning
 * import already uses (eventParser.ts), so a pasted plan URL behaves
 * identically either place. This deliberately doesn't reuse the
 * outline/overlay-specific matching in useServicePlanningImport.ts (that only
 * classifies rows as song/bible/none for the live outline) since a
 * ServicePlan element can be any of a broader set of types.
 */
import type { EventData, ServicePlanningImportData } from "../../containers/Overlays/eventParser";
import { cleanPlanningTitle } from "../../integrations/servicePlanning/cleanPlanningTitle";
import { getServicePlanningSongMatchScore } from "../../integrations/servicePlanning/findServicePlanningSongMatch";
import { parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";
import generateRandomId from "../../utils/generateRandomId";
import { plainTextToRichText } from "../../types/richText";
import { getServicePlanElementType } from "../../types/servicePlan";
import type {
  ServicePlanElement,
  ServicePlanElementType,
  ServicePlanSection,
  ServicePlanSourceImport,
} from "../../types/servicePlan";

const SONG_MATCH_THRESHOLD = 1;
const SONG_MATCH_MIN_RATIO = 0.75;

/** Best-effort classification of a raw Service Planning row into our broader
 * element type vocabulary — the source's own "element type" column is free
 * text set by whoever built the plan, not a fixed enum, so this is a keyword
 * guess rather than an exact mapping. Defaults to "free" when nothing matches. */
export const guessServicePlanElementType = (
  elementType: string,
  title: string,
): ServicePlanElementType => {
  const text = `${elementType} ${title}`.toLowerCase();
  if (/\b(song|hymn|worship|chorus|praise)\b/.test(text)) return "song";
  if (/\b(video|clip|film)\b/.test(text)) return "video";
  if (/\b(image|photo|slide|graphic)\b/.test(text)) return "image";
  if (/\b(scripture|bible|reading|verse)\b/.test(text)) return "bible";
  if (/\b(announcement|announcements|welcome)\b/.test(text)) return "announcement";
  if (/\b(header|heading|divider)\b/.test(text)) return "heading";
  return "free";
};

/** Same scoring/threshold as findBestServicePlanningSongMatch, but against a
 * minimal {_id, name} shape so callers don't need a full ServiceItem[] (the
 * presentation library's song docs aren't shaped like ServiceItem). */
const findBestSongDocMatch = <T extends { _id: string; name: string }>(
  planningTitle: string,
  songs: T[],
): T | null => {
  const termCount = cleanPlanningTitle(planningTitle)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean).length;
  const threshold = Math.max(SONG_MATCH_THRESHOLD, termCount * SONG_MATCH_MIN_RATIO);

  let best: T | null = null;
  let bestScore = threshold;
  for (const song of songs) {
    const score = getServicePlanningSongMatchScore(planningTitle, song.name);
    if (score > bestScore) {
      bestScore = score;
      best = song;
    }
  }
  return best;
};

const buildElementFromRow = <T extends { _id: string; name: string }>(
  row: EventData,
  songs: T[],
): ServicePlanElement => {
  const type = guessServicePlanElementType(row.elementType, row.title);
  const rawTitle = row.title?.trim() || row.elementType?.trim() || "Untitled";
  const ledBy = row.ledBy?.trim();

  const element: ServicePlanElement = {
    id: generateRandomId(),
    type,
    title: plainTextToRichText(rawTitle),
    ...(ledBy ? { assignedName: ledBy, sourceLedByRaw: ledBy } : {}),
    ...(row.startTime ? { startTime: row.startTime } : {}),
    ...(typeof row.durationMinutes === "number"
      ? {
        durationSeconds: Math.round(row.durationMinutes * 60),
        durationMinutes: row.durationMinutes,
      }
      : {}),
    ...(row.note ? { notes: plainTextToRichText(row.note) } : {}),
    ...(row.teamNotes?.length
      ? {
          teamNotes: row.teamNotes.map((teamNote) => ({
            id: generateRandomId(),
            label: teamNote.teamName,
            note: plainTextToRichText(teamNote.note),
          })),
        }
      : {}),
  };

  if (type === "song") {
    const cleanedTitle = cleanPlanningTitle(rawTitle);
    const matched = findBestSongDocMatch(cleanedTitle, songs);
    element.songRef = matched
      ? { kind: "library", songId: matched._id, songName: matched.name }
      : { kind: "pending", title: cleanedTitle, lyricsText: "" };
  } else if (type === "bible") {
    // The source's own row is free text ("Reading: John 3:16"), so only attach
    // when it actually parses as a reference — otherwise it stays a plain item
    // the operator can attach scripture to by hand.
    const parsed = parseBibleReference(rawTitle);
    if (parsed) {
      element.scriptureRef = {
        label: getBibleImportDisplayName(parsed, parsed.version),
        book: parsed.book,
        chapter: parsed.chapter,
        verseRange: parsed.verseRange,
        version: parsed.version,
      };
    }
  }

  // Kind follows the attachment that actually resolved, so a "Scripture" row
  // whose reference didn't parse doesn't claim to be a Bible item.
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
): ServicePlanSection[] =>
  data.sections.map((section) => ({
    id: generateRandomId(),
    name: section.sectionName?.trim() || "Section",
    elements: section.rows.map((row) => buildElementFromRow(row, songs)),
  }));

export const buildServicePlanSourceImport = (
  data: ServicePlanningImportData,
  sourceUrl: string,
): ServicePlanSourceImport => ({
  source: "servicePlanning",
  sourceUrl,
  loadedAt: new Date().toISOString(),
  planLabel: data.planLabel || "Imported plan",
});
