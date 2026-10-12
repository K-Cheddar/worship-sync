import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "../hooks";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import { putGeneratedCreditDoc } from "../utils/dbUtils";
import { getTeamsBootstrap } from "../api/auth";
import { selectCredit, updateCreditFromGeneration } from "../store/creditsSlice";
import {
  completeGeneratedCreditItem,
  completeGeneratedCredits,
  failGeneratedCreditItem,
  failGeneratedCredits,
  setGeneratedCreditActive,
  startGeneratedCredits,
} from "../store/generatedCreditsSlice";
import store, { broadcastCreditsUpdate } from "../store/store";
import { flushCreditsHistoryFromLatestList } from "../utils/creditsHistoryFlush";
import type { ServicePlanningTeamAssignment } from "../types/servicePlanningImport";
import type { CreditsInfo } from "../types";
import {
  buildTeamScheduleCreditEntries,
  findTeamScheduleCreditEntryForHeading,
  type TeamScheduleCreditEntry,
} from "../utils/teamScheduleCredits";

const PRAISE_TEAM_ROLE_ORDER = ["worship leader", "soprano", "alto", "tenor"];
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
  const generationOwnerRef = useRef({ db, churchId, outlineId: outlineIdForCredits });
  generationOwnerRef.current = { db, churchId, outlineId: outlineIdForCredits };
  const isMountedRef = useRef(false);
  const justGeneratedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (justGeneratedTimeoutRef.current) {
        clearTimeout(justGeneratedTimeoutRef.current);
        justGeneratedTimeoutRef.current = null;
      }
    };
  }, []);

  const [isGenerating, setIsGenerating] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);

  const generateFromOverlays = useCallback(async () => {
    const generationOwner = generationOwnerRef.current;
    const isGenerationDatabaseCurrent = () => {
      const currentOwner = generationOwnerRef.current;
      return isMountedRef.current
        && currentOwner.db === generationOwner.db
        && currentOwner.churchId === generationOwner.churchId;
    };
    const isGenerationOwnerCurrent = () => {
      return isGenerationDatabaseCurrent()
        && generationOwnerRef.current.outlineId === generationOwner.outlineId;
    };

    setIsGenerating(true);
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
      let scheduleLoaded = false;
      let scheduleError: string | null = null;
      // The bootstrap only hydrates schedules around today. A service outside
      // that window comes back as a summary, and generating from it would write
      // blank credits that read exactly like an unstaffed service.
      let scheduleUnavailable = false;
      if (churchId) {
        try {
          const teamsBootstrap = await getTeamsBootstrap(churchId);
          const credits = buildTeamScheduleCreditEntries({
            schedules: teamsBootstrap.schedules || [],
            positions: teamsBootstrap.positions || [],
            members: teamsBootstrap.members || [],
            teams: teamsBootstrap.teams || [],
            servicePlanKey,
          });
          schedule = credits.entries;
          scheduleUnavailable = credits.scheduleUnavailable;
          scheduleLoaded = credits.scheduleLoaded;
        } catch (error) {
          console.error("Error generating credits from Teams schedule:", error);
          scheduleError =
            error instanceof Error && error.message.trim()
              ? error.message
              : "Could not load Teams schedule.";
        }
      }

      const generatedDetails = new Map<string, GeneratedCreditDetail>();
      const matchedScheduleEntries = new Set<TeamScheduleCreditEntry>();

      let updatedList = list.map((credit) => {
        const scheduleEntry = findTeamScheduleCreditEntryForHeading(
          schedule,
          credit.heading,
        );

        if (scheduleEntry) {
          matchedScheduleEntries.add(scheduleEntry);
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

      if (teamAssignments.length) {
        const teamCreditMap: Array<{
          headingMatch: string;
          teamName: string;
          format: "role-name" | "name-only";
        }> = [
          { headingMatch: "band", teamName: "Band", format: "role-name" },
          {
            headingMatch: "worship coordinators",
            teamName: "Coordinators",
            format: "name-only",
          },
          {
            headingMatch: "praise team",
            teamName: "Praise Team",
            format: "role-name",
          },
        ];

        updatedList = updatedList.map((credit) => {
          const match = teamCreditMap.find(
            (m) => credit.heading.toLowerCase() === m.headingMatch,
          );
          if (!match) return credit;
          // A matching Teams schedule row is authoritative, including an empty row.
          if (scheduleLoaded && findTeamScheduleCreditEntryForHeading(schedule, credit.heading)) return credit;
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
      const unmatchedScheduleItems = schedule
        .filter((entry) => !matchedScheduleEntries.has(entry))
        .filter((entry) => entry.names.trim())
        .map((entry, index) => ({
          creditId: `schedule-miss-${index}-${entry.heading}`,
          creditHeading: entry.heading,
          sourceLabel: entry.sourceLabel || "Media schedule",
          previousText: "",
          nextText: entry.names,
          status: "unmatched" as const,
        }));
      const unmatchedOverlayItems = list.flatMap((credit) => {
        const eventKey = PARTICIPANT_EVENT_KEYS.find((key) =>
          credit.heading.toLowerCase().includes(key),
        );
        if (!eventKey || generatedDetails.has(credit.id)
          || optionalEventNameMapping[eventKey] !== undefined) return [];
        return [{
          creditId: credit.id,
          creditHeading: credit.heading,
          sourceLabel: "Participant overlays",
          previousText: credit.text,
          nextText: "",
          status: "unmatched" as const,
        }];
      });

      dispatch(
        startGeneratedCredits({
          generatedAt: new Date().toISOString(),
          items: [
            ...plannedUpdates.map(({ credit, previousText, sourceLabel }) => ({
              creditId: credit.id,
              creditHeading: credit.heading,
              sourceLabel,
              previousText,
              nextText: credit.text,
            })),
            ...unmatchedScheduleItems,
            ...unmatchedOverlayItems,
          ],
          warning: scheduleError
            ? "Media schedule was unavailable. Other sources will still be applied."
            : scheduleUnavailable
              ? "This service's media schedule hasn't loaded, so its names were left out. Open it in Teams first, then generate again."
              : null,
        }),
      );

      const docsToBroadcast: NonNullable<
        Awaited<ReturnType<typeof putGeneratedCreditDoc>>
      >["doc"][] = [];
      let hadPersistenceError = false;
      for (const { credit, previousText } of plannedUpdates) {
        dispatch(setGeneratedCreditActive(credit.id));
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
                creditId: credit.id,
                error: "Could not save this credit.",
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
                  creditId: credit.id,
                  error: "Could not save this credit.",
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
                creditId: credit.id,
                error:
                  error instanceof Error && error.message.trim()
                    ? error.message
                    : "Could not save this credit.",
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
            creditId: credit.id,
            status: textChangedInDatabase ? "updated" : "unchanged",
          }),
        );
      }

      // This helper posts through the active BroadcastChannel, which may have switched churches
      // while the captured PouchDB write was in flight.
      if (docsToBroadcast.length > 0 && isGenerationDatabaseCurrent()) {
        broadcastCreditsUpdate(docsToBroadcast);
      }

      if (isGenerationDatabaseCurrent()) {
        await flushCreditsHistoryFromLatestList(
          dispatch,
          () => store.getState(),
          db,
        );
      }

      if (hadPersistenceError) {
        dispatch(failGeneratedCredits("Some credits could not be saved."));
      } else {
        dispatch(completeGeneratedCredits());
      }

      if (isMountedRef.current) {
        setJustGenerated(true);
        justGeneratedTimeoutRef.current = setTimeout(() => {
          justGeneratedTimeoutRef.current = null;
          if (isMountedRef.current) setJustGenerated(false);
        }, 2000);
      }
    } catch (error) {
      console.error("Error generating from overlays:", error);
    } finally {
      if (isMountedRef.current) setIsGenerating(false);
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
