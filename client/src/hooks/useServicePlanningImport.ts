import { useCallback, useContext } from "react";
import { useStore } from "react-redux";
import { useDispatch, useSelector } from "../hooks";
import { getServicePlanningImportDataFromUrl } from "../containers/Overlays/eventParser";
import { servicePlanToImportData } from "../integrations/servicePlanning/servicePlanToImportData";
import type { ServicePlanningMappedRow } from "../integrations/servicePlanning/mapServicePlanningToOverlays";
import {
  buildServicePlanningPreview,
  getChangedOverlayPatch,
  normalizeOverlayEvent,
} from "../integrations/servicePlanning/buildServicePlanningPreview";
import { findOverlayForServicePlanningCandidate } from "../integrations/servicePlanning/findBestOverlayMatch";
import { GlobalInfoContext } from "../context/globalInfo";
import { ControllerInfoContext } from "../context/controllerInfo";
import {
  markOverlayPersisted,
  selectOverlay,
  setHasPendingUpdate as setOverlayHasPendingUpdate,
} from "../store/overlaySlice";
import {
  addExistingOverlayToList,
  updateList as updateOverlayList,
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
import { moveOverlayAfterServicePlanningAnchor } from "../integrations/servicePlanning/servicePlanningOverlayOrder";
import generateRandomId from "../utils/generateRandomId";
import { setActiveItemInList, updateItemList } from "../store/itemListSlice";
import type { OverlayInfo } from "../types";
import type { RootState } from "../store/store";
import { getConfiguredDefaultFormatting } from "../utils/overlayUtils";
import type {
  OutlineItemCandidate,
  OverlaySyncPlanItem,
  ServicePlanningPreview,
  ServicePlanningTeamAssignment,
} from "../types/servicePlanningImport";
import type { ServiceOutline } from "../types/importedPlan";
import type { ServicePlan } from "../types/servicePlan";
import {
  executeServicePlanningOutlineSyncStep as executeOutlineSyncUtilityStep,
  insertServicePlanningOutlineCandidates,
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
   * insertion anchor for the next step so new overlays can land near the
   * weekly overlays they belong with without moving existing rows.
   */
  resultOverlayId?: string;
};

const SERVICE_PLANNING_DISABLED_MESSAGE =
  "Service Planning is off. Ask an admin to enable it in Account > Integrations.";
const SERVICE_PLANNING_LOADING_MESSAGE =
  "Integrations are still loading. Try again in a moment.";
const OVERLAY_SELECTION_SCROLL_DELAY_MS = 500;

/**
 * These moved to buildServicePlanningPreview.ts so the preview can be built
 * from a saved ServicePlan as well as a scraped URL. Re-exported here because
 * the Controller panels (and their test mocks) import them from this module.
 */
export {
  dedupeOutlineCandidatesForPreview,
  getChangedOverlayPatch,
  getRepeatedOverlayDedupeKey,
  overlayPlanHasExecutableChange,
} from "../integrations/servicePlanning/buildServicePlanningPreview";

const isSyncableOutlineCandidate = (candidate: OutlineItemCandidate): boolean =>
  !candidate.outlineAlreadyPresent &&
  ((candidate.outlineItemType === "song" &&
    Boolean(candidate.matchedLibraryItem)) ||
    (candidate.outlineItemType === "bible" && Boolean(candidate.parsedRef)));

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
      const state = store.getState();
      const preview = buildServicePlanningPreview({
        importData,
        servicePlanning: sp,
        overlays: state.undoable.present.overlays.list,
        allItems,
        activeOutlineList: state.undoable.present.itemList.list,
      });

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

  /**
   * The plan-sourced twin of `loadPreview`: same matching rules, same preview
   * shape, but built from the Teams ServicePlan the Services page owns instead
   * of a freshly scraped URL.
   *
   * Deliberately does *not* call `persistItemListServiceOutline`. A plan-sourced
   * preview is rebuilt on every `service-plan-updated` event, and the Services
   * editor autosaves as the operator types — mirroring each of those into a
   * PouchDB write would put storage churn on a live surface for no gain, since
   * the plan is already durable server-side and re-derived on mount.
   */
  const loadPlanPreview = useCallback(
    async (
      plan: Pick<ServicePlan, "name" | "sections" | "sourceImport">,
      teamAssignments: ServicePlanningTeamAssignment[],
    ): Promise<ServiceOutline> => {
      if (churchIntegrationsStatus !== "ready" || !churchIntegrations) {
        throw new Error(SERVICE_PLANNING_LOADING_MESSAGE);
      }
      const sp = churchIntegrations.servicePlanning;
      if (!sp.enabled) {
        throw new Error(SERVICE_PLANNING_DISABLED_MESSAGE);
      }

      const importData = servicePlanToImportData(plan);
      const state = store.getState();
      const preview = buildServicePlanningPreview({
        importData,
        servicePlanning: sp,
        overlays: state.undoable.present.overlays.list,
        allItems,
        activeOutlineList: state.undoable.present.itemList.list,
        teamAssignments,
      });

      return {
        source: "servicePlanning",
        loadedAt: new Date().toISOString(),
        // Provenance only — where this plan was originally imported from.
        sourceUrl: plan.sourceImport?.sourceUrl ?? "",
        planLabel: importData.planLabel,
        preview,
      };
    },
    [allItems, churchIntegrations, churchIntegrationsStatus, store],
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

  const placeNewOverlayAfterAnchor = useCallback(
    (overlayId: string, insertAfterId?: string): boolean => {
      const list = store.getState().undoable.present.overlays.list;
      const next = moveOverlayAfterServicePlanningAnchor(
        list,
        overlayId,
        insertAfterId,
      );
      if (next === list) return false;
      dispatch(updateOverlayList(next));
      return true;
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
      let overlayAnchorId: string | undefined;

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
              placeNewOverlayAfterAnchor(newId, overlayAnchorId);
              overlayAnchorId = newId;
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
            const { templatesByType, defaultTemplateIdsByType } =
              store.getState().undoable.present.overlayTemplates;
            const newOverlay = buildNewParticipantOverlay(
              cand.patch,
              newId,
              getConfiguredDefaultFormatting(
                "participant",
                templatesByType,
                defaultTemplateIdsByType,
              ),
            );
            dispatch(addExistingOverlayToList({ overlay: newOverlay }));
            placeNewOverlayAfterAnchor(newId, overlayAnchorId);
            overlayAnchorId = newId;
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
            overlayAnchorId = target.id;
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

          overlayAnchorId = target.id;
          usedOverlayIds.add(target.id);
          updated += 1;
        }
      }

      return { updated, skipped, reasons };
    },
    [applyPersistedOverlayUpdate, db, dispatch, placeNewOverlayAfterAnchor, store],
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
      const skipped = preview.overlayPlan.filter(
        (item) => item.action === "skip",
      );
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
            label = getBibleImportDisplayName(
              candidate.parsedRef,
              candidate.parsedRef.version,
            );
          } else if (candidate.outlineItemType === "song") {
            label =
              candidate.matchedLibraryItem?.name ||
              candidate.cleanedTitle ||
              candidate.title;
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
          if (item.action === "skip") continue;
          const event =
            item.patch.event ||
            item.targetOverlayEvent ||
            item.targetOverlayName ||
            item.elementType;
          const name = item.patch.name;
          items.push({
            label: name || event || "",
            sublabel: name ? event : undefined,
            phase: "overlays",
            status: "pending",
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
    ): Promise<{
      inserted: number;
      activeLabel: string;
      activeListId?: string;
    }> => {
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
            (step.kind === "insertSongAtEnd" || step.kind === "insertBibleAtEnd"
              ? ""
              : step.headingName);

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
        placeNewOverlayAfterAnchor(newId, anchorOverlayId);
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
      const { templatesByType, defaultTemplateIdsByType } =
        store.getState().undoable.present.overlayTemplates;
      const newOverlay = buildNewParticipantOverlay(
        step.patch,
        newId,
        getConfiguredDefaultFormatting(
          "participant",
          templatesByType,
          defaultTemplateIdsByType,
        ),
      );
      await persistNewParticipantOverlay(db, newOverlay);
      dispatch(
        addExistingOverlayToList({
          overlay: newOverlay,
          insertAfterId: anchorOverlayId,
        }),
      );
      placeNewOverlayAfterAnchor(newId, anchorOverlayId);
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
    [applyPersistedOverlayUpdate, db, dispatch, placeNewOverlayAfterAnchor, store],
  );

  return {
    loadPreview,
    loadPlanPreview,
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
