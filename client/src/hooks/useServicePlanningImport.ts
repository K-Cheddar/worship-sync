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
import { cleanPlanningTitle } from "../integrations/servicePlanning/cleanPlanningTitle";
import {
  parseBibleReference,
  type ParsedBibleRef,
} from "../integrations/servicePlanning/parseBibleReference";
import { GlobalInfoContext } from "../context/globalInfo";
import { ControllerInfoContext } from "../context/controllerInfo";
import { updateOverlay } from "../store/overlaySlice";
import {
  addExistingOverlayToList,
  updateOverlayInList,
} from "../store/overlaysSlice";
import {
  buildClonedParticipantOverlay,
  findParticipantTemplateForSync,
  persistNewParticipantOverlayClone,
} from "../integrations/servicePlanning/servicePlanningOverlayClone";
import { applyPouchAudit } from "../utils/pouchAudit";
import generateRandomId from "../utils/generateRandomId";
import { getMatchForString } from "../utils/generalUtils";
import { createNewHeading } from "../utils/itemUtil";
import { updateItemList } from "../store/itemListSlice";
import type { DBOverlay, OverlayInfo, ServiceItem } from "../types";
import type { RootState } from "../store/store";
import type {
  OutlineItemCandidate,
  OverlaySyncPlanItem,
  ServicePlanningPreview,
} from "../types/servicePlanningImport";

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

const SONG_MATCH_THRESHOLD = 1;
const SERVICE_PLANNING_DISABLED_MESSAGE =
  "Service Planning is off. Ask an admin to enable it in Account > Integrations.";
const SERVICE_PLANNING_LOADING_MESSAGE =
  "Integrations are still loading. Try again in a moment.";

const getOverlaySkipReason = (
  targetEvent: string | undefined,
  fallbackElementType: string,
): string => `No overlay for "${targetEvent || fallbackElementType}"`;

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
  const { db } = useContext(ControllerInfoContext) || {};
  const { churchIntegrations, churchIntegrationsStatus } =
    useContext(GlobalInfoContext) || {};
  const allItems = useSelector((s: RootState) => s.allItems.list);
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
          if (template?.type === "participant") {
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

          allCandidatesResolvable = false;
          overlayPlan.push({
            sectionName,
            elementType: block.source.elementType,
            title: block.source.title,
            ledBy: block.source.ledBy,
            personIndex: candidate.personIndex,
            rawNameToken: candidate.rawNameToken,
            action: "skip",
            patch: { ...candidate.patch },
            reason: getOverlaySkipReason(
              candidate.patch.event,
              block.source.elementType,
            ),
          });
        }

        overlayReadyByRow.set(block.source, allCandidatesResolvable);
      }

      const songs = allItems.filter((item) => item.type === "song");
      const outlineCandidates: OutlineItemCandidate[] = [];

      for (const section of sections) {
        const sectionRule = sp.sectionRules.find((r) =>
          matchesSectionName(section.sectionName, r.matchSectionName, r.matchMode),
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
          if (!elementRule?.outlineSync || elementRule.outlineSync.itemType === "none") continue;

          const outlineItemType = elementRule.outlineSync.itemType;
          let matchedLibraryItem: ServiceItem | null = null;
          let parsedRef: ParsedBibleRef | null = null;
          const cleanedTitle = cleanPlanningTitle(row.title || row.elementType);

          if (outlineItemType === "song") {
            let bestScore = SONG_MATCH_THRESHOLD;
            const searchValue = cleanedTitle.toLowerCase();
            for (const song of songs) {
              const score = getMatchForString({ string: song.name, searchValue });
              if (score > bestScore) {
                bestScore = score;
                matchedLibraryItem = song;
              }
            }
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
            const template = findParticipantTemplateForSync(list, cand.patch.event);
            if (template?.type === "participant") {
              const newId = generateRandomId();
              const built = buildClonedParticipantOverlay(template, cand.patch, newId);
              dispatch(addExistingOverlayToList({ overlay: built, insertAfterId: template.id }));
              usedOverlayIds.add(newId);
              await persistNewParticipantOverlayClone(db, template.id, newId, cand.patch, built);
              updated += 1;
              continue;
            }
            skipped += 1;
            reasons.push(
              getOverlaySkipReason(cand.patch.event, block.source.elementType),
            );
            continue;
          }

          const next: Partial<OverlayInfo> = { ...cand.patch };
          dispatch(updateOverlayInList({ id: target.id, ...next }));
          if (selectedOverlayId === target.id) {
            const cur = store
              .getState()
              .undoable.present.overlays.list.find((o) => o.id === target.id);
            if (cur) dispatch(updateOverlay({ ...cur, ...next } as OverlayInfo));
          }

          if (db) {
            try {
              const dbOverlay: DBOverlay = await db.get(`overlay-${target.id}`);
              const updatedAt = new Date().toISOString();
              const toSave = applyPouchAudit(
                dbOverlay,
                { ...dbOverlay, ...next, updatedAt },
                { isNew: false },
              );
              await db.put(toSave);
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
    async (outlineCandidates: OutlineItemCandidate[]): Promise<{ inserted: number }> => {
      const currentList = [...store.getState().undoable.present.itemList.list];

      // Group candidates by headingName, preserving encounter order
      type HeadingGroup = { headingName: string; candidates: OutlineItemCandidate[] };
      const groups: HeadingGroup[] = [];
      const seenHeadings = new Set<string>();
      for (const c of outlineCandidates) {
        if (
          c.outlineItemType !== "song" ||
          !c.headingName ||
          !c.matchedLibraryItem
        ) {
          continue;
        }
        if (!seenHeadings.has(c.headingName)) {
          seenHeadings.add(c.headingName);
          groups.push({ headingName: c.headingName, candidates: [] });
        }
        groups.find((g) => g.headingName === c.headingName)!.candidates.push(c);
      }

      if (groups.length === 0) return { inserted: 0 };

      let newList = [...currentList];
      let inserted = 0;

      for (const group of groups) {
        let headingIndex = newList.findIndex(
          (item) =>
            item.type === "heading" &&
            item.name.toLowerCase() === group.headingName.toLowerCase(),
        );

        if (headingIndex === -1) {
          const result = await createNewHeading({
            name: group.headingName,
            list: newList,
            db,
          });
          const headingItem: ServiceItem = { ...result, listId: generateRandomId() };
          newList = [...newList, headingItem];
          headingIndex = newList.length - 1;
        }

        // Collect names already under this heading (up to next heading)
        const existingNames = new Set<string>();
        for (let i = headingIndex + 1; i < newList.length; i++) {
          if (newList[i].type === "heading") break;
          existingNames.add(newList[i].name.toLowerCase());
        }

        // Insert after all existing items under this heading
        let insertAfter = headingIndex;
        for (let i = headingIndex + 1; i < newList.length; i++) {
          if (newList[i].type === "heading") break;
          insertAfter = i;
        }

        for (const candidate of group.candidates) {
          if (!candidate.matchedLibraryItem) continue;
          const nameLower = candidate.matchedLibraryItem.name.toLowerCase();
          if (existingNames.has(nameLower)) continue;

          const newItem: ServiceItem = {
            ...candidate.matchedLibraryItem,
            listId: generateRandomId(),
          };
          newList = [
            ...newList.slice(0, insertAfter + 1),
            newItem,
            ...newList.slice(insertAfter + 1),
          ];
          existingNames.add(nameLower);
          insertAfter++;
          inserted++;
        }
      }

      if (inserted > 0) {
        dispatch(updateItemList(newList));
      }

      return { inserted };
    },
    [db, dispatch, store],
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
    [churchIntegrations, churchIntegrationsStatus, runOverlaySync, runOutlineInsert],
  );

  return {
    loadPreview,
    runImport,
    isServicePlanningEnabled,
    servicePlanningAvailabilityMessage,
  };
};
