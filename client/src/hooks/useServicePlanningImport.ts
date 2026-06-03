import { useCallback, useContext } from "react";
import { useStore } from "react-redux";
import { useDispatch, useSelector } from "../hooks";
import {
  getServicePlanningImportDataFromUrl,
  type EventData,
} from "../containers/Overlays/eventParser";
import {
  findBestMatchingElementRule,
  mapServicePlanningRows,
  type ServicePlanningMappedRow,
} from "../integrations/servicePlanning/mapServicePlanningToOverlays";
import { findOverlayForServicePlanningCandidate } from "../integrations/servicePlanning/findBestOverlayMatch";
import { findBestServicePlanningSongMatch } from "../integrations/servicePlanning/findServicePlanningSongMatch";
import { cleanPlanningTitle } from "../integrations/servicePlanning/cleanPlanningTitle";
import {
  parseBibleReference,
  type ParsedBibleRef,
} from "../integrations/servicePlanning/parseBibleReference";
import { GlobalInfoContext } from "../context/globalInfo";
import { ControllerInfoContext } from "../context/controllerInfo";
import {
  markOverlayPersisted,
  selectOverlay,
  setHasPendingUpdate as setOverlayHasPendingUpdate,
} from "../store/overlaySlice";
import {
  addExistingOverlayToList,
  updateOverlayInList,
} from "../store/overlaysSlice";
import { addItemToAllItemsList } from "../store/allItemsSlice";
import {
  buildClonedParticipantOverlay,
  buildNewParticipantOverlay,
  findParticipantTemplateForSync,
  persistNewParticipantOverlay,
  persistNewParticipantOverlayClone,
} from "../integrations/servicePlanning/servicePlanningOverlayClone";
import generateRandomId from "../utils/generateRandomId";
import { setActiveItemInList, updateItemList } from "../store/itemListSlice";
import type { OverlayInfo, ServiceItem } from "../types";
import type { RootState } from "../store/store";
import type {
  OutlineItemCandidate,
  OverlaySyncPlanItem,
  ServicePlanningLineItem,
  ServicePlanningPreview,
} from "../types/servicePlanningImport";
import type { ServiceOutline } from "../types/importedPlan";
import {
  executeServicePlanningOutlineSyncStep as executeOutlineSyncUtilityStep,
  insertServicePlanningOutlineCandidates,
  isOutlineCandidatePresentInList,
  planServicePlanningOutlineSyncSteps,
  type ServicePlanningOutlineSyncStep,
} from "../utils/servicePlanningOutlineImport";
import { persistExistingOverlayDoc } from "../utils/persistOverlayDoc";
import { getBibleImportDisplayName } from "../utils/servicePlanningBibleImport";
import type { ServicePlanningSyncItem } from "../store/servicePlanningImportSlice";
import { normalizeOverlayForSync } from "../utils/overlayUtils";
import {
  getOutlineCandidateLineItemKey,
  getOverlayPlanLineItemKey,
} from "../utils/servicePlanningSyncKeys";
import { persistItemListServiceOutline } from "../utils/itemListImports";

export type ServicePlanningImportOptions = {
  overlays: boolean;
  outline: boolean;
};

export type ServicePlanningImportResult = {
  overlaysUpdated: number;
  overlaysSkipped: number;
  outlineInserted: number;
  reasons: string[];
};

export type ExecutableOverlaySyncPlanItem = OverlaySyncPlanItem & {
  action: "update" | "clone" | "create";
};

export type ServicePlanningOverlayStepExecutionResult = {
  overlaysUpdated: number;
  overlaysCloned: number;
  overlaysCreated: number;
  overlaysSkipped: number;
  reasons: string[];
  /**
   * Id of the overlay this step ended up touching (updated/cloned/created), or
   * undefined when nothing resolved. The runner threads this forward as the
   * insertion anchor for the next step so newly synced overlays land in plan
   * order instead of after their template (clones) or at the end (creates).
   */
  resultOverlayId?: string;
};

const SERVICE_PLANNING_DISABLED_MESSAGE =
  "Service Planning is off. Ask an admin to enable it in Account > Integrations.";
const SERVICE_PLANNING_LOADING_MESSAGE =
  "Integrations are still loading. Try again in a moment.";
const OVERLAY_SELECTION_SCROLL_DELAY_MS = 500;

const OVERLAY_PATCH_FIELDS = ["name", "title", "event"] as const;

/** Normalize an overlay event for exact-duplicate comparison. */
const normalizeOverlayEvent = (event?: string): string =>
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
        if (Object.keys(getChangedOverlayPatch(target, item.patch)).length > 0) {
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
      if (Object.keys(getChangedOverlayPatch(existing, item.patch)).length > 0) {
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

const isSyncableOutlineCandidate = (candidate: OutlineItemCandidate): boolean =>
  !candidate.outlineAlreadyPresent &&
  (
    (candidate.outlineItemType === "song" &&
      Boolean(candidate.matchedLibraryItem)) ||
    (candidate.outlineItemType === "bible" && Boolean(candidate.parsedRef))
  );

export const useServicePlanningImport = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { db, bibleDb } = useContext(ControllerInfoContext) || {};
  const { churchIntegrations, churchIntegrationsStatus } =
    useContext(GlobalInfoContext) || {};
  const allItems = useSelector((s: RootState) => s.allItems.list);
  const selectedItemList = useSelector(
    (s: RootState) =>
      s.undoable.present.itemLists.selectedList ??
      s.undoable.present.itemLists.activeList,
  );
  const {
    defaultBibleBackground,
    defaultBibleBackgroundBrightness,
    defaultBibleFontMode,
  } = useSelector((s: RootState) => s.undoable.present.preferences.preferences);
  const isServicePlanningEnabled =
    churchIntegrationsStatus === "ready" &&
    Boolean(churchIntegrations?.servicePlanning.enabled);
  const servicePlanningAvailabilityMessage =
    churchIntegrationsStatus !== "ready"
      ? SERVICE_PLANNING_LOADING_MESSAGE
      : isServicePlanningEnabled
        ? null
        : SERVICE_PLANNING_DISABLED_MESSAGE;

  const loadPreview = useCallback(
    async (url: string): Promise<ServiceOutline> => {
      if (churchIntegrationsStatus !== "ready" || !churchIntegrations) {
        throw new Error(SERVICE_PLANNING_LOADING_MESSAGE);
      }
      const sp = churchIntegrations.servicePlanning;
      if (!sp.enabled) {
        throw new Error(SERVICE_PLANNING_DISABLED_MESSAGE);
      }

      const importData = await getServicePlanningImportDataFromUrl(url);
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
      const previewOverlays = store.getState().undoable.present.overlays.list;
      const previewUsedOverlayIds = new Set<string>();
      const repeatedOverlayKeys = new Set<string>();
      const overlayReadyByRow = new WeakMap<EventData, boolean>();
      const overlayPlan: OverlaySyncPlanItem[] = [];

      for (const block of overlayCandidates) {
        let allCandidatesResolvable = true;
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
              reason: "An identical overlay for this rule is already planned earlier in the service.",
            });
            continue;
          }

          const target = findOverlayForServicePlanningCandidate(
            block.source.elementType,
            candidate.patch.event,
            previewOverlays,
            previewUsedOverlayIds,
          );
          if (target) {
            previewUsedOverlayIds.add(target.id);
            const changedPatch = getChangedOverlayPatch(
              target,
              candidate.patch,
            );
            if (Object.keys(changedPatch).length === 0) {
              overlayPlan.push({
                sectionName,
                sourceRowIndex,
                elementType: block.source.elementType,
                title: block.source.title,
                ledBy: block.source.ledBy,
                personIndex: candidate.personIndex,
                rawNameToken: candidate.rawNameToken,
                action: "skip",
                targetOverlayId: target.id,
                targetOverlayName: target.name || undefined,
                targetOverlayEvent: target.event || undefined,
                patch: { ...candidate.patch },
                reason: `Overlay for "${candidate.patch.event || block.source.elementType}" is already up to date.`,
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
            previewOverlays,
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
          matchesSectionName(
            section.sectionName,
            r.matchSectionName,
            r.matchMode,
          ),
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
          const outlineItemType =
            elementRule?.outlineSync?.itemType ?? "none";
          let matchedLibraryItem: ServiceItem | null = null;
          let parsedRef: ParsedBibleRef | null = null;
          const cleanedTitle = cleanPlanningTitle(row.title || row.elementType);

          if (outlineItemType === "song") {
            matchedLibraryItem = findBestServicePlanningSongMatch(
              cleanedTitle,
              songs,
            );
          } else if (outlineItemType === "bible") {
            parsedRef = parseBibleReference(row.title);
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
            parsedRef,
            overlayReady: overlayReadyByRow.get(row) ?? false,
            outlineAlreadyPresent: false,
          };

          lineItems.push({
            ...baseCandidate,
            selectedForOutline:
              Boolean(elementRule?.outlineSync) && outlineItemType !== "none",
          });

          if (
            !elementRule?.outlineSync ||
            elementRule.outlineSync.itemType === "none"
          ) {
            continue;
          }

          outlineCandidates.push({
            ...baseCandidate,
            cleanedTitle,
          });
        }
      }

      const activeOutlineList = store.getState().undoable.present.itemList.list;
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

      const preview: ServicePlanningPreview = {
        overlayCandidates,
        overlayPlan,
        outlineCandidates: dedupedOutlineCandidates,
        lineItems: lineItems.map((item) => {
          if (!item.selectedForOutline || !item.headingName) {
            return item;
          }

          const matchingOutlineCandidate = dedupedOutlineCandidates.find(
            (candidate) =>
              candidate.sectionName === item.sectionName &&
              candidate.headingName === item.headingName &&
              candidate.elementType === item.elementType &&
              candidate.title === item.title &&
              candidate.outlineItemType === item.outlineItemType,
          );

          return matchingOutlineCandidate
            ? {
                ...item,
                outlineAlreadyPresent:
                  matchingOutlineCandidate.outlineAlreadyPresent,
              }
            : item;
        }),
        teamAssignments: importData.teamAssignments,
      };

      const serviceOutline: ServiceOutline = {
        source: "servicePlanning",
        loadedAt: new Date().toISOString(),
        sourceUrl: url,
        planLabel: importData.planLabel.trim() || "Imported plan",
        preview,
      };

      try {
        await persistItemListServiceOutline(
          db,
          selectedItemList?._id,
          serviceOutline,
        );
      } catch (error) {
        console.error("Failed to persist service outline:", error);
      }

      return serviceOutline;
    },
    [
      allItems,
      churchIntegrations,
      churchIntegrationsStatus,
      db,
      selectedItemList?._id,
      store,
    ],
  );

  const applyPersistedOverlayUpdate = useCallback(
    (overlay: OverlayInfo, options: { select?: boolean } = {}) => {
      const normalized = normalizeOverlayForSync(overlay);
      dispatch(updateOverlayInList(normalized));

      const selectedOverlayId =
        store.getState().undoable.present.overlay.selectedOverlay?.id;
      if (options.select || selectedOverlayId === normalized.id) {
        dispatch(setOverlayHasPendingUpdate(false));
        dispatch(selectOverlay(normalized));
        dispatch(markOverlayPersisted(normalized));
      }
    },
    [dispatch, store],
  );

  const runOverlaySync = useCallback(
    async (
      overlayCandidates: ServicePlanningMappedRow[],
    ): Promise<{ updated: number; skipped: number; reasons: string[] }> => {
      let updated = 0;
      let skipped = 0;
      const reasons: string[] = [];
      const usedOverlayIds = new Set<string>();

      for (const block of overlayCandidates) {
        for (const cand of block.candidates) {
          const list = store.getState().undoable.present.overlays.list;
          const target = findOverlayForServicePlanningCandidate(
            block.source.elementType,
            cand.patch.event,
            list,
            usedOverlayIds,
          );

          if (!target) {
            const template = findParticipantTemplateForSync(
              list,
              cand.patch.event,
            );
            if (template) {
              const newId = generateRandomId();
              const built = buildClonedParticipantOverlay(
                template,
                cand.patch,
                newId,
              );
              dispatch(
                addExistingOverlayToList({
                  overlay: built,
                  insertAfterId: template.id,
                }),
              );
              usedOverlayIds.add(newId);
              await persistNewParticipantOverlayClone(
                db,
                template.id,
                newId,
                cand.patch,
                built,
              );
              updated += 1;
              continue;
            }

            const newId = generateRandomId();
            const newOverlay = buildNewParticipantOverlay(cand.patch, newId);
            dispatch(addExistingOverlayToList({ overlay: newOverlay }));
            usedOverlayIds.add(newId);
            await persistNewParticipantOverlay(db, newOverlay);
            updated += 1;
            reasons.push(
              `Created overlay for "${cand.patch.event || block.source.elementType}"`,
            );
            continue;
          }

          const next = getChangedOverlayPatch(target, cand.patch);
          if (Object.keys(next).length === 0) {
            usedOverlayIds.add(target.id);
            skipped += 1;
            reasons.push(
              `Overlay for "${cand.patch.event || block.source.elementType}" is already up to date.`,
            );
            continue;
          }

          if (db) {
            try {
              dispatch(setOverlayHasPendingUpdate(false));
              dispatch(selectOverlay(target));
              await new Promise((resolve) =>
                setTimeout(resolve, OVERLAY_SELECTION_SCROLL_DELAY_MS),
              );
              const persisted = await persistExistingOverlayDoc(db, {
                ...target,
                ...next,
              });
              applyPersistedOverlayUpdate(persisted, { select: true });
            } catch (e) {
              console.error("Service Planning sync DB error", target.id, e);
            }
          } else {
            dispatch(setOverlayHasPendingUpdate(false));
            dispatch(selectOverlay(target));
            await new Promise((resolve) =>
              setTimeout(resolve, OVERLAY_SELECTION_SCROLL_DELAY_MS),
            );
            applyPersistedOverlayUpdate(
              { ...target, ...next },
              { select: true },
            );
          }

          usedOverlayIds.add(target.id);
          updated += 1;
        }
      }

      return { updated, skipped, reasons };
    },
    [applyPersistedOverlayUpdate, db, dispatch, store],
  );

  const runOutlineInsert = useCallback(
    async (
      outlineCandidates: OutlineItemCandidate[],
    ): Promise<{ inserted: number }> => {
      const currentList = [...store.getState().undoable.present.itemList.list];
      const result = await insertServicePlanningOutlineCandidates({
        outlineCandidates,
        currentList,
        allItems,
        db,
        bibleDb,
        defaultBibleBackground: defaultBibleBackground.background,
        defaultBibleMediaInfo: defaultBibleBackground.mediaInfo,
        defaultBibleBackgroundBrightness,
        defaultBibleFontMode,
      });

      if (result.listChanged) {
        dispatch(updateItemList(result.newList));
      }

      if (result.createdAllItems.length > 0) {
        result.createdAllItems.forEach((item) => {
          dispatch(addItemToAllItemsList(item));
        });
      }

      return { inserted: result.inserted };
    },
    [
      allItems,
      bibleDb,
      db,
      defaultBibleBackground.background,
      defaultBibleBackground.mediaInfo,
      defaultBibleBackgroundBrightness,
      defaultBibleFontMode,
      dispatch,
      store,
    ],
  );

  const runImport = useCallback(
    async (
      preview: ServicePlanningPreview,
      options: ServicePlanningImportOptions,
    ): Promise<ServicePlanningImportResult> => {
      if (churchIntegrationsStatus !== "ready" || !churchIntegrations) {
        throw new Error(SERVICE_PLANNING_LOADING_MESSAGE);
      }
      if (!churchIntegrations.servicePlanning.enabled) {
        throw new Error(SERVICE_PLANNING_DISABLED_MESSAGE);
      }

      let overlaysUpdated = 0;
      let overlaysSkipped = 0;
      let outlineInserted = 0;
      const reasons: string[] = [];

      if (options.overlays) {
        const result = await runOverlaySync(preview.overlayCandidates);
        overlaysUpdated = result.updated;
        overlaysSkipped = result.skipped;
        reasons.push(...result.reasons);
      }

      if (options.outline) {
        const result = await runOutlineInsert(preview.outlineCandidates);
        outlineInserted = result.inserted;
      }

      return { overlaysUpdated, overlaysSkipped, outlineInserted, reasons };
    },
    [
      churchIntegrations,
      churchIntegrationsStatus,
      runOverlaySync,
      runOutlineInsert,
    ],
  );

  const planOutlineSyncSteps = useCallback(
    (preview: ServicePlanningPreview): ServicePlanningOutlineSyncStep[] =>
      planServicePlanningOutlineSyncSteps(
        preview.outlineCandidates,
        store.getState().undoable.present.itemList.list,
      ),
    [store],
  );

  const planOverlaySyncSteps = useCallback(
    (preview: ServicePlanningPreview) => {
      const skipped = preview.overlayPlan.filter((item) => item.action === "skip");
      const steps = preview.overlayPlan.filter(
        (item): item is ExecutableOverlaySyncPlanItem => item.action !== "skip",
      );
      return {
        steps,
        skippedCount: skipped.length,
        skipReasons: skipped
          .map((item) => item.reason)
          .filter((reason): reason is string => Boolean(reason?.trim())),
      };
    },
    [],
  );

  const planSyncItemsInOrder = useCallback(
    (
      preview: ServicePlanningPreview,
      mode: "outline" | "overlays" | "both",
    ): ServicePlanningSyncItem[] => {
      const items: ServicePlanningSyncItem[] = [];

      if (mode !== "overlays") {
        for (const candidate of preview.outlineCandidates) {
          if (!isSyncableOutlineCandidate(candidate)) continue;

          const alreadyPresent = Boolean(candidate.outlineAlreadyPresent);

          let label = "";
          if (candidate.outlineItemType === "bible" && candidate.parsedRef) {
            label = getBibleImportDisplayName(candidate.parsedRef, candidate.parsedRef.version);
          } else if (candidate.outlineItemType === "song") {
            label = candidate.matchedLibraryItem?.name || candidate.cleanedTitle || candidate.title;
          }
          if (!label) continue;

          items.push({
            label,
            sublabel: candidate.headingName || undefined,
            phase: "outline",
            status: alreadyPresent ? "already-present" : "pending",
            sourceLineItemKey: getOutlineCandidateLineItemKey(candidate),
          });
        }
      }

      if (mode !== "outline") {
        for (const item of preview.overlayPlan) {
          if (item.action === "skip" && !item.targetOverlayId) continue;
          const event =
            item.patch.event || item.targetOverlayEvent || item.targetOverlayName || item.elementType;
          const name = item.patch.name;
          items.push({
            label: name || event || "",
            sublabel: name ? event : undefined,
            phase: "overlays",
            status: item.action === "skip" ? "already-present" : "pending",
            sourceLineItemKey: getOverlayPlanLineItemKey(item),
          });
        }
      }

      return items;
    },
    [],
  );

  const executeOutlineSyncStep = useCallback(
    async (
      step: ServicePlanningOutlineSyncStep,
    ): Promise<{ inserted: number; activeLabel: string; activeListId?: string }> => {
      const currentList = [...store.getState().undoable.present.itemList.list];
      const result = await executeOutlineSyncUtilityStep({
        step,
        currentList,
        allItems,
        db,
        bibleDb,
        defaultBibleBackground: defaultBibleBackground.background,
        defaultBibleMediaInfo: defaultBibleBackground.mediaInfo,
        defaultBibleBackgroundBrightness,
        defaultBibleFontMode,
      });

      if (result.listChanged) {
        dispatch(updateItemList(result.newList));
      }

      if (result.createdAllItems.length > 0) {
        result.createdAllItems.forEach((item) => {
          dispatch(addItemToAllItemsList(item));
        });
      }

      if (result.activeListId) {
        dispatch(setActiveItemInList(result.activeListId));
      }

      const activeLabel =
        step.kind === "ensureHeading"
          ? step.headingName
          : step.candidate.title ||
            step.candidate.cleanedTitle ||
            (step.kind === "insertSongAtEnd" || step.kind === "insertBibleAtEnd" ? "" : step.headingName);

      return {
        inserted: result.inserted,
        activeLabel,
        activeListId: result.activeListId,
      };
    },
    [
      allItems,
      bibleDb,
      db,
      defaultBibleBackground.background,
      defaultBibleBackground.mediaInfo,
      defaultBibleBackgroundBrightness,
      defaultBibleFontMode,
      dispatch,
      store,
    ],
  );

  const executeOverlaySyncStep = useCallback(
    async (
      step: ExecutableOverlaySyncPlanItem,
      options: {
        insertAfterId?: string;
        /** Overlay ids already touched/created earlier in this run; excluded
         *  from the duplicate check so intentional same-event overlays
         *  (e.g. two co-hosts) are preserved while pre-existing ones are reused. */
        claimedOverlayIds?: ReadonlySet<string>;
      } = {},
    ): Promise<ServicePlanningOverlayStepExecutionResult> => {
      const list = store.getState().undoable.present.overlays.list;
      // Insert each new overlay after the previously synced plan item so the
      // synced overlays build up in plan order. Fall back to the template (clone)
      // or end of list (create) for the first step when there is no anchor yet.
      const { insertAfterId: anchorOverlayId, claimedOverlayIds } = options;

      if (step.action === "update") {
        const target =
          (step.targetOverlayId &&
            list.find((overlay) => overlay.id === step.targetOverlayId)) ||
          null;
        if (!target) {
          return {
            overlaysUpdated: 0,
            overlaysCloned: 0,
            overlaysCreated: 0,
            overlaysSkipped: 1,
            reasons: [
              `Could not find overlay for "${step.patch.event || step.elementType}".`,
            ],
          };
        }

        const changedPatch = getChangedOverlayPatch(target, step.patch);
        if (Object.keys(changedPatch).length === 0) {
          return {
            overlaysUpdated: 0,
            overlaysCloned: 0,
            overlaysCreated: 0,
            overlaysSkipped: 1,
            reasons: [
              `Overlay for "${step.patch.event || step.elementType}" is already up to date.`,
            ],
            // Existing overlay stays in place but anchors the next insertion.
            resultOverlayId: target.id,
          };
        }

        const next = { ...target, ...changedPatch } as OverlayInfo;
        dispatch(setOverlayHasPendingUpdate(false));
        dispatch(selectOverlay(target));
        await new Promise((resolve) =>
          setTimeout(resolve, OVERLAY_SELECTION_SCROLL_DELAY_MS),
        );
        if (db) {
          const persisted = await persistExistingOverlayDoc(db, next);
          applyPersistedOverlayUpdate(persisted, { select: true });
        } else {
          applyPersistedOverlayUpdate(next, { select: true });
        }

        return {
          overlaysUpdated: 1,
          overlaysCloned: 0,
          overlaysCreated: 0,
          overlaysSkipped: 0,
          reasons: [],
          resultOverlayId: target.id,
        };
      }

      // Idempotency guard for clone/create: if a participant overlay with the
      // same event already exists (and wasn't touched earlier in this run, and
      // isn't the clone template), update it in place instead of creating a
      // duplicate. This keeps "Sync all" safe to re-run and recovers from a
      // stale preview that still lists an overlay as new.
      if (step.action === "clone" || step.action === "create") {
        const targetEvent = normalizeOverlayEvent(step.patch.event);
        const existingDuplicate = targetEvent
          ? list.find(
              (overlay) =>
                (overlay.type ?? "participant") === "participant" &&
                overlay.id !== step.targetOverlayId &&
                !claimedOverlayIds?.has(overlay.id) &&
                normalizeOverlayEvent(overlay.event) === targetEvent,
            )
          : undefined;

        if (existingDuplicate) {
          const changedPatch = getChangedOverlayPatch(
            existingDuplicate,
            step.patch,
          );
          if (Object.keys(changedPatch).length === 0) {
            dispatch(selectOverlay(existingDuplicate));
            return {
              overlaysUpdated: 0,
              overlaysCloned: 0,
              overlaysCreated: 0,
              overlaysSkipped: 1,
              reasons: [
                `Overlay for "${step.patch.event || step.elementType}" already exists.`,
              ],
              resultOverlayId: existingDuplicate.id,
            };
          }

          const next = { ...existingDuplicate, ...changedPatch } as OverlayInfo;
          dispatch(setOverlayHasPendingUpdate(false));
          dispatch(selectOverlay(existingDuplicate));
          await new Promise((resolve) =>
            setTimeout(resolve, OVERLAY_SELECTION_SCROLL_DELAY_MS),
          );
          if (db) {
            const persisted = await persistExistingOverlayDoc(db, next);
            applyPersistedOverlayUpdate(persisted, { select: true });
          } else {
            applyPersistedOverlayUpdate(next, { select: true });
          }

          return {
            overlaysUpdated: 1,
            overlaysCloned: 0,
            overlaysCreated: 0,
            overlaysSkipped: 0,
            reasons: [],
            resultOverlayId: existingDuplicate.id,
          };
        }
      }

      if (step.action === "clone") {
        const template =
          (step.targetOverlayId &&
            list.find((overlay) => overlay.id === step.targetOverlayId)) ||
          null;
        if (!template) {
          return {
            overlaysUpdated: 0,
            overlaysCloned: 0,
            overlaysCreated: 0,
            overlaysSkipped: 1,
            reasons: [
              `Could not find template overlay for "${step.patch.event || step.elementType}".`,
            ],
          };
        }

        dispatch(selectOverlay(template));
        await new Promise((resolve) =>
          setTimeout(resolve, OVERLAY_SELECTION_SCROLL_DELAY_MS),
        );
        const newId = generateRandomId();
        const built = buildClonedParticipantOverlay(
          template,
          step.patch,
          newId,
        );
        await persistNewParticipantOverlayClone(
          db,
          template.id,
          newId,
          step.patch,
          built,
        );
        dispatch(
          addExistingOverlayToList({
            overlay: built,
            insertAfterId: anchorOverlayId ?? template.id,
          }),
        );
        dispatch(selectOverlay(built));

        return {
          overlaysUpdated: 0,
          overlaysCloned: 1,
          overlaysCreated: 0,
          overlaysSkipped: 0,
          reasons: [],
          resultOverlayId: newId,
        };
      }

      const newId = generateRandomId();
      const newOverlay = buildNewParticipantOverlay(step.patch, newId);
      await persistNewParticipantOverlay(db, newOverlay);
      dispatch(
        addExistingOverlayToList({
          overlay: newOverlay,
          insertAfterId: anchorOverlayId,
        }),
      );
      dispatch(selectOverlay(newOverlay));

      return {
        overlaysUpdated: 0,
        overlaysCloned: 0,
        overlaysCreated: 1,
        overlaysSkipped: 0,
        reasons: [],
        resultOverlayId: newId,
      };
    },
    [applyPersistedOverlayUpdate, db, dispatch, store],
  );

  return {
    loadPreview,
    runImport,
    planOutlineSyncSteps,
    planSyncItemsInOrder,
    planOverlaySyncSteps,
    executeOutlineSyncStep,
    executeOverlaySyncStep,
    isServicePlanningEnabled,
    servicePlanningAvailabilityMessage,
  };
};
