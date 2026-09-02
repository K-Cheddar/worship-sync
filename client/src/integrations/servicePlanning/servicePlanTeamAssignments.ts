/**
 * Sources the Controller's "who's serving" list from the Teams schedule rather
 * than from a scraped planning printout.
 *
 * A saved ServicePlan carries no roster, so a plan-sourced preview would
 * otherwise show an empty Assignments tab. Reusing the schedule means the tab
 * reflects the actual roster — including changes made after the plan was
 * imported — rather than a snapshot frozen at scrape time.
 *
 * Required-but-unfilled slots are dropped: this tab answers "who is serving",
 * and the Teams scheduling grid is where gaps belong.
 */
import type { TeamsAssignmentSummaryRow } from "../../pages/Teams/pages/teamsAssignmentsSummary";
import type { ServicePlanningTeamAssignment } from "../../types/servicePlanningImport";

export const toServicePlanningTeamAssignments = (
  rows: TeamsAssignmentSummaryRow[],
): ServicePlanningTeamAssignment[] =>
  rows.flatMap((row) =>
    row.memberName
      ? [
          {
            teamName: row.teamName,
            role: row.slotLabel,
            name: row.memberName,
            ...(row.memberProfileImageUrl
              ? { profileImageUrl: row.memberProfileImageUrl }
              : {}),
          },
        ]
      : [],
  );
