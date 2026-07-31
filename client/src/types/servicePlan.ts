/**
 * ServicePlan: the per-occurrence order-of-service content plan — build it from
 * scratch or seed it from a Service Planning import, then edit every element
 * freely. This is a separate planning document from the live PouchDB outline
 * (ItemListDetails); it gets explicitly pushed into that outline when ready
 * (see servicePlanOutlineBridge.ts). It is also separate from ServiceTime (the
 * recurring day/time/positions definition edited in Teams' Services domain,
 * "Service settings" section).
 *
 * Persisted in Firestore (COLLECTIONS.servicePlans), REST + SSE, mirroring the
 * TeamSchedule pattern — see server/teamsAuthHandlers.js and
 * client/src/api/auth.ts (getServicePlan/saveServicePlan/deleteServicePlan).
 */
import type { RichTextDocument } from "./richText";

// Mirrors ServiceItem.type (client/src/types.ts) minus the presentation-only
// "timer"/"service-time" kinds, so pushing a plan into the outline is 1:1.
export type ServicePlanElementType =
  | "song"
  | "video"
  | "image"
  | "bible"
  | "announcement"
  | "free"
  | "heading";

/** A note scoped to one team/role (e.g. Band, Coordinators, Media) rather than
 * shown to everyone — the label is free text, not a real Teams team id, since
 * an element may need notes for a team that has no roster record at all. */
/** Audience for an operational note attached to a service-plan element. */
export type ServicePlanNoteScope = "team" | "role";

/**
 * A note intended for one team or one role. Team notes created before role
 * notes existed have no scope and are treated as team notes for compatibility.
 */
export type ServicePlanTeamNote = {
  id: string;
  label: string;
  note: RichTextDocument;
  scope?: ServicePlanNoteScope;
  /** Stable Teams position id for a role-scoped note. */
  positionId?: string;
  /** Team identity is stored with role notes to make role filtering practical. */
  teamId?: string;
  teamName?: string;
};

/**
 * Either a link to a real song already in the presentation-controller library,
 * or a not-yet-created song captured as raw lyrics text. The "pending" case
 * defers actual song-doc creation to the operator (reusing the existing
 * lyrics-paste-to-song pipeline in client/src/utils/itemUtil.ts) but keeps the
 * lyrics attached to the plan now so nothing is lost waiting on that step.
 */
export type ServicePlanSongReference =
  | { kind: "library"; songId: string; songName: string }
  | { kind: "pending"; title: string; lyricsText: string };

/**
 * A scripture passage attached to an element. Stored as a parsed reference
 * rather than fetched verse text: the actual Bible item is created from it at
 * push-to-outline time (the same `createBibleItemFromParsedReference` pipeline
 * the Controller's import uses), so the plan stays a light planning document.
 */
export type ServicePlanScriptureReference = {
  /** Display label, e.g. "John 3:16-18 (NIV)". */
  label: string;
  book: string;
  chapter: string;
  verseRange: string;
  version: string;
};

export type ServicePlanElement = {
  id: string;
  /** Internal provenance flag used to safely reconcile later Service Planning
   * refreshes without treating operator-created items as source items. */
  sourcePlanningManaged?: boolean;
  /**
   * Derived, not operator-chosen: an element is just a titled item, and its
   * kind follows from what's attached to it (song → "song", scripture →
   * "bible", otherwise "free"). Kept on the document because the outline
   * bridge and the Service Planning import both key off it. Use
   * `getServicePlanElementType` rather than setting this by hand.
   */
  type: ServicePlanElementType;
  title: RichTextDocument;
  notes?: RichTextDocument;
  /** Operational notes scoped to a team or specific role. */
  teamNotes?: ServicePlanTeamNote[];
  /** Plain HH:mm (24h) start time within the service, derived by the timing
   * cascade when a duration is set instead (see servicePlanTimingUtils.ts). */
  startTime?: string;
  /** Exact canonical duration used for schedule calculations and public live following. */
  durationSeconds?: number;
  /** Legacy compatibility value. New edits also write durationSeconds. */
  durationMinutes?: number;
  /** Reference to the song being sung, if this is (or plays alongside) a song. */
  songRef?: ServicePlanSongReference;
  /** Scripture passage read during this element, if any. */
  scriptureRef?: ServicePlanScriptureReference;
  /** Roster member id, when the assignment resolves to a real Teams member. */
  assignedMemberId?: string;
  /** Free-text assignment (guest, or an unresolved Service Planning "led by" name). */
  assignedName?: string;
  /** Team position this element maps to; scopes roster assignment suggestions. */
  positionId?: string;
  /** Raw scraped "led by" text, kept for traceability and re-import diffing. */
  sourceLedByRaw?: string;
  /**
   * Raw scraped element-type text (e.g. "Scripture Reading", "Worship Set").
   * The source column is free text, and `type` above is a lossy derived enum,
   * so the original string is kept: the Controller's overlay rules match on it
   * (`matchElementType`), and without it a plan-sourced preview would stop
   * matching overlays that a URL-sourced one matches. Absent on
   * operator-created elements and on plans imported before this was stored.
   */
  sourceElementTypeRaw?: string;
  /** Set once this element has been pushed into the live outline, so a re-push
   * can detect it's already present instead of duplicating it. */
  pushedOutlineListId?: string;
};

/**
 * The element's kind, derived from what's attached to it. Operators don't pick
 * a type — they attach a song or a scripture (or neither) and the kind follows,
 * which is what the outline bridge and public projection read.
 */
export const getServicePlanElementType = (
  element: Pick<ServicePlanElement, "songRef" | "scriptureRef" | "type">,
): ServicePlanElementType => {
  if (element.songRef) return "song";
  if (element.scriptureRef) return "bible";
  // Headings carry no attachment but are still structurally distinct, so an
  // existing heading keeps its kind rather than collapsing into "free".
  return element.type === "heading" ? "heading" : "free";
};

export type ServicePlanSection = {
  id: string;
  /** See ServicePlanElement.sourcePlanningManaged. */
  sourcePlanningManaged?: boolean;
  name: string;
  elements: ServicePlanElement[];
};

/**
 * A reusable order-of-service skeleton. Holds structure only — section and
 * item names, timings, notes — with the per-week specifics (song/scripture
 * picks, who's assigned, outline-push pointers) deliberately stripped, since
 * those belong to one dated service rather than to the pattern.
 *
 * Optionally scoped to one service, so a church can keep e.g. a "Standard
 * Sabbath" alongside a "Communion Sunday" and a general-purpose one.
 */
export type ServicePlanTemplate = {
  templateId: string;
  churchId: string;
  name: string;
  /** When set, the template is offered for this service first. */
  serviceId?: string;
  sections: ServicePlanSection[];
  createdAt?: string;
  updatedAt?: string;
};

export type ServicePlanTemplatePayload = {
  name: string;
  serviceId?: string;
  sections: ServicePlanSection[];
};

export type ServicePlanSourceImport = {
  source: "servicePlanning";
  sourceUrl: string;
  loadedAt: string;
  planLabel: string;
};

export type ServicePlan = {
  planId: string;
  churchId: string;
  /** Deterministic key: see servicePlanKeys.ts. Not the TeamSchedule-owned occurrenceId. */
  planKey: string;
  serviceId: string;
  /** Every service this occurrence covers (one for ungrouped, many for a combined group). */
  serviceIds?: string[];
  /** Set only for a combined/grouped occurrence (shared serviceGroupId). */
  groupId?: string;
  /** Plain YYYY-MM-DD date of the occurrence. */
  date: string;
  name: string;
  /** Exact service occurrence time used by the public timeline. */
  startsAt?: string;
  /** IANA timezone used when formatting this service for public viewers. */
  timezone?: string;
  sections: ServicePlanSection[];
  /** Public visibility is explicit; unlisted plans remain private. */
  published?: boolean;
  /**
   * The service-day timeline. `manual` is retained for plans written before
   * timeline re-anchoring; new Make live actions use `anchored` so following
   * items continue automatically from the selected item's server start time.
   */
  publicLive?:
    | { mode: "schedule" }
    | { mode: "manual"; currentElementId: string }
    | { mode: "anchored"; currentElementId: string; startedAt: string };
  sourceImport?: ServicePlanSourceImport;
  /** planKey of the template plan this was generated from, if any (traceability only). */
  clonedFromPlanKey?: string;
  pushedToOutlineAt?: string | null;
  /** Incremented by the server on each content save for conflict detection. */
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type ServicePlanPayload = {
  serviceId: string;
  serviceIds?: string[];
  groupId?: string;
  date: string;
  name: string;
  startsAt?: string;
  timezone?: string;
  sections: ServicePlanSection[];
  sourceImport?: ServicePlanSourceImport;
  clonedFromPlanKey?: string;
  /** Revision this complete-document save was based on; never persisted. */
  baseRevision?: number;
};

/** Lightweight projection for the Plans list view — enough to show "does this
 * date already have a plan" without fetching every plan's full content. */
export type ServicePlanSummary = {
  planKey: string;
  serviceId: string;
  serviceIds?: string[];
  groupId?: string;
  date: string;
  name: string;
  published?: boolean;
};
