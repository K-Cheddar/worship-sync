/**
 * Converts a saved Teams `ServicePlan` back into the row shape the Service
 * Planning preview builder consumes, so the Controller can show (and sync from)
 * the plan the Services page owns instead of re-scraping a pasted URL.
 *
 * This is the inverse of servicePlanFromImport.ts and is deliberately lossless
 * for every field the preview actually reads: the import stores the raw source
 * strings (`sourceElementTypeRaw`, `sourceLedByRaw`) precisely so the overlay
 * and outline rules — which match on that free text, not on our derived enum —
 * behave identically whichever direction the plan arrived from.
 *
 * Elements edited or created by hand in the Services editor have no raw source
 * strings. Those fall back to the element's own title/type/assignment, which is
 * the best available signal and keeps operator-added items visible in the
 * Controller rather than silently dropping them.
 */
import type {
  EventData,
  ServicePlanningImportData,
} from "../../containers/Overlays/eventParser";
import {
  richTextToFormattedPlainText,
  richTextToPlainText,
} from "../../types/richText";
import type {
  ServicePlan,
  ServicePlanElement,
  ServicePlanSection,
} from "../../types/servicePlan";
import {
  getServicePlanElementAssigneeNames,
  getServicePlanElementScriptureRefs,
  getServicePlanElementSongRefs,
} from "../../types/servicePlan";

const elementToRow = (element: ServicePlanElement): EventData => {
  const title = richTextToPlainText(element.title).trim();
  const assigneeNames = getServicePlanElementAssigneeNames(element);
  const notes = element.notes
    ? richTextToFormattedPlainText(element.notes).trim()
    : "";
  const teamNotes = (element.teamNotes ?? [])
    .filter((teamNote) => teamNote.scope !== "role")
    .map((teamNote) => ({
      teamName: teamNote.label,
      note: richTextToFormattedPlainText(teamNote.note).trim(),
    }))
    .filter((teamNote) => Boolean(teamNote.teamName && teamNote.note));

  // durationSeconds is canonical; durationMinutes is the legacy mirror.
  const durationMinutes =
    typeof element.durationSeconds === "number"
      ? element.durationSeconds / 60
      : element.durationMinutes;

  // The song the plan settled on. A library ref is an answer the operator
  // already gave, so it travels as an id the preview can use directly rather
  // than a title it would have to guess from again.
  // The source-preview row model has one song slot. Use the first attachment
  // there; the Service Plan and live-outline push retain every attachment.
  const songRef = getServicePlanElementSongRefs(element)[0];
  const song = songRef
    ? songRef.kind === "library"
      ? { songId: songRef.songId, songTitle: songRef.songName }
      : { songTitle: songRef.title.trim() }
    : {};

  // Same principle as the song id: the operator already resolved which passages
  // these are, so they travel as parsed references rather than a title the
  // preview would have to recognize again — and a row titled "Sermon text" with
  // scripture attached is one the preview could never have recognized at all.
  // Read through the accessor so plans saved with a single legacy `scriptureRef`
  // travel identically to ones using the array.
  const scriptureRefs = getServicePlanElementScriptureRefs(element).map(
    ({ label, book, chapter, verseRange, version }) => ({
      label,
      book,
      chapter,
      verseRange,
      version,
    }),
  );

  return {
    elementType: element.sourceElementTypeRaw?.trim() || element.type,
    title,
    ledBy:
      element.sourceLedByRaw?.trim()
      || assigneeNames.join(", "),
    ...(assigneeNames.length ? { assigneeNames } : {}),
    ...(element.startTime ? { startTime: element.startTime } : {}),
    ...(typeof durationMinutes === "number" ? { durationMinutes } : {}),
    ...(notes ? { note: notes } : {}),
    ...(teamNotes.length ? { teamNotes } : {}),
    ...(song.songTitle ? song : {}),
    ...(scriptureRefs.length ? { scriptureRefs } : {}),
  };
};

const sectionToRows = (section: ServicePlanSection) => ({
  sectionName: section.name,
  rows: section.elements.map(elementToRow),
});

export const servicePlanToImportData = (
  plan: Pick<ServicePlan, "name" | "sections">,
): ServicePlanningImportData => ({
  planLabel: plan.name?.trim() || "Service plan",
  sections: plan.sections.map(sectionToRows),
  // A saved plan carries no scraped roster. The Controller supplies assignments
  // from the Teams schedule instead — see servicePlanTeamAssignments.ts.
  teamAssignments: [],
});
