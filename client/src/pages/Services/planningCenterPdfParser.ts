/**
 * Parses Planning Center order-of-service PDF text into the same
 * ServicePlanningImportData shape the Service Planning HTML import already uses,
 * so buildServicePlanSectionsFromImport can build the plan without a second path.
 *
 * Expected shape (from Planning Center print / PDF):
 *   Main Worship Service
 *   September 5, 2026 - …
 *   Length
 *   in mins
 *   SMC Worship Experience
 *   15:00 SML
 *   Host: Charmers Malcolm
 *   4:00 Opening Song: Come Before His Presence
 *   …
 *   108:00
 */
import type {
  EventData,
  ServicePlanningImportData,
} from "../../containers/Overlays/eventParser";
import { parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";

const DURATION_WITH_TITLE = /^(\d{1,3}):(\d{2})\s+(.+?)\s*$/;
const DURATION_ONLY = /^(\d{1,3}):(\d{2})\s*$/;
const ROLE_LINE =
  /^(Host|Co-Host|Co Host|Speaker|Leader|Worship Leader|Pastor|Reader|Presenter|Emcee|MC|Facilitator):\s*(.+)$/i;
const SCRIPTURE_LINE = /^Scripture:\s*(.+)$/i;
const SONG_WITH_NAME =
  /^(Opening Song|Closing Song|Offering Song|Appeal Song|Worship Song|Song)\s*:\s*(.+)$/i;
const GENERIC_SONG_TITLE =
  /^(Opening Song|Closing Song|Offering Song|Appeal Song|Worship Song|Song)$/i;
const SKIP_LINE =
  /^(Length|in mins|Length in mins|--\s*\d+\s+of\s+\d+\s*--|\d+\s+of\s+\d+)$/i;

const toDurationMinutes = (
  minutesPart: string,
  secondsPart: string,
): number => {
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);
  return minutes + seconds / 60;
};

const looksLikeSongTitle = (title: string): boolean =>
  SONG_WITH_NAME.test(title) ||
  GENERIC_SONG_TITLE.test(title) ||
  /\bsong\b/i.test(title);

const songTitleFromItemTitle = (title: string): string | undefined => {
  const named = title.match(SONG_WITH_NAME);
  if (named?.[2]) return named[2].trim();
  if (looksLikeSongTitle(title)) return title.trim();
  return undefined;
};

const normalizeItemTitle = (title: string): string =>
  title.replace(/:+\s*$/, "").trim();

/** Section titles are short and not a dated service header line. */
const looksLikePrefixedSectionName = (line: string): boolean =>
  line.length > 0 && line.length <= 80 && !/\b20\d{2}\b/.test(line);

type DraftRow = {
  title: string;
  durationMinutes: number;
  assigneeLabels: string[];
  noteLines: string[];
  scriptureRaw?: string;
};

const flushDraft = (draft: DraftRow | null): EventData | null => {
  if (!draft) return null;
  const title = normalizeItemTitle(draft.title);
  const songTitle = songTitleFromItemTitle(title);
  const ledBy = draft.assigneeLabels.join(", ");
  const note = draft.noteLines.join("\n").trim();
  const scriptureRefs = (() => {
    if (!draft.scriptureRaw) return undefined;
    const parsed = parseBibleReference(`Scripture: ${draft.scriptureRaw}`);
    if (!parsed) return undefined;
    return [
      {
        label: getBibleImportDisplayName(parsed, parsed.version),
        book: parsed.book,
        chapter: parsed.chapter,
        verseRange: parsed.verseRange,
        version: parsed.version,
      },
    ];
  })();

  return {
    elementType: "",
    title,
    ledBy,
    ...(draft.assigneeLabels.length
      ? { assigneeNames: draft.assigneeLabels }
      : {}),
    durationMinutes: draft.durationMinutes,
    ...(note ? { note } : {}),
    ...(songTitle ? { songTitle } : {}),
    ...(scriptureRefs ? { scriptureRefs } : {}),
  };
};

/**
 * Convert Planning Center PDF / print text into import data.
 * Throws when no timed items can be recognized.
 */
export const parsePlanningCenterPdfText = (
  text: string,
): ServicePlanningImportData => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headerLines: string[] = [];
  const rows: EventData[] = [];
  let draft: DraftRow | null = null;
  let sectionName = "";
  let pendingTotal: number | null = null;
  let seenFirstItem = false;

  const pushDraft = () => {
    const row = flushDraft(draft);
    if (row) rows.push(row);
    draft = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (SKIP_LINE.test(line)) continue;

    const withTitle = line.match(DURATION_WITH_TITLE);
    if (withTitle) {
      pushDraft();
      pendingTotal = null;
      seenFirstItem = true;
      draft = {
        title: withTitle[3].trim(),
        durationMinutes: toDurationMinutes(withTitle[1], withTitle[2]),
        assigneeLabels: [],
        noteLines: [],
      };
      continue;
    }

    const onlyDuration = line.match(DURATION_ONLY);
    if (onlyDuration) {
      // A bare duration after items is the plan total; the next line may be a
      // section name on layouts that put it under the total.
      pushDraft();
      pendingTotal = toDurationMinutes(onlyDuration[1], onlyDuration[2]);
      continue;
    }

    if (pendingTotal !== null) {
      if (!sectionName) sectionName = line;
      pendingTotal = null;
      continue;
    }

    if (!seenFirstItem) {
      headerLines.push(line);
      continue;
    }

    if (!draft) {
      headerLines.push(line);
      continue;
    }

    const role = line.match(ROLE_LINE);
    if (role) {
      draft.assigneeLabels.push(`${role[1].trim()}: ${role[2].trim()}`);
      continue;
    }

    const scripture = line.match(SCRIPTURE_LINE);
    if (scripture) {
      draft.scriptureRaw = scripture[1].trim();
      continue;
    }

    draft.noteLines.push(line);
  }

  pushDraft();

  if (!rows.length) {
    throw new Error(
      "No Planning Center plan items found. Choose an order-of-service PDF from Planning Center.",
    );
  }

  // Real PDF text often places the section title just above the first item
  // (after Length / in mins), not under the trailing total.
  if (!sectionName && headerLines.length > 1) {
    const last = headerLines[headerLines.length - 1];
    if (looksLikePrefixedSectionName(last)) {
      sectionName = headerLines.pop() || "";
    }
  }

  const planLabel =
    headerLines.join(" — ").trim() || sectionName || "Planning Center plan";

  return {
    planLabel,
    sections: [
      {
        sectionName: sectionName || "Service",
        rows,
      },
    ],
    teamAssignments: [],
  };
};
