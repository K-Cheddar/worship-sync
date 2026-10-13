import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "../hooks";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import { putGeneratedCreditDoc } from "../utils/dbUtils";
import { getTeamsBootstrap } from "../api/auth";
import {
  addCredit,
  selectCredit,
  updateCreditFromGeneration,
} from "../store/creditsSlice";
import {
  completeGeneratedCreditItem,
  completeGeneratedCredits,
  failGeneratedCreditItem,
  failGeneratedCredits,
  detachGeneratedCreditsOperation,
  setGeneratedCreditActive,
  startGeneratedCredits,
} from "../store/generatedCreditsSlice";
import store, { broadcastCreditsUpdate } from "../store/store";
import { flushCreditsHistoryFromLatestList } from "../utils/creditsHistoryFlush";
import { getActiveContentDatabaseOwner } from "../store/deferredItemMutations";
import type { GeneratedCreditsOwner } from "../store/generatedCreditsSlice";
import type { ServicePlanningTeamAssignment } from "../types/servicePlanningImport";
import type { CreditsInfo } from "../types";
import {
  buildTeamScheduleCreditEntries,
  getGeneratedScheduleCreditId,
  resolveTeamScheduleCreditMatches,
  teamScheduleCreditHeadingMatches,
  type TeamScheduleCreditAvailability,
  type TeamScheduleCreditEntry,
  type TeamScheduleCreditPosition,
} from "../utils/teamScheduleCredits";

const PRAISE_TEAM_ROLE_ORDER = ["worship leader", "soprano", "alto", "tenor"];
const SERVICE_PLAN_CREDIT_FALLBACKS = [
  { heading: "Band", headingMatch: "band", teamName: "Band", format: "role-name" as const },
  { heading: "Worship Coordinators", headingMatch: "worship coordinators", teamName: "Coordinators", format: "name-only" as const },
  { heading: "Praise Team", headingMatch: "praise team", teamName: "Praise Team", format: "role-name" as const },
];
let nextGeneratedCreditOperationId = 0;
let nextGeneratedCreditDatabaseId = 0;
const generatedCreditDatabaseIds = new WeakMap<object, number>();

const getDatabaseInstanceId = (database: unknown): number => {
  if ((typeof database !== "object" && typeof database !== "function") || database === null) {
    return 0;
  }
  const object = database as object;
  const existingId = generatedCreditDatabaseIds.get(object);
  if (existingId) return existingId;
  const instanceId = ++nextGeneratedCreditDatabaseId;
  generatedCreditDatabaseIds.set(object, instanceId);
  return instanceId;
};

const getGenerationOwnerKey = (owner: GeneratedCreditsOwner) =>
  JSON.stringify([
    owner.churchId,
    owner.databaseKey,
    owner.databaseScopeId,
    owner.databaseInstanceId,
    owner.outlineId,
  ]);

const createGeneratedCreditOperationId = () =>
  `credits-${Date.now()}-${++nextGeneratedCreditOperationId}`;
const PARTICIPANT_EVENT_KEYS = [
  "sabbath school",
  "welcome",
  "call to praise",
  "invocation",
  "reading",
  "intercessor",
  "offertory",
  "special",
  "sermon",
  "behind the pulpit",
];
const CREDIT_GENERATION_STEP_DELAY_MS = 350;
const creditSaveFailureMessage = (detail?: string) =>
  detail
    ? `Could not save this credit: ${detail}. Generate again to retry.`
    : "Could not save this credit. Generate again to retry.";

type GeneratedCreditDetail = {
  sourceLabel: string;
  names: string;
};

type PlannedGeneratedCreditUpdate = {
  credit: CreditsInfo & {
    generatedBaselineText: string;
    generatedSource: string;
    generatedTextOverridden: false;
  };
  previousText: string;
  sourceLabel: string;
};

type PlannedGeneratedCreditCreation = {
  credit: CreditsInfo & {
    generatedBaselineText: string;
    generatedSource: string;
    generatedTextOverridden: false;
  };
  sourceLabel: string;
};

type GeneratedCreditWriteResult = NonNullable<
  Awaited<ReturnType<typeof putGeneratedCreditDoc>>
>;

const waitForCreditGenerationStep = () =>
  new Promise((resolve) =>
    setTimeout(resolve, CREDIT_GENERATION_STEP_DELAY_MS),
  );

const normalizeGeneratedCreditText = (text: string) =>
  text
    .split("\n")
    .map((item: string) => item.trim())
    .filter(Boolean)
    .join("\n");

function praiseTeamSortKey(role: string): number {
  const normalized = role
    .replace(/\s+Singer$/i, "")
    .trim()
    .toLowerCase();
  const idx = PRAISE_TEAM_ROLE_ORDER.indexOf(normalized);
  return idx === -1 ? PRAISE_TEAM_ROLE_ORDER.length : idx;
}

function buildTeamCreditsText(
  assignments: ServicePlanningTeamAssignment[],
  teamName: string,
  format: "role-name" | "name-only",
): string | null {
  let members = assignments.filter(
    (a) => a.teamName.toLowerCase() === teamName.toLowerCase(),
  );
  if (!members.length) return null;
  if (teamName.toLowerCase() === "praise team") {
    members = [...members].sort(
      (a, b) => praiseTeamSortKey(a.role) - praiseTeamSortKey(b.role),
    );
  }
  return members
    .map((a) => {
      if (format === "name-only") return a.name;
      const role = a.role.replace(/\s+Singer$/i, "").trim();
      return `${role} - ${a.name}`;
    })
    .join("\n");
}

/**
 * Shared "Generate credits from overlays + schedule" action for Credits Editor and overlay toolbar.
 */
export function useGenerateCreditsFromOverlays() {
  const dispatch = useDispatch();
  const { list } = useSelector((state) => state.undoable.present.credits);
  const outlineIdForCredits = useSelector(
    (state) =>
      state.undoable.present.itemLists.selectedList?._id ??
      state.undoable.present.itemLists.activeList?._id,
  );
  const { list: overlays } = useSelector(
    (state) => state.undoable.present.overlays,
  );
  const participantOverlays = useMemo(
    () => overlays.filter((overlay) => overlay.type === "participant"),
    [overlays],
  );
  const { db } = useContext(ControllerInfoContext) ?? {};
  const { churchId = "" } = useContext(GlobalInfoContext) ?? {};
  const teamAssignments = useSelector(
    (state) =>
      state.servicePlanningImport?.serviceOutline?.preview.teamAssignments ??
      [],
  );
  const servicePlanKey = useSelector(
    (state) => state.servicePlanningImport?.servicePlanKey ?? undefined,
  );
  const activeDatabaseOwner = getActiveContentDatabaseOwner();
  const currentGenerationOwner: GeneratedCreditsOwner & {
    db: typeof db;
  } = {
    db,
    churchId,
    outlineId: outlineIdForCredits ?? "",
    databaseKey:
      activeDatabaseOwner?.churchId === churchId
        ? activeDatabaseOwner.databaseKey
        : typeof db?.name === "string"
          ? db.name
          : "",
    databaseScopeId:
      activeDatabaseOwner?.churchId === churchId
        ? activeDatabaseOwner.scopeId
        : "",
    databaseInstanceId: getDatabaseInstanceId(db),
  };
  const generationOwnerRef = useRef(currentGenerationOwner);
  generationOwnerRef.current = currentGenerationOwner;
  const isMountedRef = useRef(false);
  const justGeneratedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightGenerationIdsRef = useRef(new Map<string, string>());
  const justGeneratedOperationIdRef = useRef<string | null>(null);
  const [, setGenerationRevision] = useState(0);
  const [justGeneratedOwnerKey, setJustGeneratedOwnerKey] = useState<string | null>(null);
  useEffect(() => {
    isMountedRef.current = true;
    const inFlightGenerationIds = inFlightGenerationIdsRef.current;
    return () => {
      isMountedRef.current = false;
      const ownerKey = getGenerationOwnerKey(generationOwnerRef.current);
      const operationId = inFlightGenerationIds.get(ownerKey);
      if (operationId) {
        dispatch(detachGeneratedCreditsOperation({ operationId }));
      }
      if (justGeneratedTimeoutRef.current) {
        clearTimeout(justGeneratedTimeoutRef.current);
        justGeneratedTimeoutRef.current = null;
      }
    };
  }, [dispatch]);

  const currentOwnerKey = getGenerationOwnerKey(currentGenerationOwner);
  const isGenerating = inFlightGenerationIdsRef.current.has(currentOwnerKey);
  const justGenerated = justGeneratedOwnerKey === currentOwnerKey;

  const previousOwnerKeyRef = useRef(currentOwnerKey);
  useEffect(() => {
    const previousOwnerKey = previousOwnerKeyRef.current;
    if (previousOwnerKey !== currentOwnerKey) {
      const previousOperationId =
        inFlightGenerationIdsRef.current.get(previousOwnerKey);
      if (previousOperationId) {
        dispatch(
          detachGeneratedCreditsOperation({
            operationId: previousOperationId,
          }),
        );
      }
      previousOwnerKeyRef.current = currentOwnerKey;
    }
  }, [currentOwnerKey, dispatch]);

  const generateFromOverlays = useCallback(async () => {
    const generationOwner = generationOwnerRef.current;
    const generationOwnerKey = getGenerationOwnerKey(generationOwner);
    if (inFlightGenerationIdsRef.current.has(generationOwnerKey)) return;
    const operationId = createGeneratedCreditOperationId();
    inFlightGenerationIdsRef.current.set(generationOwnerKey, operationId);
    setGenerationRevision((revision) => revision + 1);
    justGeneratedOperationIdRef.current = null;
    setJustGeneratedOwnerKey(null);
    if (justGeneratedTimeoutRef.current) {
      clearTimeout(justGeneratedTimeoutRef.current);
      justGeneratedTimeoutRef.current = null;
    }
    const isGenerationDatabaseCurrent = () => {
      const currentOwner = generationOwnerRef.current;
      return isMountedRef.current
        && currentOwner.db === generationOwner.db
        && currentOwner.churchId === generationOwner.churchId
        && currentOwner.databaseScopeId === generationOwner.databaseScopeId
        && currentOwner.databaseKey === generationOwner.databaseKey;
    };
    const isGenerationOwnerCurrent = () => {
      return isGenerationDatabaseCurrent()
        && generationOwnerRef.current.outlineId === generationOwner.outlineId
        && inFlightGenerationIdsRef.current.get(generationOwnerKey) === operationId;
    };

    try {
      const findParticipantOverlay = (event: string) =>
        participantOverlays.find((overlay) =>
          overlay.event?.toLowerCase().includes(event),
        );
      const participantNamesForEvent = (event: string) =>
        findParticipantOverlay(event)?.name;
      const sabbathSchoolOverlays = participantOverlays.filter((overlay) =>
        overlay.event?.toLowerCase().includes("sabbath school"),
      );
      const specialOverlays = participantOverlays.filter((overlay) =>
        overlay.event?.toLowerCase().includes("special"),
      );
      const optionalEventNameMapping: Record<string, string | undefined> = {
        "sabbath school": sabbathSchoolOverlays.some((overlay) => overlay.name !== undefined)
          ? sabbathSchoolOverlays.map((overlay) => overlay.name ?? "").join("\n").trim()
          : undefined,
        welcome: participantNamesForEvent("welcome"),
        "call to praise": participantNamesForEvent("call to praise"),
        invocation: participantNamesForEvent("invocation"),
        reading: participantNamesForEvent("reading"),
        intercessor: participantNamesForEvent("intercessor"),
        offertory: participantNamesForEvent("offertory"),
        special: specialOverlays.some((overlay) => overlay.name !== undefined)
          ? specialOverlays.map((overlay) => overlay.name ?? "").join("\n").trim()
          : undefined,
        sermon: participantNamesForEvent("sermon"),
        "behind the pulpit": participantNamesForEvent("behind the pulpit"),
      };

      let schedule: TeamScheduleCreditEntry[] = [];
      let schedulePositions: TeamScheduleCreditPosition[] = [];
      let scheduleAvailability: TeamScheduleCreditAvailability = "missing";
      if (churchId) {
        try {
          const teamsBootstrap = await getTeamsBootstrap(churchId);
          if (!teamsBootstrap || typeof teamsBootstrap !== "object") {
            scheduleAvailability = "incomplete";
          } else {
            const hasCompleteCollections =
              Array.isArray(teamsBootstrap.teams) &&
              Array.isArray(teamsBootstrap.positions) &&
              Array.isArray(teamsBootstrap.members) &&
              Array.isArray(teamsBootstrap.schedules);
            const credits = buildTeamScheduleCreditEntries({
              schedules: Array.isArray(teamsBootstrap.schedules) ? teamsBootstrap.schedules : [],
              positions: Array.isArray(teamsBootstrap.positions) ? teamsBootstrap.positions : [],
              members: Array.isArray(teamsBootstrap.members) ? teamsBootstrap.members : [],
              teams: Array.isArray(teamsBootstrap.teams) ? teamsBootstrap.teams : [],
              servicePlanKey,
            });
            schedulePositions = credits.positions;
            if (
              !hasCompleteCollections ||
              teamsBootstrap.success !== true ||
              teamsBootstrap.truncated
            ) {
              // The bootstrap only reports that some collection hit its cap, not
              // which one. Do not treat missing positions or members as unassigned.
              scheduleAvailability = "incomplete";
            } else {
              scheduleAvailability = credits.availability;
              if (credits.availability === "loaded") schedule = credits.entries;
            }
          }
        } catch (error) {
          console.error("Error generating credits from Teams schedule:", error);
          scheduleAvailability = "failed";
        }
      }

      const generatedDetails = new Map<string, GeneratedCreditDetail>();
      const scheduleMatches = resolveTeamScheduleCreditMatches(
        schedule,
        list.map(({ id, heading }) => ({ id, heading })),
      );

      let updatedList = list.map((credit, creditIndex) => {
        if (scheduleMatches.ambiguousCreditIndexes.has(creditIndex)) return credit;
        const scheduleEntryIndex = scheduleMatches.matchedEntriesByCreditIndex.get(creditIndex);
        const scheduleEntry = scheduleEntryIndex === undefined
          ? undefined
          : schedule[scheduleEntryIndex];

        if (scheduleEntry) {
          generatedDetails.set(credit.id, {
            sourceLabel: scheduleEntry.sourceLabel || "Media schedule",
            names: scheduleEntry.names,
          });
          return {
            ...credit,
            text: scheduleEntry.names,
          };
        }

        const eventKey = PARTICIPANT_EVENT_KEYS.find((key) =>
          credit.heading.toLowerCase().includes(key),
        );

        if (eventKey) {
          const names = optionalEventNameMapping[eventKey];
          if (names === undefined) return credit;
          generatedDetails.set(credit.id, {
            sourceLabel: "Participant overlays",
            names,
          });
          return {
            ...credit,
            text: names,
          };
        }

        return credit;
      });

      updatedList = updatedList.map((credit) => {
        if (!generatedDetails.has(credit.id)) return credit;
        return {
          ...credit,
          text: normalizeGeneratedCreditText(credit.text),
        };
      });

      if (scheduleAvailability === "loaded" && teamAssignments.length) {
        updatedList = updatedList.map((credit, creditIndex) => {
          if (
            scheduleMatches.matchedEntriesByCreditIndex.has(creditIndex) ||
            scheduleMatches.ambiguousCreditIndexes.has(creditIndex)
          ) return credit;
          const match = SERVICE_PLAN_CREDIT_FALLBACKS.find(
            (m) => credit.heading.toLowerCase() === m.headingMatch,
          );
          if (!match) return credit;
          const text = buildTeamCreditsText(
            teamAssignments,
            match.teamName,
            match.format,
          );
          if (text === null) return credit;
          generatedDetails.set(credit.id, {
            sourceLabel: `Service plan: ${match.teamName}`,
            names: text,
          });
          return { ...credit, text };
        });
      }

      updatedList = updatedList.map((credit) => {
        if (!generatedDetails.has(credit.id)) return credit;
        return {
          ...credit,
          text: normalizeGeneratedCreditText(credit.text),
        };
      });

      const previousCreditTextById = new Map(
        list.map((credit) => [credit.id, credit.text]),
      );
      const plannedUpdates: PlannedGeneratedCreditUpdate[] =
        updatedList.flatMap((credit) => {
          const detail = generatedDetails.get(credit.id);
          if (!detail) return [];
          return [
            {
              credit: {
                ...credit,
                generatedBaselineText: credit.text,
                generatedSource: detail.sourceLabel,
                generatedTextOverridden: false,
              },
              sourceLabel: detail.sourceLabel,
              previousText: previousCreditTextById.get(credit.id) ?? "",
            },
          ];
        });
      const ambiguousCreditItems = [...scheduleMatches.ambiguousCreditIndexes].map((creditIndex) => {
        const credit = list[creditIndex];
        const matchingHeadings = schedule
          .filter((entry) => teamScheduleCreditHeadingMatches(credit.heading, entry.heading))
          .map((entry) => entry.heading)
          .sort((left, right) => left.localeCompare(right));
        return {
          creditId: credit.id,
          creditHeading: credit.heading,
          sourceLabel: "Media schedule",
          previousText: credit.text,
          nextText: credit.text,
          status: "unmatched" as const,
          reason: matchingHeadings.length > 1
            ? `${credit.heading} matches more than one scheduled position: ${matchingHeadings.join(", ")}. No changes were made.`
            : `${credit.heading} could not be matched uniquely to a scheduled position. No changes were made.`,
        };
      });
      const ambiguousScheduleItems = [...scheduleMatches.ambiguousEntryIndexes].map((entryIndex) => {
        const entry = schedule[entryIndex];
        const matchingCredits = list.filter((credit) =>
          teamScheduleCreditHeadingMatches(credit.heading, entry.heading),
        );
        const matchingHeadings = matchingCredits
          .map((credit) => credit.heading)
          .sort((left, right) => left.localeCompare(right));
        const relatedPositionHeadings = schedule
          .filter((candidate) => matchingCredits.some((credit) =>
            teamScheduleCreditHeadingMatches(credit.heading, candidate.heading),
          ))
          .map((candidate) => candidate.heading)
          .sort((left, right) => left.localeCompare(right));
        return {
          creditId: `schedule-miss-${entry.positionId}`,
          creditHeading: entry.heading,
          sourceLabel: entry.sourceLabel || "Media schedule",
          previousText: "",
          nextText: entry.names,
          status: "unmatched" as const,
          reason: matchingHeadings.length > 1
            ? `${entry.heading} matches more than one existing credit: ${matchingHeadings.join(", ")}. No changes were made.`
            : relatedPositionHeadings.length > 1
              ? `${entry.heading} shares the heading "${matchingHeadings[0]}" with multiple scheduled positions: ${relatedPositionHeadings.join(", ")}. No changes were made.`
              : `${entry.heading} is part of an ambiguous schedule match. No changes were made.`,
        };
      });
      const matchedScheduleEntryIndexes = new Set(
        scheduleMatches.matchedEntriesByCreditIndex.values(),
      );
      const plannedCreations: PlannedGeneratedCreditCreation[] =
        schedule
          .filter((entry, entryIndex) =>
            !matchedScheduleEntryIndexes.has(entryIndex) &&
            !scheduleMatches.ambiguousEntryIndexes.has(entryIndex),
          )
          .filter((entry) => entry.names.trim())
          .map((entry) => {
            const names = normalizeGeneratedCreditText(entry.names);
            const sourceLabel = entry.sourceLabel || "Media schedule";
            return {
              credit: {
                id: getGeneratedScheduleCreditId(entry.positionId),
                heading: entry.heading,
                text: names,
                generatedBaselineText: names,
                generatedSource: sourceLabel,
                generatedTextOverridden: false,
              },
              sourceLabel,
            };
          });
      const scheduleUnavailableReason = (() => {
        switch (scheduleAvailability) {
          case "failed":
            return "The media schedule couldn't be loaded. Credits based on that schedule were left unchanged. Check it in Teams, then generate again.";
          case "incomplete":
            return "Teams schedule information is incomplete. Schedule-based credits were left unchanged. Check it in Teams, then generate again.";
          case "unhydrated":
            return "This service's media schedule hasn't loaded. Credits based on that schedule were left unchanged. Open it in Teams, then generate again.";
          case "missing":
            return "No matching media schedule was found. Schedule-based credits were left unchanged. Check the schedule in Teams, then generate again.";
          default:
            return "Schedule-based credits were left unchanged because schedule information isn't available.";
        }
      })();
      const unavailableScheduleEntries = schedulePositions.map((position) => ({
        ...position,
        names: "",
        sourceLabel: "Media schedule",
      }));
      const unavailableScheduleMatches = resolveTeamScheduleCreditMatches(
        unavailableScheduleEntries,
        list.map(({ id, heading }) => ({ id, heading })),
      );
      const scheduleSourceCreditIndexes = new Set<number>(
        scheduleAvailability === "loaded"
          ? []
          : [
            ...unavailableScheduleMatches.matchedEntriesByCreditIndex.keys(),
            ...unavailableScheduleMatches.ambiguousCreditIndexes,
          ],
      );
      list.forEach((credit, creditIndex) => {
        if (
          credit.generatedSource?.toLowerCase().startsWith("media schedule") ||
          credit.id.startsWith("generated-schedule-") ||
          ["band", "worship coordinators", "praise team"].includes(credit.heading.toLowerCase())
        ) {
          if (scheduleAvailability !== "loaded") scheduleSourceCreditIndexes.add(creditIndex);
        }
      });
      list.forEach((credit, creditIndex) => {
        if (generatedDetails.get(credit.id)?.sourceLabel === "Participant overlays") {
          scheduleSourceCreditIndexes.delete(creditIndex);
        }
      });
      const skippedScheduleCredits = [...scheduleSourceCreditIndexes].map((creditIndex) => {
        const credit = list[creditIndex];
        return {
          creditId: `schedule-skipped-credit-${credit.id}`,
          creditHeading: credit.heading,
          sourceLabel: "Media schedule",
          previousText: credit.text,
          nextText: credit.text,
          status: "skipped" as const,
          reason: scheduleUnavailableReason,
        };
      });
      const representedUnavailablePositions = new Set(
        unavailableScheduleMatches.matchedEntriesByCreditIndex.values(),
      );
      const skippedSchedulePositions = scheduleAvailability === "loaded"
        ? []
        : unavailableScheduleEntries.flatMap((entry, entryIndex) => {
          if (
            representedUnavailablePositions.has(entryIndex) ||
            unavailableScheduleMatches.ambiguousEntryIndexes.has(entryIndex)
          ) return [];
          return [{
            creditId: `schedule-skipped-${entry.positionId}`,
            creditHeading: entry.heading,
            sourceLabel: "Media schedule",
            previousText: "",
            nextText: "",
            status: "skipped" as const,
            reason: scheduleUnavailableReason,
          }];
        });
      const skippedImportedFallbacks = scheduleAvailability === "loaded"
        ? []
        : SERVICE_PLAN_CREDIT_FALLBACKS.flatMap(({ heading, headingMatch, teamName, format }) => {
          if (
            list.some((credit) => credit.heading.toLowerCase() === headingMatch) ||
            unavailableScheduleEntries.some((entry) => entry.heading.toLowerCase() === headingMatch) ||
            buildTeamCreditsText(teamAssignments, teamName, format) === null
          ) return [];
          return [{
            creditId: `schedule-skipped-import-${heading.toLowerCase().replace(/\s+/g, "-")}`,
            creditHeading: heading,
            sourceLabel: "Service plan assignments",
            previousText: "",
            nextText: "",
            status: "skipped" as const,
            reason: scheduleUnavailableReason,
          }];
        });
      const unmatchedOverlayItems = list.flatMap((credit, creditIndex) => {
        const eventKey = PARTICIPANT_EVENT_KEYS.find((key) =>
          credit.heading.toLowerCase().includes(key),
        );
        if (!eventKey || generatedDetails.has(credit.id) ||
          scheduleMatches.ambiguousCreditIndexes.has(creditIndex) ||
          scheduleSourceCreditIndexes.has(creditIndex) ||
          optionalEventNameMapping[eventKey] !== undefined) return [];
        return [{
          creditId: credit.id,
          creditHeading: credit.heading,
          sourceLabel: "Participant overlays",
          previousText: credit.text,
          nextText: "",
          status: "unmatched" as const,
        }];
      });

      if (isGenerationOwnerCurrent()) dispatch(
        startGeneratedCredits({
          operationId,
          owner: {
            churchId: generationOwner.churchId,
            databaseKey: generationOwner.databaseKey,
            databaseScopeId: generationOwner.databaseScopeId,
            databaseInstanceId: generationOwner.databaseInstanceId,
            outlineId: generationOwner.outlineId,
          },
          generatedAt: new Date().toISOString(),
          items: [
            ...plannedUpdates.map(({ credit, previousText, sourceLabel }) => ({
              creditId: credit.id,
              creditHeading: credit.heading,
              sourceLabel,
              previousText,
              nextText: credit.text,
            })),
            ...plannedCreations.map(({ credit, sourceLabel }) => ({
              creditId: credit.id,
              creditHeading: credit.heading,
              sourceLabel,
              previousText: "",
              nextText: credit.text,
              status: "creating" as const,
            })),
            ...ambiguousCreditItems,
            ...ambiguousScheduleItems,
            ...skippedScheduleCredits,
            ...skippedSchedulePositions,
            ...skippedImportedFallbacks,
            ...unmatchedOverlayItems,
          ],
          warning: scheduleAvailability === "loaded" ? null : scheduleUnavailableReason,
        }),
      );

      const docsToBroadcast: Array<
        GeneratedCreditWriteResult["doc"]
        | NonNullable<GeneratedCreditWriteResult["indexDoc"]>
      > = [];
      let hadPersistenceError = false;
      for (const { credit, previousText } of plannedUpdates) {
        dispatch(setGeneratedCreditActive({ operationId, creditId: credit.id }));
        if (isGenerationOwnerCurrent()) {
          dispatch(selectCredit(credit.id));
        }
        await waitForCreditGenerationStep();

        const latestCredit = store.getState().undoable.present.credits.list.find(
          (candidate: CreditsInfo) => candidate.id === credit.id,
        );
        const hasChanged = (latestCredit?.text ?? previousText) !== credit.text;
        const hasMetadataChange = latestCredit?.generatedBaselineText !== credit.generatedBaselineText
          || latestCredit?.generatedSource !== credit.generatedSource
          || latestCredit?.generatedTextOverridden !== false;
        let textChangedInDatabase = false;

        if (!db || !outlineIdForCredits) {
          if (hasChanged || hasMetadataChange) {
            hadPersistenceError = true;
            dispatch(
              failGeneratedCreditItem({
                operationId,
                creditId: credit.id,
                error: creditSaveFailureMessage(),
              }),
            );
            continue;
          }
        } else {
          try {
            const result = await putGeneratedCreditDoc(db, outlineIdForCredits, {
              id: credit.id,
              text: credit.text,
              generatedSource: credit.generatedSource,
            });
            if (!result) {
              hadPersistenceError = true;
              dispatch(
                failGeneratedCreditItem({
                  operationId,
                  creditId: credit.id,
                error: creditSaveFailureMessage(),
                }),
              );
              continue;
            }
            textChangedInDatabase = result.textChanged;
            if (result.changed) docsToBroadcast.push(result.doc);
          } catch (error) {
            hadPersistenceError = true;
            dispatch(
              failGeneratedCreditItem({
                operationId,
                creditId: credit.id,
                error: creditSaveFailureMessage(
                  error instanceof Error && error.message.trim()
                    ? error.message
                    : undefined,
                ),
              }),
            );
            continue;
          }
        }

        if (isGenerationOwnerCurrent()) {
          const latestCreditAfterSave = store.getState().undoable.present.credits.list.find(
            (candidate: CreditsInfo) => candidate.id === credit.id,
          );
          dispatch(updateCreditFromGeneration({
            ...(latestCreditAfterSave ?? credit),
            text: credit.text,
            generatedBaselineText: credit.text,
            generatedSource: credit.generatedSource || "Generated credits",
            generatedTextOverridden: false,
          }));
        }
        dispatch(
          completeGeneratedCreditItem({
            operationId,
            creditId: credit.id,
            status: textChangedInDatabase ? "updated" : "unchanged",
          }),
        );
      }

      for (const { credit } of plannedCreations) {
        dispatch(setGeneratedCreditActive({ operationId, creditId: credit.id }));
        await waitForCreditGenerationStep();

        if (!db || !outlineIdForCredits) {
          hadPersistenceError = true;
          dispatch(failGeneratedCreditItem({
            operationId,
            creditId: credit.id,
            error: creditSaveFailureMessage(),
          }));
          continue;
        }

        try {
          const result = await putGeneratedCreditDoc(db, outlineIdForCredits, {
            id: credit.id,
            heading: credit.heading,
            text: credit.text,
            generatedSource: credit.generatedSource,
            createIfMissing: true,
          });
          if (!result) {
            hadPersistenceError = true;
            dispatch(failGeneratedCreditItem({
              operationId,
              creditId: credit.id,
              error: creditSaveFailureMessage(),
            }));
            continue;
          }

          if (result.changed || result.addedToIndex) docsToBroadcast.push(result.doc);
          if (result.indexDoc) docsToBroadcast.push(result.indexDoc);

          if (isGenerationOwnerCurrent()) {
            const latestCredits = store.getState().undoable.present.credits.list;
            const latestCredit = latestCredits.find(
              (candidate: CreditsInfo) => candidate.id === credit.id,
            );
            const generatedFields = {
              text: credit.text,
              generatedBaselineText: credit.text,
              generatedSource: credit.generatedSource,
              generatedTextOverridden: false as const,
            };

            if (latestCredit) {
              dispatch(updateCreditFromGeneration({
                ...latestCredit,
                ...generatedFields,
              }));
            } else {
              const lastCredit = latestCredits[latestCredits.length - 1];
              if (lastCredit) dispatch(selectCredit(lastCredit.id));
              dispatch(addCredit({
                id: credit.id,
                heading: result.doc.heading ?? credit.heading,
                ...(result.doc.hidden === undefined ? {} : { hidden: result.doc.hidden }),
                ...generatedFields,
              }));
            }
          }

          dispatch(completeGeneratedCreditItem({
            operationId,
            creditId: credit.id,
            status: result.addedToIndex || result.creditDocCreated
              ? "created"
              : result.textChanged
                ? "updated"
                : "unchanged",
          }));
        } catch (error) {
          hadPersistenceError = true;
          dispatch(failGeneratedCreditItem({
            operationId,
            creditId: credit.id,
            error: creditSaveFailureMessage(
              error instanceof Error && error.message.trim()
                ? error.message
                : undefined,
            ),
          }));
        }
      }

      // This helper posts through the active BroadcastChannel, which may have switched churches
      // while the captured PouchDB write was in flight.
      if (docsToBroadcast.length > 0 && isGenerationDatabaseCurrent()) {
        broadcastCreditsUpdate(docsToBroadcast);
      }

      if (isGenerationOwnerCurrent()) {
        await flushCreditsHistoryFromLatestList(
          dispatch,
          () => store.getState(),
          db,
        );
      }

      if (hadPersistenceError) {
        dispatch(failGeneratedCredits({ operationId, error: "Some credits could not be saved." }));
      } else {
        dispatch(completeGeneratedCredits({ operationId }));
      }

      if (isGenerationOwnerCurrent()) {
        justGeneratedOperationIdRef.current = operationId;
        setJustGeneratedOwnerKey(generationOwnerKey);
        justGeneratedTimeoutRef.current = setTimeout(() => {
          justGeneratedTimeoutRef.current = null;
          if (justGeneratedOperationIdRef.current === operationId) {
            justGeneratedOperationIdRef.current = null;
            setJustGeneratedOwnerKey(null);
          }
        }, 2000);
      }
    } catch (error) {
      console.error("Error generating from overlays:", error);
    } finally {
      if (inFlightGenerationIdsRef.current.get(generationOwnerKey) === operationId) {
        inFlightGenerationIdsRef.current.delete(generationOwnerKey);
        if (isMountedRef.current) {
          setGenerationRevision((revision) => revision + 1);
        }
      }
    }
  }, [
    participantOverlays,
    list,
    dispatch,
    churchId,
    db,
    outlineIdForCredits,
    teamAssignments,
    servicePlanKey,
  ]);

  return {
    generateFromOverlays,
    isGenerating,
    justGenerated,
    hasOverlays:
      overlays.length > 0 || Boolean(churchId) || teamAssignments.length > 0,
  };
}
