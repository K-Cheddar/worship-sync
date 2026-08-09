import type { MyScheduleOccurrence, MySchedulePlan } from "../api/auth";
import type { PublicServiceFlowSnapshot } from "../services/serviceFlowTypes";

/**
 * A static snapshot shaped like the public detailed (team) service page, built
 * from the stripped plan payload on My Schedule. Used when share links are not
 * enabled yet — same detailed chrome, without notes, mics, or live progress.
 */
export const buildMyScheduleServiceFlowSnapshot = ({
  occurrence,
  plan,
  churchName = "",
  churchLogoUrl = "",
}: {
  occurrence: MyScheduleOccurrence;
  plan: MySchedulePlan;
  churchName?: string;
  churchLogoUrl?: string;
}): PublicServiceFlowSnapshot => {
  const startsAt =
    occurrence.startsAt ||
    (occurrence.date
      ? `${occurrence.date}T12:00:00.000Z`
      : new Date().toISOString());

  return {
    success: true,
    churchName,
    ...(churchLogoUrl ? { churchLogoUrl } : {}),
    serverNowMs: Date.now(),
    service: {
      shareId: `my-schedule:${occurrence.occurrenceId}`,
      // Match the detailed/team public link, not the simple/general view.
      viewMode: "team",
      title: plan.name || occurrence.name || "Order of service",
      startsAt,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      revision: 0,
      sections: plan.sections.map((section, sectionIndex) => ({
        id: `section-${sectionIndex}`,
        title: section.name || "",
        items: section.elements.map((element, elementIndex) => ({
          id: `item-${sectionIndex}-${elementIndex}`,
          title: element.title || "Untitled item",
          durationSeconds: element.durationSeconds || 0,
          notes: { blocks: [] },
        })),
      })),
      live: { mode: "schedule" },
    },
  };
};
