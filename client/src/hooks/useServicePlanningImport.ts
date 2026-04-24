import { useCallback, useContext } from "react";
import { useStore } from "react-redux";
import { useDispatch, useSelector } from "../hooks";
import {
  getSectionsFromUrl,
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
import { selectOverlay, updateOverlay } from "../store/overlaySlice";
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
  ServicePlanningPreview,
} from "../types/servicePlanningImport";
import {
  executeServicePlanningOutlineSyncStep as executeOutlineSyncUtilityStep,
  insertServicePlanningOutlineCandidates,
  planServicePlanningOutlineSyncSteps,
  type ServicePlanningOutlineSyncStep,
} from "../utils/servicePlanningOutlineImport";
import { persistExistingOverlayDoc } from "../utils/persistOverlayDoc";

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
};

const SERVICE_PLANNING_DISABLED_MESSAGE =
  "Service Planning is off. Ask an admin to enable it in Account > Integrations.";
const SERVICE_PLANNING_LOADING_MESSAGE =
  "Integrations are still loading. Try again in a moment.";
const OVERLAY_SELECTION_SCROLL_DELAY_MS = 75;

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

export const useServicePlanningImport = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { db, bibleDb } = useContext(ControllerInfoContext) || {};
  const { churchIntegrations, churchIntegrationsStatus } =
    useContext(GlobalInfoContext) || {};
  const allItems = useSelector((s: RootState) => s.allItems.list);
  const {
    defaultBibleBackground,
    defaultBibleBackgroundBrightness,
    defaultBibleFontMode,
  } = useSelector((s: RootState) => s.undoable.present.preferences.preferences);
  const selectedOverlayId = useSelector(
    (s: RootState) => s.undoable.present.overlay?.selectedOverlay?.id,
  );
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
    async (url: string): Promise<ServicePlanningPreview> => {
      if (churchIntegrationsStatus !== "ready" || !churchIntegrations) {
        throw new Error(SERVICE_PLANNING_LOADING_MESSAGE);
      }
      const sp = churchIntegrations.servicePlanning;
      if (!sp.enabled) {
        throw new Error(SERVICE_PLANNING_DISABLED_MESSAGE);
      }

      const sections = await getSectionsFromUrl(url);
      const sectionNameByRow = new WeakMap<EventData, string>();
      sections.forEach((section) => {
        section.rows.forEach((row) => {
          sectionNameByRow.set(row, section.sectionName);
        });
      });
      const allRows = sections.flatMap((s) => s.rows);
      const overlayCandidates = mapServicePlanningRows(allRows, sp);
      const previewOverlays = store.getState().undoable.present.overlays.list;
      const previewUsedOverlayIds = new Set<string>();
      const overlayReadyByRow = new WeakMap<EventData, boolean>();
      const overlayPlan: OverlaySyncPlanItem[] = [];

      for (const block of overlayCandidates) {
        let allCandidatesResolvable = true;
        const sectionName = sectionNameByRow.get(block.source) ?? "";
        for (const candidate of block.candidates) {
          const target = findOverlayForServicePlanningCandidate(
            block.source.elementType,
            candidate.patch.event,
            previewOverlays,
            previewUsedOverlayIds,
          );
          if (target) {
            previewUsedOverlayIds.add(target.id);
            overlayPlan.push({
              sectionName,
              elementType: block.source.elementType,
              title: block.source.title,
              ledBy: block.source.ledBy,
              personIndex: candidate.personIndex,
              rawNameToken: candidate.rawNameToken,
              action: "update",
              targetOverlayId: target.id,
              targetOverlayName: target.name || undefined,
              targetOverlayEvent: target.event || undefined,
              patch: { ...candidate.patch },
            });
            continue;
          }

          const template = findParticipantTemplateForSync(
            previewOverlays,
            candidate.patch.event,
          );
          if (template) {
            overlayPlan.push({
              sectionName,
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
            continue;
          }

          overlayPlan.push({
            sectionName,
            elementType: block.source.elementType,
            title: block.source.title,
            ledBy: block.source.ledBy,
            personIndex: candidate.personIndex,
            rawNameToken: candidate.rawNameToken,
            action: "create",
            patch: { ...candidate.patch },
            reason: `Create overlay for "${candidate.patch.event || block.source.elementType}"`,
          });
        }

        overlayReadyByRow.set(block.source, allCandidatesResolvable);
      }

      const songs = allItems.filter((item) => item.type === "song");
      const outlineCandidates: OutlineItemCandidate[] = [];

      for (const section of sections) {
        const sectionRule = sp.sectionRules.find((r) =>
          matchesSectionName(
            section.sectionName,
            r.matchSectionName,
            r.matchMode,
          ),
        );
        const headingName = sectionRule?.headingName ?? null;

        for (const row of section.rows) {
          const elementRule = findBestMatchingElementRule(
            row.elementType,
            sp.elementRules,
            {
              filter: (rule) => rule.outlineSync?.enabled ?? false,
            },
          );
          if (
            !elementRule?.outlineSync ||
            elementRule.outlineSync.itemType === "none"
          )
            continue;

          const outlineItemType = elementRule.outlineSync.itemType;
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

          outlineCandidates.push({
            sectionName: section.sectionName,
            headingName,
            elementType: row.elementType,
            title: row.title,
            outlineItemType,
            cleanedTitle,
            matchedLibraryItem,
            parsedRef,
            overlayReady: overlayReadyByRow.get(row) ?? false,
          });
        }
      }

      return {
        overlayCandidates,
        overlayPlan,
        outlineCandidates: dedupeOutlineCandidatesForPreview(outlineCandidates),
      };
    },
    [churchIntegrations, churchIntegrationsStatus, allItems, store],
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

          const next: Partial<OverlayInfo> = { ...cand.patch };
          dispatch(updateOverlayInList({ id: target.id, ...next }));
          if (selectedOverlayId === target.id) {
            const cur = store
              .getState()
              .undoable.present.overlays.list.find((o) => o.id === target.id);
            if (cur)
              dispatch(updateOverlay({ ...cur, ...next } as OverlayInfo));
          }

          if (db && selectedOverlayId !== target.id) {
            try {
              await persistExistingOverlayDoc(db, {
                ...target,
                ...next,
              });
            } catch (e) {
              console.error("Service Planning sync DB error", target.id, e);
            }
          }

          usedOverlayIds.add(target.id);
          updated += 1;
        }
      }

      return { updated, skipped, reasons };
    },
    [db, dispatch, store, selectedOverlayId],
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
      planServicePlanningOutlineSyncSteps(preview.outlineCandidates),
    [],
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

  const executeOutlineSyncStep = useCallback(
    async (
      step: ServicePlanningOutlineSyncStep,
    ): Promise<{ inserted: number; activeLabel: string }> => {
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
            step.headingName;

      return {
        inserted: result.inserted,
        activeLabel,
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
    ): Promise<ServicePlanningOverlayStepExecutionResult> => {
      const list = store.getState().undoable.present.overlays.list;

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

        dispatch(selectOverlay(target));
        await new Promise((resolve) => setTimeout(resolve, 500));
        const next = { ...target, ...step.patch } as OverlayInfo;
        dispatch(updateOverlay(next));
        dispatch(updateOverlayInList({ id: target.id, ...step.patch }));

        return {
          overlaysUpdated: 1,
          overlaysCloned: 0,
          overlaysCreated: 0,
          overlaysSkipped: 0,
          reasons: [],
        };
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
            insertAfterId: template.id,
          }),
        );
        dispatch(selectOverlay(built));

        return {
          overlaysUpdated: 0,
          overlaysCloned: 1,
          overlaysCreated: 0,
          overlaysSkipped: 0,
          reasons: [],
        };
      }

      const newId = generateRandomId();
      const newOverlay = buildNewParticipantOverlay(step.patch, newId);
      await persistNewParticipantOverlay(db, newOverlay);
      dispatch(addExistingOverlayToList({ overlay: newOverlay }));
      dispatch(selectOverlay(newOverlay));

      return {
        overlaysUpdated: 0,
        overlaysCloned: 0,
        overlaysCreated: 1,
        overlaysSkipped: 0,
        reasons: [],
      };
    },
    [db, dispatch, store],
  );

  return {
    loadPreview,
    runImport,
    planOutlineSyncSteps,
    planOverlaySyncSteps,
    executeOutlineSyncStep,
    executeOverlaySyncStep,
    isServicePlanningEnabled,
    servicePlanningAvailabilityMessage,
  };
};
