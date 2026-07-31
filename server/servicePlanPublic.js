import { normalizeRichTextDocument } from "./serviceFlowService.js";

const richTextToPlainText = (document) =>
  (document?.blocks || [])
    .map((block) =>
      (block?.spans || []).map((span) => span?.text || "").join(""),
    )
    .join("\n")
    .trim();

const getDurationSeconds = (seconds, minutes) => {
  const value = Number(seconds);
  if (Number.isFinite(value) && value > 0) return Math.round(value);
  const minuteValue = Number(minutes);
  return Number.isFinite(minuteValue) && minuteValue > 0
    ? Math.round(minuteValue * 60)
    : 0;
};

const normalizeTimezone = (value) => {
  const timezone = String(value || "").trim();
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "UTC";
  }
};

const serializePublicTeamNotes = (teamNotes) =>
  (Array.isArray(teamNotes) ? teamNotes : [])
    .map((teamNote) => {
      const label = String(teamNote?.label || "").trim();
      const notes = normalizeRichTextDocument(teamNote?.note);
      const isRoleNote = teamNote?.scope === "role";
      const positionId = String(teamNote?.positionId || "").trim();
      const teamId = String(teamNote?.teamId || "").trim();
      const teamName = String(teamNote?.teamName || "").trim();
      if (isRoleNote && !positionId) return null;
      return label && notes.blocks.length
        ? {
            label,
            notes,
            ...(isRoleNote
              ? {
                  scope: "role",
                  positionId,
                  ...(teamId ? { teamId } : {}),
                  ...(teamName ? { teamName } : {}),
                }
              : {}),
          }
        : null;
    })
    .filter(Boolean);

/**
 * The serving (detailed) projection includes viewer-selectable team notes and
 * assignee credits. The general (simple) projection is deliberately built
 * without any operational notes, so a broadly shared link cannot reveal them
 * through the client. Assignee credits remain on both views.
 */
export const buildPublicServicePlanSnapshot = ({
  plan,
  churchName = "",
  churchLogoUrl = "",
  churchPrimaryColor = "",
  churchSecondaryColor = "",
  serverNowMs = Date.now(),
  viewMode = "team",
  shareId,
}) => {
  if (!plan?.published || !plan.publicLinkToken || !plan.startsAt) return null;
  const startsAtMs = Date.parse(plan.startsAt);
  if (Number.isNaN(startsAtMs)) return null;

  const itemIds = new Set(
    (plan.sections || []).flatMap((section) =>
      (section.elements || []).map((element) => element.id),
    ),
  );
  const anchoredStartsAtMs = Date.parse(
    String(plan.publicLive?.startedAt || ""),
  );
  const live =
    plan.publicLive?.mode === "anchored" &&
    itemIds.has(plan.publicLive.currentElementId) &&
    Number.isFinite(anchoredStartsAtMs)
      ? {
          mode: "anchored",
          currentItemId: plan.publicLive.currentElementId,
          startedAt: new Date(anchoredStartsAtMs).toISOString(),
        }
      : plan.publicLive?.mode === "manual" &&
          itemIds.has(plan.publicLive.currentElementId)
        ? { mode: "manual", currentItemId: plan.publicLive.currentElementId }
        : { mode: "schedule" };

  const isGeneralView = viewMode === "general";
  const publicShareId = String(
    shareId ||
      (isGeneralView ? plan.publicGeneralLinkToken : plan.publicLinkToken) ||
      "",
  ).trim();
  if (!publicShareId) return null;

  const primaryColor = String(churchPrimaryColor || "").trim();
  const secondaryColor = String(churchSecondaryColor || "").trim();

  return {
    success: true,
    churchName: String(churchName || "").trim(),
    ...(String(churchLogoUrl || "").trim()
      ? { churchLogoUrl: String(churchLogoUrl).trim() }
      : {}),
    ...(primaryColor ? { churchPrimaryColor: primaryColor } : {}),
    ...(secondaryColor ? { churchSecondaryColor: secondaryColor } : {}),
    serverNowMs,
    service: {
      shareId: publicShareId,
      viewMode: isGeneralView ? "general" : "team",
      title: String(plan.name || "Service").trim() || "Service",
      startsAt: new Date(startsAtMs).toISOString(),
      timezone: normalizeTimezone(plan.timezone),
      revision: Date.parse(plan.updatedAt || "") || 0,
      sections: (plan.sections || []).map((section, sectionIndex) => ({
        id: String(section.id || `section-${sectionIndex + 1}`),
        title: String(section.name || "").trim(),
        items: (section.elements || []).map((element, elementIndex) => ({
          id: String(
            element.id || `item-${sectionIndex + 1}-${elementIndex + 1}`,
          ),
          title: richTextToPlainText(element.title) || "Untitled item",
          durationSeconds: getDurationSeconds(
            element.durationSeconds,
            element.durationMinutes,
          ),
          notes: isGeneralView
            ? { blocks: [] }
            : normalizeRichTextDocument(element.notes),
          teamNotes: isGeneralView
            ? []
            : serializePublicTeamNotes(element.teamNotes),
          ...(String(element.assignedName || "").trim()
            ? { creditName: String(element.assignedName).trim() }
            : {}),
        })),
      })),
      live,
    },
  };
};
