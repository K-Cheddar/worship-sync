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
import { findBestSongMatchByName } from "../../integrations/servicePlanning/findServicePlanningSongMatch";
import { parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";
import generateRandomId from "../../utils/generateRandomId";
import { multilineTextToRichText, plainTextToRichText } from "../../types/richText";
import { getServicePlanElementType } from "../../types/servicePlan";
import type {
  ServicePlanElement,
  ServicePlanElementType,
  ServicePlanSection,
  ServicePlanSourceImport,
} from "../../types/servicePlan";

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
  if (/\b(announcement|announcements|welcome)\b/.test(text)) return "announcement";
  if (/\b(header|heading|divider)\b/.test(text)) return "heading";
  return "free";
};

const buildElementFromRow = <T extends { _id: string; name: string }>(
  row: EventData,
  songs: T[],
  sourceMarksSongs: boolean,
): ServicePlanElement => {
  const type = row.songTitle
    ? "song"
    : guessServicePlanElementType(row.elementType, row.title, {
      skipSongWords: sourceMarksSongs,
    });
  const rawTitle = row.title?.trim() || row.elementType?.trim() || "Untitled";
  const ledBy = row.ledBy?.trim();

  const element: ServicePlanElement = {
    id: generateRandomId(),
    sourcePlanningManaged: true,
    type,
    title: plainTextToRichText(rawTitle),
    ...(row.elementType?.trim()
      ? { sourceElementTypeRaw: row.elementType.trim() }
      : {}),
    ...(ledBy ? { assignedName: ledBy, sourceLedByRaw: ledBy } : {}),
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
    ...(row.note ? { notes: multilineTextToRichText(row.note) } : {}),
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
    const cleanedTitle = cleanPlanningTitle(row.songTitle?.trim() || rawTitle);
    const matched = findBestSongMatchByName(cleanedTitle, songs);
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
): ServicePlanSection[] => {
  // Service Planning marks its own songs with a music icon. When a plan uses
  // those markers they settle the question completely — an unmarked row is not
  // a song, whatever it is called. Wording only decides it for the older
  // layouts that mark nothing.
  const sourceMarksSongs = data.sections.some((section) =>
    section.rows.some((row) => Boolean(row.songTitle)),
  );

  return data.sections.map((section) => ({
    id: generateRandomId(),
    sourcePlanningManaged: true,
    name: section.sectionName?.trim() || "Section",
    elements: section.rows.map((row) =>
      buildElementFromRow(row, songs, sourceMarksSongs),
    ),
  }));
};

export const buildServicePlanSourceImport = (
  data: ServicePlanningImportData,
  sourceUrl: string,
): ServicePlanSourceImport => ({
  source: "servicePlanning",
  sourceUrl,
  loadedAt: new Date().toISOString(),
  planLabel: data.planLabel || "Imported plan",
});
