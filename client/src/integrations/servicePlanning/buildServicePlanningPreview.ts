/**
 * Builds the Service Planning preview — the overlay plan, outline candidates,
 * and line items the Controller's import panel and floating window render.
 *
 * This is deliberately a pure function of its inputs rather than part of
 * `useServicePlanningImport`, because the same preview is now produced from two
 * sources: a freshly scraped planning URL, and a saved Teams `ServicePlan`
 * (see servicePlanToImportData.ts). Both funnel through here so the two paths
 * cannot drift in how they match overlays, songs, or scripture references.
 */
import type {
  EventData,
  ServicePlanningImportData,
} from "../../containers/Overlays/eventParser";
import {
  findBestMatchingElementRule,
  mapServicePlanningRows,
  type ServicePlanningMappedRow,
} from "./mapServicePlanningToOverlays";
import { findOverlayForServicePlanningCandidate } from "./findBestOverlayMatch";
import { findBestServicePlanningSongMatch } from "./findServicePlanningSongMatch";
import { cleanPlanningTitle } from "./cleanPlanningTitle";
import { parseBibleReference, type ParsedBibleRef } from "./parseBibleReference";
import { findParticipantTemplateForSync } from "./servicePlanningOverlayClone";
import { isOutlineCandidatePresentInList } from "../../utils/servicePlanningOutlineImport";
import type { OverlayInfo, ServiceItem } from "../../types";
import type { ServicePlanningConfig } from "../../types/integrations";
import type {
  OutlineItemCandidate,
  OverlaySyncPlanItem,
  ServicePlanningLineItem,
  ServicePlanningPreview,
  ServicePlanningTeamAssignment,
} from "../../types/servicePlanningImport";

const OVERLAY_PATCH_FIELDS = ["name", "title", "event"] as const;

/** Normalize an overlay event for exact-duplicate comparison. */
export const normalizeOverlayEvent = (event?: string): string =>
  (event || "").toLowerCase().replace(/\s+/g, " ").trim();

export const getChangedOverlayPatch = (
  overlay: OverlayInfo,
  patch: OverlaySyncPlanItem["patch"],
): OverlaySyncPlanItem["patch"] => {
  const changed: OverlaySyncPlanItem["patch"] = {};

  for (const field of OVERLAY_PATCH_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const currentValue = overlay[field] ?? "";
    const nextValue = patch[field] ?? "";
    if (currentValue !== nextValue) {
      changed[field] = patch[field];
    }
  }

  return changed;
};

const matchesSectionName = (
  sectionName: string,
  matchSectionName: string,
  matchMode: "contains" | "exact" | "normalize",
): boolean => {
  const a = sectionName.toLowerCase().replace(/\s+/g, " ").trim();
  const b = matchSectionName.toLowerCase().replace(/\s+/g, " ").trim();
  if (!b || !a) return false;
  if (matchMode === "exact") return a === b;
  if (matchMode === "normalize") {
    const na = a.replace(/[^a-z0-9 ]/g, "");
    const nb = b.replace(/[^a-z0-9 ]/g, "");
    return na.includes(nb) || nb.includes(na);
  }
  return a.includes(b) || b.includes(a);
};

export const dedupeOutlineCandidatesForPreview = (
  candidates: OutlineItemCandidate[],
): OutlineItemCandidate[] => {
  const seenSongKeys = new Set<string>();

  return candidates.filter((candidate) => {
    if (candidate.outlineItemType !== "song") {
      return true;
    }

    const dedupeKey = [
      candidate.headingName?.toLowerCase() || "__no_heading__",
      candidate.matchedLibraryItem?.name.toLowerCase() ||
        candidate.cleanedTitle.toLowerCase(),
    ].join("::");

    if (seenSongKeys.has(dedupeKey)) {
      return false;
    }

    seenSongKeys.add(dedupeKey);
    return true;
  });
};

export const getRepeatedOverlayDedupeKey = (
  block: Pick<ServicePlanningMappedRow, "rule">,
  candidate: Pick<OverlaySyncPlanItem, "patch">,
): string | null => {
  if (!block.rule.dedupeRepeatedOverlays) {
    return null;
  }

  return [
    block.rule.id,
    candidate.patch.name ?? "",
    candidate.patch.title ?? "",
    candidate.patch.event ?? "",
  ].join("::");
};

/**
 * Whether the overlay plan would actually change anything against the *current*
 * overlays list. Mirrors the execution-time idempotency in executeOverlaySyncStep
 * so a stale preview (e.g. plan built before overlays loaded) doesn't enable a
 * sync or count steps that would be no-ops. Returns true as soon as one plan item
 * would create, clone, or update an overlay.
 */
export const overlayPlanHasExecutableChange = (
  overlayPlan: OverlaySyncPlanItem[],
  overlays: OverlayInfo[],
): boolean => {
  const claimed = new Set<string>();
  for (const item of overlayPlan) {
    if (item.action === "skip") continue;

    if (item.action === "update") {
      const target = overlays.find((o) => o.id === item.targetOverlayId);
      if (target) {
        if (
          Object.keys(getChangedOverlayPatch(target, item.patch)).length > 0
        ) {
          return true;
        }
        claimed.add(target.id);
        continue;
      }
      // Target overlay is gone — fall through to the existence check below.
    }

    const targetEvent = normalizeOverlayEvent(item.patch.event);
    const existing = targetEvent
      ? overlays.find(
          (o) =>
            (o.type ?? "participant") === "participant" &&
            o.id !== item.targetOverlayId &&
            !claimed.has(o.id) &&
            normalizeOverlayEvent(o.event) === targetEvent,
        )
      : undefined;

    if (existing) {
      if (
        Object.keys(getChangedOverlayPatch(existing, item.patch)).length > 0
      ) {
        return true;
      }
      claimed.add(existing.id);
      continue;
    }

    // No existing overlay matches — this item will create/clone a new one.
    return true;
  }
  return false;
};

export type BuildServicePlanningPreviewInput = {
  importData: ServicePlanningImportData;
  servicePlanning: ServicePlanningConfig;
  /** Current overlays list, used to decide update vs clone vs create. */
  overlays: OverlayInfo[];
  /** Full library, used to match planning titles to song docs. */
  allItems: ServiceItem[];
  /** The live outline, used to flag rows already present. */
  activeOutlineList: ServiceItem[];
  /**
   * Overrides `importData.teamAssignments`. A plan-sourced preview has no
   * scraped assignments, so the Controller supplies them from the Teams
   * schedule instead.
   */
  teamAssignments?: ServicePlanningTeamAssignment[];
};

export const buildServicePlanningPreview = ({
  importData,
  servicePlanning: sp,
  overlays,
  allItems,
  activeOutlineList,
  teamAssignments,
}: BuildServicePlanningPreviewInput): ServicePlanningPreview => {
  const sections = importData.sections;
  const sectionNameByRow = new WeakMap<EventData, string>();
  const sectionRowIndexByRow = new WeakMap<EventData, number>();
  sections.forEach((section) => {
    section.rows.forEach((row, index) => {
      sectionNameByRow.set(row, section.sectionName);
      sectionRowIndexByRow.set(row, index);
    });
  });
  const allRows = sections.flatMap((s) => s.rows);
  const overlayCandidates = mapServicePlanningRows(allRows, sp);
  const previewUsedOverlayIds = new Set<string>();
  const repeatedOverlayKeys = new Set<string>();
  const overlayReadyByRow = new WeakMap<EventData, boolean>();
  const overlayPlan: OverlaySyncPlanItem[] = [];

  for (const block of overlayCandidates) {
    const allCandidatesResolvable = true;
    const sectionName = sectionNameByRow.get(block.source) ?? "";
    const sourceRowIndex = sectionRowIndexByRow.get(block.source) ?? -1;
    for (const candidate of block.candidates) {
      const repeatedOverlayKey = getRepeatedOverlayDedupeKey(block, candidate);
      if (repeatedOverlayKey && repeatedOverlayKeys.has(repeatedOverlayKey)) {
        overlayPlan.push({
          sectionName,
          sourceRowIndex,
          elementType: block.source.elementType,
          title: block.source.title,
          ledBy: block.source.ledBy,
          personIndex: candidate.personIndex,
          rawNameToken: candidate.rawNameToken,
          action: "skip",
          patch: { ...candidate.patch },
          reason:
            "An identical overlay for this rule is already planned earlier in the service.",
        });
        continue;
      }

      const target = findOverlayForServicePlanningCandidate(
        block.source.elementType,
        candidate.patch.event,
        overlays,
        previewUsedOverlayIds,
      );
      if (target) {
        previewUsedOverlayIds.add(target.id);
        const changedPatch = getChangedOverlayPatch(target, candidate.patch);
        const hasFieldChanges = Object.keys(changedPatch).length > 0;
        if (!hasFieldChanges) {
          overlayPlan.push({
            sectionName,
            sourceRowIndex,
            elementType: block.source.elementType,
            title: block.source.title,
            ledBy: block.source.ledBy,
            personIndex: candidate.personIndex,
            rawNameToken: candidate.rawNameToken,
            action: "update",
            placementOnly: true,
            targetOverlayId: target.id,
            targetOverlayName: target.name || undefined,
            targetOverlayEvent: target.event || undefined,
            patch: { ...candidate.patch },
            reason: "Existing overlay is already up to date.",
          });
          if (repeatedOverlayKey) {
            repeatedOverlayKeys.add(repeatedOverlayKey);
          }
          continue;
        }
        overlayPlan.push({
          sectionName,
          sourceRowIndex,
          elementType: block.source.elementType,
          title: block.source.title,
          ledBy: block.source.ledBy,
          personIndex: candidate.personIndex,
          rawNameToken: candidate.rawNameToken,
          action: "update",
          targetOverlayId: target.id,
          targetOverlayName: target.name || undefined,
          targetOverlayEvent: target.event || undefined,
          patch: changedPatch,
        });
        if (repeatedOverlayKey) {
          repeatedOverlayKeys.add(repeatedOverlayKey);
        }
        continue;
      }

      const template = findParticipantTemplateForSync(
        overlays,
        candidate.patch.event,
      );
      if (template) {
        overlayPlan.push({
          sectionName,
          sourceRowIndex,
          elementType: block.source.elementType,
          title: block.source.title,
          ledBy: block.source.ledBy,
          personIndex: candidate.personIndex,
          rawNameToken: candidate.rawNameToken,
          action: "clone",
          targetOverlayId: template.id,
          targetOverlayName: template.name || undefined,
          targetOverlayEvent: template.event || undefined,
          patch: { ...candidate.patch },
        });
        if (repeatedOverlayKey) {
          repeatedOverlayKeys.add(repeatedOverlayKey);
        }
        continue;
      }

      overlayPlan.push({
        sectionName,
        sourceRowIndex,
        elementType: block.source.elementType,
        title: block.source.title,
        ledBy: block.source.ledBy,
        personIndex: candidate.personIndex,
        rawNameToken: candidate.rawNameToken,
        action: "create",
        patch: { ...candidate.patch },
        reason: `Create overlay for "${candidate.patch.event || block.source.elementType}"`,
      });
      if (repeatedOverlayKey) {
        repeatedOverlayKeys.add(repeatedOverlayKey);
      }
    }

    overlayReadyByRow.set(block.source, allCandidatesResolvable);
  }

  const songs = allItems.filter((item) => item.type === "song");
  const outlineCandidates: OutlineItemCandidate[] = [];
  const lineItems: ServicePlanningLineItem[] = [];

  for (const section of sections) {
    const sectionRule = sp.sectionRules.find((r) =>
      matchesSectionName(section.sectionName, r.matchSectionName, r.matchMode),
    );
    const headingName = sectionRule?.headingName ?? null;

    for (const [sourceRowIndex, row] of section.rows.entries()) {
      const elementRule = findBestMatchingElementRule(
        row.elementType,
        sp.elementRules,
        {
          filter: (rule) => rule.outlineSync?.enabled ?? false,
        },
      );
      // Scripture the operator attached in the plan editor is an explicit
      // answer, so it makes the row a Bible row on its own — the element rules
      // match the source's free-text element type, which a hand-added element
      // ("bible") was never going to satisfy. Only plan-sourced rows carry any.
      const attachedScriptureRefs = row.scriptureRefs ?? [];
      const outlineItemType = attachedScriptureRefs.length
        ? "bible"
        : elementRule?.outlineSync?.itemType ?? "none";
      let matchedLibraryItem: ServiceItem | null = null;
      let parsedRefs: ParsedBibleRef[] = [];
      // A plan-sourced row names its song directly; a scraped one only has the
      // row title, which can also carry the element type or a second line.
      const cleanedTitle = cleanPlanningTitle(
        row.songTitle || row.title || row.elementType,
      );

      if (outlineItemType === "song") {
        // A song the operator already linked in the plan is settled. Matching
        // the title again could land on a different song, and this row is on
        // its way into the live outline.
        matchedLibraryItem =
          (row.songId ? songs.find((song) => song._id === row.songId) : null) ??
          findBestServicePlanningSongMatch(cleanedTitle, songs);
      } else if (outlineItemType === "bible") {
        const parsedTitleRef = attachedScriptureRefs.length
          ? null
          : parseBibleReference(row.title);
        parsedRefs = attachedScriptureRefs.length
          ? attachedScriptureRefs.map(({ book, chapter, verseRange, version }) => ({
              book,
              chapter,
              verseRange,
              version,
            }))
          : parsedTitleRef
            ? [parsedTitleRef]
            : [];
      }

      const baseCandidate = {
        sectionName: section.sectionName,
        headingName,
        sourceRowIndex,
        elementType: row.elementType,
        title: row.title,
        cleanedTitle,
        ledBy: row.ledBy,
        outlineItemType,
        matchedLibraryItem,
        // One row, one line item: the preview mirrors the source order of
        // service, so a multi-passage row still shows as the single row it is.
        parsedRef: parsedRefs[0] ?? null,
        overlayReady: overlayReadyByRow.get(row) ?? false,
        outlineAlreadyPresent: false,
      };

      const syncsToOutline =
        attachedScriptureRefs.length > 0 ||
        (Boolean(elementRule?.outlineSync) && outlineItemType !== "none");

      lineItems.push({
        ...baseCandidate,
        selectedForOutline: syncsToOutline,
      });

      if (!syncsToOutline) continue;

      if (!attachedScriptureRefs.length) {
        outlineCandidates.push({ ...baseCandidate, cleanedTitle });
        continue;
      }

      // Every attached passage becomes its own outline item, named by the
      // passage rather than the row. Sharing the row's title would make them
      // indistinguishable, and the outline's already-present check — which
      // compares item names — would drop all but the first.
      attachedScriptureRefs.forEach((attached, attachedIndex) => {
        const passageTitle = attached.label.trim();
        outlineCandidates.push({
          ...baseCandidate,
          title: passageTitle || row.title,
          cleanedTitle: passageTitle || cleanedTitle,
          parsedRef: parsedRefs[attachedIndex],
        });
      });
    }
  }

  const dedupedOutlineCandidates = dedupeOutlineCandidatesForPreview(
    outlineCandidates,
  ).map((candidate) => ({
    ...candidate,
    outlineAlreadyPresent: candidate.headingName
      ? isOutlineCandidatePresentInList(
          activeOutlineList,
          candidate.headingName,
          candidate,
        )
      : false,
  }));

  return {
    overlayCandidates,
    overlayPlan,
    outlineCandidates: dedupedOutlineCandidates,
    lineItems: lineItems.map((item) => {
      if (!item.selectedForOutline || !item.headingName) {
        return item;
      }

      // A multi-passage row fans out into several candidates whose titles are
      // the passages, not the row, so they're located by source position. The
      // row only reads as already present once every one of them is.
      const rowCandidates = dedupedOutlineCandidates.filter(
        (candidate) =>
          candidate.sectionName === item.sectionName &&
          candidate.headingName === item.headingName &&
          candidate.sourceRowIndex === item.sourceRowIndex &&
          candidate.elementType === item.elementType &&
          candidate.outlineItemType === item.outlineItemType,
      );

      return rowCandidates.length
        ? {
            ...item,
            outlineAlreadyPresent: rowCandidates.every(
              (candidate) => candidate.outlineAlreadyPresent,
            ),
          }
        : item;
    }),
    teamAssignments: teamAssignments ?? importData.teamAssignments,
  };
};
