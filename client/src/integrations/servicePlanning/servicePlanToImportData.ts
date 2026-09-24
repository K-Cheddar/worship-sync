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
  getServicePlanCustomDocumentId,
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

  const songRefs = getServicePlanElementSongRefs(element);

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
  const customDocumentRefs = (element.resources ?? [])
    .filter((resource) => resource.type === "custom-document")
    .map((resource) => ({
      documentId: getServicePlanCustomDocumentId(resource),
      title: resource.title,
    }))
    .filter((reference) => Boolean(reference.documentId));

  const contentTitle =
    element.sourceContentTitleRaw?.trim() ||
    (songRefs[0]
      ? songRefs[0].kind === "library"
        ? songRefs[0].songName.trim()
        : songRefs[0].title.trim()
      : scriptureRefs[0]?.label.trim()) ||
    customDocumentRefs[0]?.title.trim() ||
    "";
  const sourceLedByRaw = element.sourceLedByRaw?.trim() || "";

  const base: EventData = {
    elementType: element.sourceElementTypeRaw?.trim() || element.type,
    title,
    ledBy: assigneeNames.join(", ") || sourceLedByRaw,
    ...(assigneeNames.length ? { assigneeNames } : {}),
    ...(contentTitle ? { contentTitle } : {}),
    ...(sourceLedByRaw ? { sourceLedByRaw } : {}),
    ...(element.sourceLedByAssignments?.length
      ? { ledByAssignments: element.sourceLedByAssignments }
      : {}),
    ...(element.startTime ? { startTime: element.startTime } : {}),
    ...(typeof durationMinutes === "number" ? { durationMinutes } : {}),
    ...(notes ? { note: notes } : {}),
    ...(teamNotes.length ? { teamNotes } : {}),
    ...(scriptureRefs.length ? { scriptureRefs } : {}),
    ...(customDocumentRefs.length ? { customDocumentRefs } : {}),
  };
  const mappedSongs = songRefs.map((songRef) =>
    songRef.kind === "library"
      ? { songId: songRef.songId, songTitle: songRef.songName }
      : { songTitle: songRef.title.trim() },
  );
  return {
    ...base,
    ...(mappedSongs[0] || {}),
    ...(mappedSongs.length ? { songRefs: mappedSongs } : {}),
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
