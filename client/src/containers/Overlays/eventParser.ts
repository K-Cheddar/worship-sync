import { getApiBasePath } from "../../utils/environment";

export interface EventData {
  elementType: string;
  sourcePlanElementId?: string;
  /** Durable source row identity when an importer exposes one. */
  sourceOccurrenceId?: string;
  /**
   * Attached content title when the source exposes it separately from the
   * service moment. `title` remains the legacy source-column fallback.
   */
  contentTitle?: string;
  title: string;
  ledBy: string;
  /** Raw source Led By text when `ledBy` is reconstructed from assignees. */
  sourceLedByRaw?: string;
  /** Structured Planning Center assignments, when the API provides them. */
  ledByAssignments?: Array<{
    kind: "person" | "teamPosition";
    id?: string;
    name: string;
  }>;
  /**
   * The current structured assignees from a WorshipSync Service Plan. This is
   * display data only; `sourceLedByRaw` retains the original source text.
   */
  assigneeNames?: string[];
  /** 24-hour HH:mm schedule time when the printout provides one. */
  startTime?: string;
  /** Supports source durations such as 1m 30s without rounding them away. */
  durationMinutes?: number;
  /** Saved-plan content shown in the Controller preview. */
  contentResources?: Array<{
    id: string;
    type: string;
    title: string;
    url?: string;
    detail?: string;
  }>;
  /** Saved-plan microphone assignments, grouped by the person carrying them. */
  microphoneAssignments?: Array<{
    assigneeName?: string;
    microphoneIds: string[];
  }>;
  /** Shared/default note for everyone viewing the service. */
  note?: string;
  /** Notes from custom printout columns, scoped to their column heading. */
  teamNotes?: Array<{ teamName: string; note: string }>;
  /**
   * The song this row is for, taken from the source's own song marker rather
   * than guessed from wording. Absent both when the row isn't a song and when
   * the layout doesn't mark songs at all — see `getSongMarkerTitle`.
   */
  songTitle?: string;
  /**
   * The library song already linked to this row. Only set on rows built from a
   * saved ServicePlan, where an operator has resolved which song this is; a
   * scraped page has no such identity. Consumers must prefer it over matching
   * the title, or a resolved song gets re-guessed and can come out different.
   */
  songId?: string;
  songRefs?: Array<{ songTitle: string; songId?: string }>;
  /**
   * The scripture passages an operator attached to this row in the plan editor,
   * in reading order. Only set on rows built from a saved ServicePlan — a
   * scraped page carries nothing but the row title. Consumers must prefer these
   * over parsing the title, which may be a label ("Sermon text") rather than a
   * reference, and may stand for several passages at once.
   */
  scriptureRefs?: Array<{
    /** The label the plan editor shows, e.g. "Psalms 90:1-2 NLT". */
    label: string;
    book: string;
    chapter: string;
    verseRange: string;
    version: string;
  }>;
  /** Stable references attached to a saved Service Plan row. */
  customDocumentRefs?: Array<{ documentId: string; title: string }>;
}

type ParsedPlanningStartTime = {
  minuteOfDay: number;
  interpretation: "ambiguous" | "explicit" | "24-hour";
  ambiguousCandidates?: [number, number];
};

type ParsedEventData = EventData & {
  parsedPlanningStartTime?: ParsedPlanningStartTime;
};

export interface ServicePlanningSection {
  sectionName: string;
  rows: EventData[];
}

export interface ServicePlanningTeamAssignment {
  teamName: string;
  role: string;
  name: string;
}

export interface ServicePlanningImportData {
  planLabel: string;
  sourcePlanKey?: string;
  sections: ServicePlanningSection[];
  teamAssignments: ServicePlanningTeamAssignment[];
}

export const getNamesFromUrl = async (url: string): Promise<EventData[]> => {
  const response = await fetch(
    `${getApiBasePath()}api/getEventDetails?url=${encodeURIComponent(url)}`,
  );
  const textHtml = await response.text();

  return parseEventData(textHtml);
};

export const getSectionsFromUrl = async (
  url: string,
): Promise<ServicePlanningSection[]> => {
  const data = await getServicePlanningImportDataFromUrl(url);
  return data.sections;
};

export const getServicePlanningImportDataFromUrl = async (
  url: string,
): Promise<ServicePlanningImportData> => {
  const response = await fetch(
    `${getApiBasePath()}api/getEventDetails?url=${encodeURIComponent(url)}`,
  );
  const textHtml = await response.text();
  return parseServicePlanningImportFromHtml(textHtml);
};

/** Strip tags that trigger network loads on innerHTML parse (avoids CSP violations in Electron). */
const stripResourceTagsForLocalParse = (html: string) =>
  html
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<source\b[^>]*>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "");

const normalizeCellText = (text: string) =>
  text
    .replace(/\u00a0/g, " ")
    .replace(/[\t\n\r]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const getElementText = (element?: Element | null) =>
  normalizeCellText(
    element instanceof HTMLElement
      ? element.innerText
      : element?.textContent || "",
  );

/** Share links render an unassigned "Led By" as a styled placeholder where the
 * printout simply leaves the cell empty — neither should import as a name. */
const getLedByText = (element?: Element | null) => {
  if (!element) return "";
  const clone = element.cloneNode(true) as Element;
  clone
    .querySelectorAll("br")
    .forEach((lineBreak) => lineBreak.replaceWith(", "));
  const text = normalizeCellText(clone.textContent || "");
  return /^\[not specified\]$/i.test(text) ? "" : text;
};

const elementTextWithLineBreaks = (element?: Element | null): string => {
  if (!element) return "";
  if (!element.querySelector("br")) return element.textContent || "";
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach((lineBreak) => lineBreak.replaceWith("\n"));
  return clone.textContent || "";
};

/** Collapses runs of spaces and blank lines but keeps single line breaks. */
const normalizeNoteText = (text: string) =>
  text
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

/**
 * Notes keep the line breaks their author typed, unlike every other cell.
 * Two things get in the way: Service Planning writes a stored note into the
 * cell with its raw newlines intact — which `innerText` would collapse away,
 * because the printout itself renders them as one run-on line — while share
 * links use `<br>`. So this reads textContent, never innerText, after turning
 * any `<br>` into real newlines.
 */
const getNoteText = (element?: Element | null) =>
  normalizeNoteText(elementTextWithLineBreaks(element));

/** Service Planning prints a Font Awesome music icon beside a song. */
const SONG_MARKER_SELECTOR = ".fa-music";

const isSongMarkerNode = (node: Node): boolean =>
  node instanceof Element &&
  (node.classList.contains("fa-music") ||
    Boolean(node.querySelector(SONG_MARKER_SELECTOR)));

/**
 * The song a row is for, read from the marker the source prints itself:
 *
 *   <span class="fa fa-music"></span>&nbsp;<b>There's a Welcome Here</b> (C)
 *
 * Both the share link and the custom-columns printout mark songs this way, and
 * the song title is whatever follows the marker in that cell — so this also
 * separates the song from the element type printed above it ("Welcome Song").
 *
 * Returns undefined when the cell has no marker. That covers two different
 * cases on purpose, and callers have to tell them apart at the document level:
 * a row that isn't a song, and a layout that marks no songs at all.
 */
const getSongMarkerTitle = (cell?: Element | null): string | undefined => {
  const marker = cell?.querySelector(SONG_MARKER_SELECTOR);
  if (!marker) return undefined;

  let text = "";
  for (let node = marker.nextSibling; node; node = node.nextSibling) {
    // A medley cell can mark more than one song; stop at the next one so this
    // title doesn't run into it.
    if (isSongMarkerNode(node)) break;
    text += node.textContent || "";
  }
  return normalizeCellText(text) || undefined;
};

const getDirectTableCells = (row: Element) =>
  Array.from(row.children).filter((child) => child.tagName.toLowerCase() === "td");

const parsePlanningStartTime = (
  value: string,
): ParsedPlanningStartTime | undefined => {
  const match = normalizeCellText(value)
    .toLowerCase()
    .match(/^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\s*m?(?=\s|\(|$)/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const period = match[3];
  if (minutes > 59 || hours > (period ? 12 : 23) || (period && hours === 0)) {
    return undefined;
  }

  if (period) {
    const normalizedHours = (hours % 12) + (period === "p" ? 12 : 0);
    return {
      minuteOfDay: normalizedHours * 60 + minutes,
      interpretation: "explicit",
    };
  }

  if (hours === 0 || hours > 12) {
    return {
      minuteOfDay: hours * 60 + minutes,
      interpretation: "24-hour",
    };
  }

  const am = (hours % 12) * 60 + minutes;
  const pm = am + 12 * 60;
  // Keep the parser's existing default when there is no contextual evidence:
  // 12 defaults to noon, while 1–11 default to AM.
  const defaultMinute = hours === 12 ? pm : am;
  return {
    minuteOfDay: defaultMinute,
    interpretation: "ambiguous",
    ambiguousCandidates: [am, pm],
  };
};

const formatPlanningStartTime = (minuteOfDay: number): string => {
  const normalized = ((minuteOfDay % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const parsePlanningDurationMinutes = (value: string): number | undefined => {
  const normalized = normalizeCellText(value).toLowerCase();
  if (!normalized || normalized === "none") return undefined;
  const minutes = Number(normalized.match(/(\d+(?:\.\d+)?)\s*m/)?.[1] || 0);
  const seconds = Number(normalized.match(/(\d+(?:\.\d+)?)\s*s/)?.[1] || 0);
  const total = minutes + seconds / 60;
  return total > 0 ? total : undefined;
};

const getPlanningTimeFields = (value: string) => {
  const parsedPlanningStartTime = parsePlanningStartTime(value);
  const durationMinutes = parsePlanningDurationMinutes(value);
  return {
    ...(parsedPlanningStartTime ? { parsedPlanningStartTime } : {}),
    ...(durationMinutes ? { durationMinutes } : {}),
  };
};

const getExpectedElapsedMinutes = (
  rows: ParsedEventData[],
  fromRowIndex: number,
  toRowIndex: number,
): number | undefined => {
  if (fromRowIndex < 0 || toRowIndex <= fromRowIndex) return undefined;
  let total = 0;
  for (let index = fromRowIndex; index < toRowIndex; index += 1) {
    const duration = rows[index].durationMinutes;
    if (typeof duration !== "number") return undefined;
    total += duration;
  }
  return total;
};

const getNextOccurrence = (minuteOfDay: number, reference: number): number =>
  minuteOfDay + Math.max(0, Math.ceil((reference - minuteOfDay) / 1440)) * 1440;

const isDurationConsistent = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= Math.max(10, expected * 0.2);

const scoreTimeGap = (
  gap: number,
  expectedMinutes: number | undefined,
): number => {
  if (expectedMinutes !== undefined) {
    return isDurationConsistent(gap, expectedMinutes) ? 4 : -2;
  }
  // Without a duration, only a modest forward step is enough evidence to
  // select a meridiem. A long gap or a clock decrease alone is not.
  return gap <= 360 ? 2 : 0;
};

const getServiceStartTimeAnchor = (
  planLabel: string,
): ParsedPlanningStartTime | undefined => {
  const match = planLabel.match(/[-–—]\s*(.+)$/);
  // Ambiguous header values retain the same conservative default as row times.
  if (!match) return undefined;
  return parsePlanningStartTime(match[1]);
};

/** Resolve ambiguous source times over the whole plan while leaving every
 * explicit/24-hour value and every missing timestamp as supplied. */
const resolvePlanningStartTimes = (
  sections: Array<{ sectionName: string; rows: ParsedEventData[] }>,
  anchor?: ParsedPlanningStartTime,
): ServicePlanningSection[] => {
  const rows = sections.flatMap((section) => section.rows);
  let previousAbsoluteTime = anchor?.minuteOfDay;
  let previousTimedRowIndex = -1;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const parsed = row.parsedPlanningStartTime;
    if (!parsed) continue;

    if (parsed.interpretation !== "ambiguous") {
      const absoluteTime = previousAbsoluteTime === undefined
        ? parsed.minuteOfDay
        : getNextOccurrence(parsed.minuteOfDay, previousAbsoluteTime);
      previousAbsoluteTime = absoluteTime;
      previousTimedRowIndex = index;
      row.startTime = formatPlanningStartTime(parsed.minuteOfDay);
      continue;
    }

    const candidates = parsed.ambiguousCandidates || [
      parsed.minuteOfDay,
      parsed.minuteOfDay,
    ];
    const previousTime = previousAbsoluteTime;
    const candidateTimes = candidates.map((minuteOfDay) =>
      previousTime === undefined
        ? minuteOfDay
        : getNextOccurrence(minuteOfDay, previousTime),
    );
    const defaultCandidateIndex = candidates.findIndex(
      (candidate) => candidate === parsed.minuteOfDay,
    );
    let favoredIndex = defaultCandidateIndex;

    const supportedCandidates = new Set<number>();
    const addSupportedCandidate = (scores: number[]) => {
      if (
        scores[0] >= scores[1] + 2 &&
        scores[0] > 0
      ) {
        supportedCandidates.add(0);
      } else if (scores[1] >= scores[0] + 2 && scores[1] > 0) {
        supportedCandidates.add(1);
      }
    };

    if (previousTime !== undefined) {
      const expected = getExpectedElapsedMinutes(
        rows,
        previousTimedRowIndex,
        index,
      );
      addSupportedCandidate(
        candidateTimes.map((candidateTime) =>
          scoreTimeGap(candidateTime - previousTime, expected),
        ),
      );
    }

    const nextKnownIndex = rows.findIndex(
      (candidateRow, candidateIndex) =>
        candidateIndex > index &&
        candidateRow.parsedPlanningStartTime &&
        candidateRow.parsedPlanningStartTime.interpretation !== "ambiguous",
    );
    if (nextKnownIndex >= 0) {
      const nextKnownTime = rows[nextKnownIndex].parsedPlanningStartTime!;
      const expected = getExpectedElapsedMinutes(rows, index, nextKnownIndex);
      addSupportedCandidate(
        candidateTimes.map((candidateTime) => {
          const nextAbsoluteTime = getNextOccurrence(
            nextKnownTime.minuteOfDay,
            candidateTime,
          );
          return scoreTimeGap(nextAbsoluteTime - candidateTime, expected);
        }),
      );
    }

    // Conflicting evidence on the two sides leaves the original interpretation
    // intact instead of letting one signal silently override the other.
    if (supportedCandidates.size === 1) {
      const supportedIndex = Array.from(supportedCandidates)[0];
      if (supportedIndex !== defaultCandidateIndex) {
        favoredIndex = supportedIndex;
      }
    }
    const resolvedMinute = candidates[favoredIndex];
    const resolvedAbsoluteTime = candidateTimes[favoredIndex];

    row.startTime = formatPlanningStartTime(resolvedMinute);
    previousAbsoluteTime = resolvedAbsoluteTime;
    previousTimedRowIndex = index;
  }

  return sections.map(({ sectionName, rows: sectionRows }) => ({
    sectionName,
    rows: sectionRows.map(({ parsedPlanningStartTime: _parsed, ...row }) => row),
  }));
};

/**
 * Share-link (serviceFlow.cfm) rows keep their notes out of the visible row: a
 * collapsed detail panel holds free-text "General Notes:" plus a
 * "Specific Notes:" table of team → note pairs. The toggle row points at that
 * panel with `data-target` (older links only carry `data-id`, and some render
 * the panel as the next row with no id at all).
 */
const getAccordionDetailPanel = (
  root: ParentNode,
  toggleRow: Element,
): Element | null => {
  const target = toggleRow.getAttribute("data-target");
  const dataId = toggleRow.getAttribute("data-id");
  const selector = target?.startsWith("#")
    ? target
    : dataId
      ? `#collapse${dataId}`
      : "";
  if (selector) {
    try {
      const panel = root.querySelector(selector);
      if (panel) return panel;
    } catch {
      // A data-target that isn't a valid selector shouldn't throw the import.
    }
  }
  return toggleRow.nextElementSibling?.querySelector(".collapse") || null;
};

const parseAccordionDetailNotes = (panel: Element | null) => {
  if (!panel) return { note: undefined, teamNotes: [] };

  // The team-notes table is dropped first so its contents can't be mistaken for
  // the tail of the General Notes block.
  const withoutTeamNotes = panel.cloneNode(true) as Element;
  withoutTeamNotes.querySelectorAll("table").forEach((table) => table.remove());
  const note = normalizeNoteText(
    elementTextWithLineBreaks(withoutTeamNotes).match(
      /General Notes:([\s\S]*?)(?:Specific Notes:|$)/i,
    )?.[1] || "",
  );

  // Every assigned team gets a row here whether or not it was given a note, so
  // the empty ones are dropped rather than imported as blank team notes.
  const teamNotes = Array.from(
    panel.querySelector("table")?.querySelectorAll("tr") || [],
  )
    .map((row) => {
      const cells = row.querySelectorAll("td");
      return {
        teamName: getElementText(cells[0]),
        note: getNoteText(cells[1]),
      };
    })
    .filter((teamNote) => Boolean(teamNote.teamName && teamNote.note));

  return { note: note || undefined, teamNotes };
};

// Annotated rather than inferred: the spread timing fields infer as
// required-but-undefined, which isn't assignable to EventData's optional ones.
const buildAccordionRowEventData = (
  tds: NodeListOf<Element>,
  detailPanel: Element | null,
): ParsedEventData => {
  const middleCellLines = Array.from(tds[1].childNodes)
    .map((node) =>
      normalizeCellText(
        node.textContent || (node instanceof HTMLElement ? node.innerText : ""),
      ),
    )
    .filter(Boolean);

  const elementType = middleCellLines[0] ?? "";
  const title = middleCellLines
    .slice(1)
    .join(" ")
    .replace(/^-?\s*/, "")
    .trim();

  const timing = getPlanningTimeFields(getElementText(tds[0]));
  const { note, teamNotes } = parseAccordionDetailNotes(detailPanel);
  const songTitle = getSongMarkerTitle(tds[1]);
  return {
    elementType,
    title,
    ledBy: getLedByText(tds[2]),
    ...timing,
    ...(note ? { note } : {}),
    ...(teamNotes.length ? { teamNotes } : {}),
    ...(songTitle ? { songTitle } : {}),
  };
};

const buildWorshipFlowRowEventData = (tds: NodeListOf<Element>): ParsedEventData => {
  const songTitle = getSongMarkerTitle(tds[2]);
  return {
    elementType: getElementText(tds[1]),
    title: getElementText(tds[2]),
    ledBy: getLedByText(tds[3]),
    note: getNoteText(tds[4]) || undefined,
    ...getPlanningTimeFields(getElementText(tds[0])),
    ...(songTitle ? { songTitle } : {}),
  };
};

const getMainRowOptionalFields = (tds: NodeListOf<Element>) => {
  const parsedPlanningStartTime = parsePlanningStartTime(getElementText(tds[0]));
  const durationMinutes = parsePlanningDurationMinutes(getElementText(tds[1]));
  const note = getNoteText(tds[5]);
  const songTitle = getSongMarkerTitle(tds[3]);
  return {
    ...(parsedPlanningStartTime ? { parsedPlanningStartTime } : {}),
    ...(durationMinutes ? { durationMinutes } : {}),
    ...(note ? { note } : {}),
    ...(songTitle ? { songTitle } : {}),
  };
};

const parseEventData = (textHtml: string): EventData[] => {
  const el = document.createElement("html");
  el.innerHTML = stripResourceTagsForLocalParse(textHtml);
  const rows = parseServicePlanningImportFromHtml(textHtml).sections.flatMap(
    (section) => section.rows,
  );

  // Keep the Controller's legacy nested-assignment rows while sharing the
  // exact same source-time interpretation as Service Plan imports.
  if (
    !getCustomColumnsLayout(el) &&
    el.querySelectorAll("table.worship-flow-table tbody tr").length === 0
  ) {
    appendLegacyCollapsedAssignments(el, rows);
  }
  return rows;
};

export const parseSectionsFromHtml = (
  textHtml: string,
): ServicePlanningSection[] => {
  return parseServicePlanningImportFromHtml(textHtml).sections;
};

const parseTeamAssignments = (
  root: HTMLElement,
): ServicePlanningTeamAssignment[] => {
  const assignments: ServicePlanningTeamAssignment[] = [];
  const teamTables = root.querySelectorAll("#teams .teamContainer table");

  teamTables.forEach((table) => {
    const teamName = normalizeCellText(
      table.querySelector("tr th[colspan]")?.textContent || "",
    );
    if (!teamName) return;

    const rows = table.querySelectorAll("tr");
    rows.forEach((row, index) => {
      if (index === 0) return;
      const cells = row.querySelectorAll("td");
      if (cells.length < 3) return;

      const role = normalizeCellText(cells[0].textContent || "");
      const name = normalizeCellText(cells[2].textContent || "");
      if (!role || !name || /^\(no person\)$/i.test(name)) return;

      assignments.push({
        teamName,
        role,
        name,
      });
    });
  });

  return assignments;
};

type CustomColumnsLayout = {
  table: HTMLTableElement;
  startTimeIndex: number;
  durationIndex: number;
  elementTypeIndex: number;
  titleIndex: number;
  ledByIndex: number;
  noteIndex: number;
  teamColumns: Array<{ index: number; teamName: string }>;
};

const getCustomColumnsLayout = (root: HTMLElement): CustomColumnsLayout | null => {
  const table = Array.from(root.querySelectorAll("table")).find((candidate) => {
    const headers = Array.from(candidate.querySelectorAll("thead th")).map((header) =>
      getElementText(header).toLowerCase(),
    );
    return headers.includes("start time") &&
      headers.includes("duration") &&
      headers.includes("element type");
  });
  if (!(table instanceof HTMLTableElement)) return null;

  const headers = Array.from(table.querySelectorAll("thead th")).map(getElementText);
  const indexFor = (label: string) =>
    headers.findIndex((header) => header.toLowerCase() === label);
  const startTimeIndex = indexFor("start time");
  const durationIndex = indexFor("duration");
  const elementTypeIndex = indexFor("element type");
  const titleIndex = indexFor("title");
  const ledByIndex = indexFor("led by");
  const noteIndex = indexFor("note");
  if ([startTimeIndex, durationIndex, elementTypeIndex, titleIndex, ledByIndex, noteIndex].some((index) => index < 0)) {
    return null;
  }

  const reserved = new Set([
    startTimeIndex,
    durationIndex,
    elementTypeIndex,
    titleIndex,
    ledByIndex,
    noteIndex,
  ]);
  return {
    table,
    startTimeIndex,
    durationIndex,
    elementTypeIndex,
    titleIndex,
    ledByIndex,
    noteIndex,
    teamColumns: headers
      .map((teamName, index) => ({ index, teamName }))
      .filter(({ index, teamName }) => !reserved.has(index) && Boolean(teamName)),
  };
};

const buildCustomColumnsRowEventData = (
  cells: Element[],
  layout: CustomColumnsLayout,
): ParsedEventData => {
  const parsedPlanningStartTime = parsePlanningStartTime(
    getElementText(cells[layout.startTimeIndex]),
  );
  const durationMinutes = parsePlanningDurationMinutes(
    getElementText(cells[layout.durationIndex]),
  );
  const note = getNoteText(cells[layout.noteIndex]);
  const teamNotes = layout.teamColumns
    .map(({ index, teamName }) => ({ teamName, note: getNoteText(cells[index]) }))
    .filter((teamNote) => Boolean(teamNote.note));
  const songTitle = getSongMarkerTitle(cells[layout.titleIndex]);

  return {
    elementType: getElementText(cells[layout.elementTypeIndex]),
    title: getElementText(cells[layout.titleIndex]),
    ledBy: getLedByText(cells[layout.ledByIndex]),
    ...(parsedPlanningStartTime ? { parsedPlanningStartTime } : {}),
    ...(durationMinutes ? { durationMinutes } : {}),
    ...(note ? { note } : {}),
    ...(teamNotes.length ? { teamNotes } : {}),
    ...(songTitle ? { songTitle } : {}),
  };
};

const extractPlanLabel = (root: HTMLElement): string => {
  const dateHeader = root.querySelector(".service-info-table-printout th.left");
  const direct = getElementText(dateHeader);
  if (direct) return direct;

  const publicHeading = root.querySelector("#weekend-service h3");
  const publicLabel = getElementText(publicHeading);
  if (publicLabel) return publicLabel;

  const fullText = normalizeCellText(root.innerText || "");
  const match = fullText.match(
    /\b[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*-\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/,
  );
  return match?.[0] || "";
};

export const parseServicePlanningImportFromHtml = (
  textHtml: string,
): ServicePlanningImportData => {
  const el = document.createElement("html");
  el.innerHTML = stripResourceTagsForLocalParse(textHtml);

  const sections: Array<{ sectionName: string; rows: ParsedEventData[] }> = [];
  let current: { sectionName: string; rows: ParsedEventData[] } = {
    sectionName: "",
    rows: [],
  };

  const allRows = el.querySelectorAll("table tr");

  const isMainRow = (tr: Element) => tr.classList.contains("main-row");
  const isDividerRow = (tr: Element) =>
    Array.from(tr.classList).some(
      (c) => c === "divider" || c.startsWith("divider-"),
    );
  const isAccordionRow = (tr: Element) =>
    tr.classList.contains("accordion-toggle");
  const worshipFlowRows = el.querySelectorAll(
    "table.worship-flow-table tbody tr",
  );
  const customColumnsLayout = getCustomColumnsLayout(el);

  // Detect format: does the table have tr.main-row at all?
  const hasMainRows = el.querySelectorAll("tr.main-row").length > 0;

  if (customColumnsLayout) {
    for (const tr of Array.from(customColumnsLayout.table.querySelectorAll("tr"))) {
      if (isDividerRow(tr)) {
        if (current.rows.length > 0 || current.sectionName) {
          sections.push(current);
        }
        current = {
          sectionName: getElementText(tr),
          rows: [],
        };
        continue;
      }
      const cells = getDirectTableCells(tr);
      if (cells.length <= customColumnsLayout.noteIndex) continue;
      current.rows.push(buildCustomColumnsRowEventData(cells, customColumnsLayout));
    }
  } else if (hasMainRows) {
    for (const tr of Array.from(allRows)) {
      if (isDividerRow(tr)) {
        if (current.rows.length > 0 || current.sectionName) {
          sections.push(current);
        }
        current = {
          sectionName: getElementText(tr),
          rows: [],
        };
        continue;
      }
      if (!isMainRow(tr)) continue;
      const tds = tr.querySelectorAll("td");
      if (tds.length < 6) continue;
      current.rows.push({
        elementType: getElementText(tds[2]),
        title: getElementText(tds[3]),
        ledBy: getElementText(tds[4]),
        ...getMainRowOptionalFields(tds),
      });
    }
  } else if (el.querySelectorAll("tr.accordion-toggle").length > 0) {
    for (const tr of Array.from(allRows)) {
      if (isDividerRow(tr)) {
        if (current.rows.length > 0 || current.sectionName) {
          sections.push(current);
        }
        current = {
          sectionName: getElementText(tr),
          rows: [],
        };
        continue;
      }
      if (!isAccordionRow(tr)) continue;
      const tds = tr.querySelectorAll("td");
      if (tds.length !== 3) continue;
      current.rows.push(
        buildAccordionRowEventData(tds, getAccordionDetailPanel(el, tr)),
      );
    }
  } else if (worshipFlowRows.length > 0) {
    for (const tr of Array.from(worshipFlowRows)) {
      if (isDividerRow(tr)) {
        if (current.rows.length > 0 || current.sectionName) {
          sections.push(current);
        }
        current = {
          sectionName: getElementText(tr),
          rows: [],
        };
        continue;
      }
      const tds = tr.querySelectorAll("td");
      if (tds.length < 5) continue;
      current.rows.push(buildWorshipFlowRowEventData(tds));
    }
  } else {
    // Legacy 3-column format — no divider support, return single unnamed section
    for (const tr of Array.from(allRows)) {
      const tds = tr.querySelectorAll("td");
      if (tds.length !== 3) continue;
      current.rows.push({
        elementType: getElementText(tds[1]),
        title: "",
        ledBy: getElementText(tds[2]),
      });
    }
  }

  if (current.rows.length > 0 || current.sectionName) {
    sections.push(current);
  }

  const planLabel = extractPlanLabel(el);
  return {
    planLabel,
    sections: resolvePlanningStartTimes(
      sections,
      getServiceStartTimeAnchor(planLabel),
    ),
    teamAssignments: parseTeamAssignments(el),
  };
};

/** Older printouts: Host / Co-Host rows nested under a colspan row with `.collapse`. */
function appendLegacyCollapsedAssignments(
  root: HTMLElement,
  data: EventData[],
) {
  const rows = root.querySelectorAll("table tr");

  for (let i = 0; i < rows.length; i++) {
    const nextRow = rows[i + 1];
    if (!nextRow) continue;

    const nextTds = nextRow.querySelectorAll("td");
    if (nextTds.length !== 1 || !nextTds[0].hasAttribute("colspan")) continue;

    const collapsedContent = nextTds[0].querySelector(".collapse");
    if (!collapsedContent) continue;

    const nestedRows = collapsedContent.querySelectorAll("tbody tr");
    nestedRows.forEach((nestedRow) => {
      const nestedTds = nestedRow.querySelectorAll("td");
      if (nestedTds.length !== 2) return;

      const name = getElementText(nestedTds[0]);
      const role = getElementText(nestedTds[1]);

      if (
        name &&
        !name.includes("Coordinators") &&
        !name.includes("General Notes") &&
        !name.includes("Specific Notes") &&
        !role.includes("Lapels") &&
        !role.includes("Go Live")
      ) {
        data.push({
          elementType: role,
          title: "",
          ledBy: name,
        });
      }
    });
    i++;
  }
}
