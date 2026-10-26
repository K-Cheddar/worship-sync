import { selectItemEntries } from "../store/itemLibrarySelectors";
import { useCallback, useContext, useEffect, useRef } from "react";
import { useStore } from "react-redux";
import { useDispatch, useSelector } from "../hooks";
import { getServicePlanningImportDataFromUrl } from "../containers/Overlays/eventParser";
import { servicePlanToImportData } from "../integrations/servicePlanning/servicePlanToImportData";
import { mapNativeServicePlanParticipants } from "../integrations/servicePlanning/mapNativeServicePlanParticipants";
import type { ServicePlanningMappedRow } from "../integrations/servicePlanning/mapServicePlanningToOverlays";
import {
  buildServicePlanningPreview,
  getChangedOverlayPatch,
} from "../integrations/servicePlanning/buildServicePlanningPreview";
import { findOverlayForServicePlanningCandidate, normalizeOverlayEvent, planNativeOverlaySync, type OverlayMatchResolution } from "../integrations/servicePlanning/findBestOverlayMatch";
import { getAllOverlayDocs } from "../utils/dbUtils";
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
import {
  buildClonedParticipantOverlay,
  buildNewParticipantOverlay,
  applyServicePlanningOverlayPatch,
  findParticipantTemplateForSync,
  persistNewParticipantOverlay,
} from "../integrations/servicePlanning/servicePlanningOverlayClone";
import { moveOverlayAfterServicePlanningAnchor } from "../integrations/servicePlanning/servicePlanningOverlayOrder";
import generateRandomId from "../utils/generateRandomId";
import { setActiveItemInList, updateItemList } from "../store/itemListSlice";
import type { DBOverlay, OverlayInfo } from "../types";
import type { RootState } from "../store/store";
import { selectSongLibrary } from "../store/songLibrarySelectors";
import { getConfiguredDefaultFormatting } from "../utils/overlayUtils";
import type {
  OutlineItemCandidate,
  OverlaySyncPlanItem,
  ServicePlanningPreview,
  ServicePlanningTeamAssignment,
} from "../types/servicePlanningImport";
import type { ServiceOutline } from "../types/importedPlan";
import type {
  ServicePlan,
  ServicePlanParticipantOverlayProjection,
} from "../types/servicePlan";
import {
  executeServicePlanningOutlineSyncStep as executeOutlineSyncUtilityStep,
  insertServicePlanningOutlineCandidates,
  planServicePlanningOutlineSyncSteps,
  type ServicePlanningOutlineSyncStep,
} from "../utils/servicePlanningOutlineImport";
import { persistExistingOverlayDoc } from "../utils/persistOverlayDoc";
import { getBibleImportDisplayName } from "../utils/servicePlanningBibleImport";
import { createDefaultChurchIntegrations } from "../types/integrations";
import type { ServicePlanningSyncItem } from "../store/servicePlanningImportSlice";
import { normalizeOverlayForSync } from "../utils/overlayUtils";
import {
  getOutlineCandidateLineItemKey,
  getOverlayPlanLineItemKey,
} from "../utils/servicePlanningSyncKeys";
import { persistItemListServiceOutline } from "../utils/itemListImports";
import { itemDocumentToLibraryEntry } from "../utils/itemLibrary";
import { getChurchResource } from "../api/auth";
import type { ChurchResource } from "../types/churchResource";
import { getServicePlanElementContentResources } from "../types/servicePlan";
import { getServicePlanChurchResourceId } from "../pages/Services/servicePlanResources";

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
    (candidate.outlineItemType === "bible" && Boolean(candidate.parsedRef)) ||
    (candidate.outlineItemType === "custom-document" &&
      candidate.matchedLibraryItem?.type === "free"));

export const useServicePlanningImport = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { db, bibleDb } = useContext(ControllerInfoContext) || {};
  const { churchIntegrations, churchIntegrationsStatus, churchId } =
    useContext(GlobalInfoContext) || {};
  const churchResourceLookupCacheRef = useRef<{
    churchId: string;
    byId: Map<string, Promise<ChurchResource | undefined>>;
  }>({ churchId: "", byId: new Map() });
  const libraryItems = useSelector(selectItemEntries);
  const selectedItemList = useSelector(
    (s: RootState) =>
      s.undoable.present.itemLists.selectedList ??
      s.undoable.present.itemLists.activeList,
  );
  const overlayScopeRef = useRef({ db, churchId, listId: selectedItemList?._id });
  overlayScopeRef.current = { db, churchId, listId: selectedItemList?._id };
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
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
      const songLibrary = selectSongLibrary(state).songs;
      const customDocumentLibrary = state.allDocs.allFreeFormDocs
        .filter((document) => document.type === "free" && Array.isArray(document.slides))
        .map(itemDocumentToLibraryEntry);
      const preview = buildServicePlanningPreview({
        importData,
        servicePlanning: sp,
        overlays: state.undoable.present.overlays.list,
        songLibrary,
        customDocumentLibrary,
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
      plan: Pick<ServicePlan, "name" | "sections" | "sourceImport"> & Partial<Pick<ServicePlan, "planKey">>,
      teamAssignments: ServicePlanningTeamAssignment[],
      participantOverlay: ServicePlanParticipantOverlayProjection = {
        status: "failed",
        elements: [],
      },
    ): Promise<ServiceOutline> => {
      // A saved WorshipSync plan is native data. Build its controller model
      // even when the optional URL importer is disabled or its settings have
      // not loaded yet. Existing mapping rules are still honored when present.
      const sp = churchIntegrations?.servicePlanning
        ?? createDefaultChurchIntegrations().servicePlanning;
      if (churchResourceLookupCacheRef.current.churchId !== churchId) {
        churchResourceLookupCacheRef.current = {
          churchId: churchId || "",
          byId: new Map(),
        };
      }
      const resourceLookupCache = churchResourceLookupCacheRef.current;
      const resourceIds = [
        ...new Set(
          plan.sections.flatMap((section) =>
            section.elements.flatMap((element) =>
              getServicePlanElementContentResources(element)
                .map(getServicePlanChurchResourceId)
                .filter(Boolean),
            ),
          ),
        ),
      ];
      const churchResources = churchId
        ? await Promise.all(
            resourceIds.map((resourceId) => {
              let resourcePromise = resourceLookupCache.byId.get(resourceId);
              if (!resourcePromise) {
                resourcePromise = getChurchResource(churchId, resourceId)
                  .then(({ resource }) => resource)
                  .catch((error: unknown) => {
                    const status = (error as { status?: number } | null)?.status;
                    if (status !== 404) {
                      resourceLookupCache.byId.delete(resourceId);
                    }
                    return undefined;
                  });
                resourceLookupCache.byId.set(resourceId, resourcePromise);
              }
              return resourcePromise;
            }),
          )
        : [];
      const importData = servicePlanToImportData(
        plan,
        churchResources.filter(
          (resource): resource is ChurchResource => Boolean(resource),
        ),
      );
      const nativeOverlayMapping = mapNativeServicePlanParticipants({
        sections: plan.sections,
        importData,
        participantOverlay,
        servicePlanning: sp,
      });
      // Follow the saved-overlay drawer's library source. Copy library matches
      // into this list, so another list's saved overlays are never edited.
      const events = new Set(nativeOverlayMapping.overlayCandidates.flatMap((row) =>
        row.candidates.filter((candidate) => !candidate.skipReason)
          .map((candidate) => normalizeOverlayEvent(candidate.patch.event))));
      const overlayLibrary = db && events.size > 0
        ? (await getAllOverlayDocs(db))
            .filter((overlay) => (overlay.type ?? "participant") === "participant" &&
              events.has(normalizeOverlayEvent(overlay.event)))
            .map(normalizeOverlayForSync)
        : [];
      const state = store.getState();
      const songLibrary = selectSongLibrary(state).songs;
      const customDocumentLibrary = state.allDocs.allFreeFormDocs
        .filter((document) => document.type === "free" && Array.isArray(document.slides))
        .map(itemDocumentToLibraryEntry);
      const preview = buildServicePlanningPreview({
        importData,
        servicePlanning: sp,
        overlays: state.undoable.present.overlays.list,
        songLibrary,
        customDocumentLibrary,
        activeOutlineList: state.undoable.present.itemList.list,
        teamAssignments,
        nativeOverlayCandidates: nativeOverlayMapping.overlayCandidates,
        overlayLibrary,
        nativeOverlaySummary: nativeOverlayMapping.summary,
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
    [churchId, churchIntegrations, db, store],
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
          const resolution = findOverlayForServicePlanningCandidate(
            block.source.elementType,
            cand.patch.event,
            list,
            usedOverlayIds,
          );
          if (resolution.kind === "ambiguous") {
            skipped += 1;
            reasons.push(
              `More than one overlay could match "${cand.patch.event || block.source.elementType}". Adjust the event mapping before syncing this item.`,
            );
            continue;
          }
          const target = resolution.kind === "match" ? resolution.overlay : null;

          if (!target) {
            const template = findParticipantTemplateForSync(
              list,
              cand.patch.event,
            );
            if (template) {
              const newId = generateRandomId();
              const { templatesByType, defaultTemplateIdsByType } =
                store.getState().undoable.present.overlayTemplates;
              const built = buildClonedParticipantOverlay(
                template,
                cand.patch,
                newId,
                getConfiguredDefaultFormatting(
                  "participant",
                  templatesByType,
                  defaultTemplateIdsByType,
                ),
              );
              await persistNewParticipantOverlay(db, built);
              dispatch(
                addExistingOverlayToList({
                  overlay: built,
                  insertAfterId: template.id,
                }),
              );
              placeNewOverlayAfterAnchor(newId, overlayAnchorId);
              overlayAnchorId = newId;
              usedOverlayIds.add(newId);
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
            await persistNewParticipantOverlay(db, newOverlay);
            dispatch(addExistingOverlayToList({ overlay: newOverlay }));
            placeNewOverlayAfterAnchor(newId, overlayAnchorId);
            overlayAnchorId = newId;
            usedOverlayIds.add(newId);
            updated += 1;
            reasons.push(
              `Created overlay for "${cand.patch.event || block.source.elementType}"`,
            );
            continue;
          }

          const changedPatch = getChangedOverlayPatch(target, cand.patch);
          const nextOverlay = applyServicePlanningOverlayPatch(target, cand.patch);
          if (JSON.stringify(nextOverlay) === JSON.stringify(target)) {
            overlayAnchorId = target.id;
            usedOverlayIds.add(target.id);
            skipped += 1;
            reasons.push(
              `Overlay for "${cand.patch.event || block.source.elementType}" is already up to date.`,
            );
            continue;
          }

          dispatch(setOverlayHasPendingUpdate(false));
          dispatch(selectOverlay(target));
          await new Promise((resolve) =>
            setTimeout(resolve, OVERLAY_SELECTION_SCROLL_DELAY_MS),
          );
          if (db) {
            const persisted = await persistExistingOverlayDoc(db, {
              id: target.id,
              ...changedPatch,
            } as OverlayInfo);
            applyPersistedOverlayUpdate(persisted, { select: true });
          } else {
            applyPersistedOverlayUpdate(nextOverlay, { select: true });
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
      const customDocumentsById = new Map(
        store.getState().allDocs.allFreeFormDocs
          .filter((document) => document.type === "free" && Array.isArray(document.slides))
          .map((document) => [document._id, itemDocumentToLibraryEntry(document)]),
      );
      const currentCandidates = outlineCandidates.map((candidate) => {
        if (candidate.outlineItemType !== "custom-document" || !candidate.customDocumentId) {
          return candidate;
        }
        const currentDocument = customDocumentsById.get(candidate.customDocumentId) ?? null;
        const currentTitle = currentDocument?.name?.trim() || candidate.title;
        return {
          ...candidate,
          title: currentTitle,
          cleanedTitle: currentTitle,
          matchedLibraryItem: currentDocument,
        };
      });
      const result = await insertServicePlanningOutlineCandidates({
        outlineCandidates: currentCandidates,
        currentList,
        libraryItems,
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


      return { inserted: result.inserted };
    },
    [
      libraryItems,
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
      const overlayPlan = planNativeOverlaySync(
        preview.overlayPlan,
        store.getState().undoable.present.overlays.list,
        preview.overlayLibrary,
      );
      const skipped = overlayPlan.filter(
        (item) => item.action === "skip",
      );
      const steps = overlayPlan.filter(
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
    [store],
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
          } else if (candidate.outlineItemType === "custom-document") {
            label = candidate.matchedLibraryItem?.name || candidate.title;
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
        libraryItems,
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


      if (result.activeListId) {
        dispatch(setActiveItemInList(result.activeListId));
      }

      const activeLabel =
        step.kind === "ensureHeading"
          ? step.headingName
          : step.candidate.title ||
            step.candidate.cleanedTitle ||
            (step.kind === "insertSongAtEnd" || step.kind === "insertBibleAtEnd" || step.kind === "insertCustomDocumentAtEnd"
              ? ""
              : step.headingName);

      return {
        inserted: result.inserted,
        activeLabel,
        activeListId: result.activeListId,
      };
    },
    [
      libraryItems,
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
      const skipStep = (
        reason: string,
        resultOverlayId?: string,
      ): ServicePlanningOverlayStepExecutionResult => ({
        overlaysUpdated: 0,
        overlaysCloned: 0,
        overlaysCreated: 0,
        overlaysSkipped: 1,
        reasons: [reason],
        resultOverlayId,
      });

      const scopeAtStart = { db, churchId, listId: selectedItemList?._id };
      const isScopeCurrent = () => mountedRef.current &&
        overlayScopeRef.current.db === scopeAtStart.db &&
        overlayScopeRef.current.churchId === scopeAtStart.churchId &&
        overlayScopeRef.current.listId === scopeAtStart.listId &&
        (store.getState().undoable.present.itemLists.selectedList ??
          store.getState().undoable.present.itemLists.activeList)?._id === scopeAtStart.listId;
      if (step.sourceKind === "native" && !isScopeCurrent()) {
        return skipStep("The Controller changed. Refresh the plan before syncing.");
      }

      const excludedIds = new Set(claimedOverlayIds);
      if (step.action === "clone" && step.targetOverlayId) {
        excludedIds.add(step.targetOverlayId);
      }
      const plannedTarget = step.action === "update"
        ? list.find((overlay) => overlay.id === step.targetOverlayId &&
            !claimedOverlayIds?.has(overlay.id) &&
            (overlay.type ?? "participant") === "participant" &&
            normalizeOverlayEvent(overlay.event) === normalizeOverlayEvent(step.patch.event))
        : undefined;
      if (step.sourceKind === "native" && step.action === "update" && !plannedTarget) {
        return skipStep("The planned overlay changed. Refresh the plan before syncing.");
      }
      let resolution: OverlayMatchResolution;
      if (step.sourceKind === "native") {
        resolution = plannedTarget
          ? { kind: "match", overlay: plannedTarget, score: 100 }
          : { kind: "none" };
      } else {
        resolution = findOverlayForServicePlanningCandidate(
          step.elementType,
          step.patch.event,
          list,
          excludedIds,
          { duplicateExactMatchesAreAmbiguous: step.duplicateExactMatchesAreAmbiguous === true },
        );
      }
      if (resolution.kind === "ambiguous") {
        return skipStep(
          `More than one overlay could match "${step.patch.event || step.elementType}". Adjust the event mapping before syncing this item.`,
        );
      }
      const target = resolution.kind === "match" ? resolution.overlay : null;

      if (target) {
        const changedPatch = getChangedOverlayPatch(target, step.patch);
        if (Object.keys(changedPatch).length === 0) {
          return skipStep(
            `Overlay for "${step.patch.event || step.elementType}" is already up to date.`,
            target.id,
          );
        }

        const next = applyServicePlanningOverlayPatch(target, step.patch);
        dispatch(setOverlayHasPendingUpdate(false));
        dispatch(selectOverlay(target));
        await new Promise((resolve) =>
          setTimeout(resolve, OVERLAY_SELECTION_SCROLL_DELAY_MS),
        );
        if (step.sourceKind === "native" && !isScopeCurrent()) {
          return skipStep("The Controller changed. Refresh the plan before syncing.");
        }
        if (db) {
          const persisted = await persistExistingOverlayDoc(db, {
            id: target.id,
            ...changedPatch,
          } as OverlayInfo);
          if (step.sourceKind !== "native" || isScopeCurrent()) {
            applyPersistedOverlayUpdate(persisted, { select: true });
          }
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

      if (step.action === "clone") {
        let template = list.find((overlay) => overlay.id === step.targetOverlayId) ?? null;
        if (step.targetOverlaySource === "library" && db && step.targetOverlayId) {
          template = normalizeOverlayForSync(await db.get(`overlay-${step.targetOverlayId}`) as DBOverlay);
        }
        if (template) {
          if (step.sourceKind === "native" && (!isScopeCurrent() ||
              (template.type ?? "participant") !== "participant" ||
              normalizeOverlayEvent(template.event) !== normalizeOverlayEvent(step.patch.event))) {
            return skipStep("The planned overlay changed. Refresh the plan before syncing.");
          }
          dispatch(selectOverlay(template));
          await new Promise((resolve) =>
            setTimeout(resolve, OVERLAY_SELECTION_SCROLL_DELAY_MS),
          );
          if (step.sourceKind === "native" && !isScopeCurrent()) {
            return skipStep("The Controller changed. Refresh the plan before syncing.");
          }
          const newId = generateRandomId();
          const { templatesByType, defaultTemplateIdsByType } =
            store.getState().undoable.present.overlayTemplates;
          let built = buildClonedParticipantOverlay(
            template,
            step.patch,
            newId,
            getConfiguredDefaultFormatting(
              "participant",
              templatesByType,
              defaultTemplateIdsByType,
            ),
          );
          if (step.targetOverlaySource === "library") {
            built = applyServicePlanningOverlayPatch({ ...template, id: newId }, step.patch);
            delete built.servicePlanSource;
            delete built.servicePlanBaseline;
            delete built.servicePlanOverrides;
          }
          await persistNewParticipantOverlay(db, built);
          if (step.sourceKind === "native" && !isScopeCurrent()) {
            return skipStep("The Controller changed. Refresh the plan before syncing.");
          }
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
        if (step.sourceKind === "native") {
          return skipStep("The planned overlay is unavailable. Refresh the plan before syncing.");
        }
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
      if (step.sourceKind === "native" && !isScopeCurrent()) {
        return skipStep("The Controller changed. Refresh the plan before syncing.");
      }
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
    [applyPersistedOverlayUpdate, churchId, db, dispatch, placeNewOverlayAfterAnchor, selectedItemList?._id, store],
  );

  const runImport = useCallback(
    async (
      preview: ServicePlanningPreview,
      options: ServicePlanningImportOptions,
    ): Promise<ServicePlanningImportResult> => {
      if (!preview.nativeOverlaySummary && (churchIntegrationsStatus !== "ready" || !churchIntegrations)) {
        throw new Error(SERVICE_PLANNING_LOADING_MESSAGE);
      }
      if (!preview.nativeOverlaySummary && !churchIntegrations?.servicePlanning.enabled) {
        throw new Error(SERVICE_PLANNING_DISABLED_MESSAGE);
      }

      let overlaysUpdated = 0;
      let overlaysSkipped = 0;
      let outlineInserted = 0;
      const reasons: string[] = [];

      if (options.overlays) {
        if (preview.nativeOverlaySummary) {
          const planned = planOverlaySyncSteps(preview);
          overlaysSkipped = planned.skippedCount;
          reasons.push(...planned.skipReasons);
          const claimedOverlayIds = new Set<string>();
          let insertAfterId: string | undefined;
          for (const step of planned.steps) {
            const result = await executeOverlaySyncStep(step, { claimedOverlayIds, insertAfterId });
            overlaysUpdated += result.overlaysUpdated + result.overlaysCloned + result.overlaysCreated;
            overlaysSkipped += result.overlaysSkipped;
            reasons.push(...result.reasons);
            if (result.resultOverlayId) {
              claimedOverlayIds.add(result.resultOverlayId);
              insertAfterId = result.resultOverlayId;
            }
          }
        } else {
          const result = await runOverlaySync(preview.overlayCandidates);
          overlaysUpdated = result.updated;
          overlaysSkipped = result.skipped;
          reasons.push(...result.reasons);
        }
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
      planOverlaySyncSteps,
      executeOverlaySyncStep,
      runOutlineInsert,
    ],
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
