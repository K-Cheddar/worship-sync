import { useCallback, useContext, useMemo, useState } from "react";
import { useDispatch, useSelector } from "../hooks";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import { putCreditDoc } from "../utils/dbUtils";
import { getTeamsBootstrap } from "../api/auth";
import { selectCredit, updateCredit } from "../store/creditsSlice";
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
const CREDIT_GENERATION_STEP_DELAY_MS = 350;

type GeneratedCreditDetail = {
  sourceLabel: string;
  names: string;
};

type PlannedGeneratedCreditUpdate = {
  credit: CreditsInfo;
  previousText: string;
  sourceLabel: string;
};

const waitForCreditGenerationStep = () =>
  new Promise((resolve) => setTimeout(resolve, CREDIT_GENERATION_STEP_DELAY_MS));

const normalizeGeneratedCreditText = (text: string) =>
  text
    .split(/,|&/)
    .map((item: string) => item.trim())
    .join("\n");

function praiseTeamSortKey(role: string): number {
  const normalized = role.replace(/\s+Singer$/i, "").trim().toLowerCase();
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
  const { list } = useSelector(
    (state) => state.undoable.present.credits,
  );
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
      state.servicePlanningImport?.serviceOutline?.preview.teamAssignments ?? [],
  );

  const [isGenerating, setIsGenerating] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);

  const generateFromOverlays = useCallback(async () => {
    setIsGenerating(true);
    try {
      const eventNameMapping: { [key: string]: string } = {
        "sabbath school": participantOverlays
          .filter((overlay) =>
            overlay.event?.toLowerCase().includes("sabbath school"),
          )
          .map((overlay) => overlay.name)
          .join("\n")
          .trim(),
        welcome:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("welcome"),
          )?.name || "",
        "call to praise":
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("call to praise"),
          )?.name || "",
        invocation:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("invocation"),
          )?.name || "",
        reading:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("reading"),
          )?.name || "",
        intercessor:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("intercessor"),
          )?.name || "",
        offertory:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("offertory"),
          )?.name || "",
        special: participantOverlays
          .filter((overlay) => overlay.event?.toLowerCase().includes("special"))
          .map((overlay) => overlay.name)
          .join("\n")
          .trim(),
        sermon:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("sermon"),
          )?.name || "",
      };

      let schedule: TeamScheduleCreditEntry[] = [];
      let scheduleError: string | null = null;
      if (churchId) {
        try {
          const teamsBootstrap = await getTeamsBootstrap(churchId);
          schedule = buildTeamScheduleCreditEntries({
            schedules: teamsBootstrap.schedules || [],
            positions: teamsBootstrap.positions || [],
            members: teamsBootstrap.members || [],
            teams: teamsBootstrap.teams || [],
          });
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

        const eventKey = Object.keys(eventNameMapping).find((key) =>
          credit.heading.toLowerCase().includes(key),
        );

        if (eventKey) {
          const names = eventNameMapping[eventKey];
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
          { headingMatch: "worship coordinators", teamName: "Coordinators", format: "name-only" },
          { headingMatch: "praise team", teamName: "Praise Team", format: "role-name" },
        ];

        updatedList = updatedList.map((credit) => {
          const match = teamCreditMap.find(
            (m) => credit.heading.toLowerCase() === m.headingMatch,
          );
          if (!match) return credit;
          const text = buildTeamCreditsText(teamAssignments, match.teamName, match.format);
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
      const plannedUpdates: PlannedGeneratedCreditUpdate[] = updatedList.flatMap((credit) => {
        const detail = generatedDetails.get(credit.id);
        if (!detail) return [];
        return [
          {
            credit,
            sourceLabel: detail.sourceLabel,
            previousText: previousCreditTextById.get(credit.id) ?? "",
          },
        ];
      });
      const missedScheduleItems = schedule
        .filter((entry) => !matchedScheduleEntries.has(entry))
        .map((entry, index) => ({
          creditId: `schedule-miss-${index}-${entry.heading}`,
          creditHeading: entry.heading,
          sourceLabel: entry.sourceLabel || "Media schedule",
          previousText: "",
          nextText: entry.names,
          status: "missed" as const,
        }));

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
            ...missedScheduleItems,
          ],
          warning: scheduleError
            ? "Media schedule was unavailable. Other sources will still be applied."
            : null,
        }),
      );

      const docsToBroadcast: NonNullable<Awaited<ReturnType<typeof putCreditDoc>>>[] = [];
      let hadPersistenceError = false;
      for (const { credit, previousText } of plannedUpdates) {
        dispatch(setGeneratedCreditActive(credit.id));
        dispatch(selectCredit(credit.id));
        await waitForCreditGenerationStep();

        const hasChanged = previousText !== credit.text;
        if (hasChanged) {
          dispatch(updateCredit(credit));
        }

        if (db && outlineIdForCredits && hasChanged) {
          try {
            const doc = await putCreditDoc(db, outlineIdForCredits, credit);
            if (doc) docsToBroadcast.push(doc);
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

        dispatch(
          completeGeneratedCreditItem({
            creditId: credit.id,
            status: hasChanged ? "updated" : "current",
          }),
        );
      }

      if (docsToBroadcast.length > 0) {
        broadcastCreditsUpdate(docsToBroadcast);
      }

      await flushCreditsHistoryFromLatestList(
        dispatch,
        () => store.getState(),
        db,
      );

      if (hadPersistenceError) {
        dispatch(failGeneratedCredits("Some credits could not be saved."));
      } else {
        dispatch(completeGeneratedCredits());
      }

      setJustGenerated(true);
      setTimeout(() => setJustGenerated(false), 2000);
    } catch (error) {
      console.error("Error generating from overlays:", error);
    } finally {
      setIsGenerating(false);
    }
  }, [
    participantOverlays,
    list,
    dispatch,
    churchId,
    db,
    outlineIdForCredits,
    teamAssignments,
  ]);

  return {
    generateFromOverlays,
    isGenerating,
    justGenerated,
    hasOverlays: overlays.length > 0 || Boolean(churchId) || teamAssignments.length > 0,
  };
}
