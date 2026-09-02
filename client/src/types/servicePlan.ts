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
  /** One or more stable Teams position ids for a role-scoped note. */
  positionIds?: string[];
  /** Stable Teams team id. Required for newly created team notes. */
  teamId?: string;
  teamName?: string;
  /** Teams represented by the selected role audiences. */
  teamIds?: string[];
  teamNames?: string[];
};

/**
 * Upper bound on the church microphone catalog. Keep in sync with
 * `MAX_SERVICE_PLAN_MICROPHONES` in `server/teamsAuthHandlers.js`.
 */
export const MAX_SERVICE_PLAN_MICROPHONES = 80;

/** A church-owned microphone available to every dated service plan. */
export type ServicePlanMicrophone = {
  id: string;
  /** Short operator-facing identifier, e.g. "Orange" or "Choir left". */
  name: string;
  /** Physical style, e.g. handheld, headset, lapel, or choir mic. */
  type: string;
  /** A validated #RRGGBB swatch used to make live assignments easy to scan. */
  color: string;
};

/** A position that should receive an assigned microphone in its notes area. */
export type ServicePlanMicrophoneAudience = {
  positionId: string;
  roleName: string;
  teamId?: string;
  teamName?: string;
};

/**
 * @deprecated Superseded by microphones held on a `ServicePlanAssignee`. Read
 * only for plans saved before that change, and converted by
 * scripts/migrate-service-plan-assignees.js.
 */
export type ServicePlanMicrophoneAssignment = {
  microphoneId: string;
  /** Legacy per-element visibility. New assignments use the church-wide audience setting. */
  audiences?: ServicePlanMicrophoneAudience[];
};

/**
 * One person doing an item, and the microphones they carry for it.
 *
 * An assignee with no `name` and no `memberId` is the item's *unassigned*
 * slot: a stand or spare microphone that nobody is holding yet. That is a
 * state of this one list rather than a second parallel feature, so a mic
 * planned before its person is known simply gains a name later.
 */
export type ServicePlanAssignee = {
  id: string;
  /** Roster member id, when the assignment resolves to a real Teams member. */
  memberId?: string;
  /** Display name. Empty on the unassigned slot. */
  name?: string;
  /** Microphones this person carries for this item, in operator order. */
  microphoneIds?: string[];
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
  /**
   * @deprecated Microphones now hang off `assignees`. Read only for plans
   * saved before that change; see getServicePlanElementAssignees.
   */
  microphoneAssignments?: ServicePlanMicrophoneAssignment[];
  /** Plain HH:mm (24h) start time within the service, derived by the timing
   * cascade when a duration is set instead (see servicePlanTimingUtils.ts). */
  startTime?: string;
  /** Exact canonical duration used for schedule calculations and public live following. */
  durationSeconds?: number;
  /** Legacy compatibility value. New edits also write durationSeconds. */
  durationMinutes?: number;
  /** Legacy single song reference. Read for plans saved before multi-song support. */
  songRef?: ServicePlanSongReference;
  /** Songs that are sung during this element, in presentation order. */
  songRefs?: ServicePlanSongReference[];
  /** Legacy single scripture reference. Read for plans saved before multi-scripture support. */
  scriptureRef?: ServicePlanScriptureReference;
  /** Scripture passages read during this element, in presentation order. */
  scriptureRefs?: ServicePlanScriptureReference[];
  /** Everyone doing this item, and the microphones each of them carries. */
  assignees?: ServicePlanAssignee[];
  /**
   * @deprecated Superseded by `assignees`. Read only for plans saved before
   * multi-assignee support; see getServicePlanElementAssignees.
   */
  assignedMemberId?: string;
  /** @deprecated Superseded by `assignees`. */
  assignedName?: string;
  /** Team position this element maps to; scopes roster assignment suggestions. */
  positionId?: string;
  /** Team positions whose schedule slots should populate this item. */
  scheduledPositionIds?: string[];
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
  /** All outline items pushed from this element when it has multiple attachments. */
  pushedOutlineListIds?: string[];
};

/**
 * The element's kind, derived from what's attached to it. Operators don't pick
 * a type — they attach a song or a scripture (or neither) and the kind follows,
 * which is what the outline bridge and public projection read.
 */
export const getServicePlanElementType = (
  element: Pick<
    ServicePlanElement,
    "songRef" | "songRefs" | "scriptureRef" | "scriptureRefs" | "type"
  >,
): ServicePlanElementType => {
  if (getServicePlanElementSongRefs(element).length) return "song";
  if (getServicePlanElementScriptureRefs(element).length) return "bible";
  // Headings carry no attachment but are still structurally distinct, so an
  // existing heading keeps its kind rather than collapsing into "free".
  return element.type === "heading" ? "heading" : "free";
};

/** New plans use arrays; these retain read compatibility with older plans. */
export const getServicePlanElementSongRefs = (
  element: Pick<ServicePlanElement, "songRef" | "songRefs">,
): ServicePlanSongReference[] =>
  element.songRefs?.length
    ? element.songRefs
    : element.songRef
      ? [element.songRef]
      : [];

export const getServicePlanElementScriptureRefs = (
  element: Pick<ServicePlanElement, "scriptureRef" | "scriptureRefs">,
): ServicePlanScriptureReference[] =>
  element.scriptureRefs?.length
    ? element.scriptureRefs
    : element.scriptureRef
      ? [element.scriptureRef]
      : [];

/**
 * Every assignee on an element, in operator order.
 *
 * Stored plans are converted to `assignees` up front by
 * scripts/migrate-service-plan-assignees.js. This still folds the legacy
 * single-assignee and per-element microphone fields in as a read-time safety
 * net: a document the migration missed (written by an older client mid-deploy,
 * or skipped by a failed batch) would otherwise render with no assignee and
 * silently drop its microphone plan during a live service.
 *
 * Legacy microphones have no person attached, so they land on the unassigned
 * slot — exactly where a stand mic belongs.
 */
export const getServicePlanElementAssignees = (
  element: Pick<
    ServicePlanElement,
    "assignees" | "assignedName" | "assignedMemberId" | "microphoneAssignments"
  >,
): ServicePlanAssignee[] => {
  if (element.assignees) return element.assignees;

  const legacy: ServicePlanAssignee[] = [];
  const name = element.assignedName?.trim();
  if (name || element.assignedMemberId) {
    legacy.push({
      id: "legacy-assignee",
      ...(name ? { name } : {}),
      ...(element.assignedMemberId
        ? { memberId: element.assignedMemberId }
        : {}),
    });
  }
  const microphoneIds = (element.microphoneAssignments || [])
    .map((assignment) => assignment.microphoneId)
    .filter(Boolean);
  if (microphoneIds.length) {
    legacy.push({ id: "legacy-microphones", microphoneIds });
  }
  return legacy;
};

/** True for the unassigned slot: microphones with nobody holding them yet. */
export const isUnassignedServicePlanAssignee = (
  assignee: ServicePlanAssignee,
): boolean => !assignee.name?.trim() && !assignee.memberId;

/** Assignee display names only, skipping the unassigned slot. */
export const getServicePlanElementAssigneeNames = (
  element: Pick<
    ServicePlanElement,
    "assignees" | "assignedName" | "assignedMemberId" | "microphoneAssignments"
  >,
): string[] =>
  getServicePlanElementAssignees(element)
    .map((assignee) => assignee.name?.trim())
    .filter((name): name is string => Boolean(name));

/** The first named assignee is the presentation lead; microphone-only slots
 * remain in their original positions and do not affect lead order. */
export const getServicePlanElementLead = (
  element: Pick<
    ServicePlanElement,
    "assignees" | "assignedName" | "assignedMemberId" | "microphoneAssignments"
  >,
): ServicePlanAssignee | undefined =>
  getServicePlanElementAssignees(element).find(
    (assignee) => !isUnassignedServicePlanAssignee(assignee),
  );

/** New role notes use arrays; this retains old one-role notes. */
export const getServicePlanRoleNotePositionIds = (
  note: Pick<ServicePlanTeamNote, "positionId" | "positionIds">,
): string[] =>
  note.positionIds?.filter(Boolean) ??
  (note.positionId ? [note.positionId] : []);

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
  /** Incremented by the server on each save for conflict detection. */
  revision?: number;
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
  startsAt?: string;
  published?: boolean;
};
