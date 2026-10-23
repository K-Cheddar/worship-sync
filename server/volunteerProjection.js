const copyIfDefined = (source, target, fields) => {
  fields.forEach((field) => {
    if (source?.[field] !== undefined) target[field] = source[field];
  });
  return target;
};

const projectBlockout = (range) =>
  copyIfDefined(range, {}, ["startDate", "endDate", "notes"]);

const projectPlan = (plan) => {
  if (!plan) return null;
  return {
    ...(plan.name !== undefined ? { name: plan.name } : {}),
    ...(plan.published !== undefined ? { published: plan.published } : {}),
    sections: (Array.isArray(plan.sections) ? plan.sections : []).map((section) => ({
      name: section?.name,
      elements: (Array.isArray(section?.elements) ? section.elements : []).map((element) =>
        copyIfDefined(element, {}, ["type", "title", "startTime", "durationSeconds"]),
      ),
    })),
  };
};

/**
 * Explicit allowlist for a future personal-link response. This is intentionally
 * not wired to a route yet; the signed-in My Schedule response keeps its
 * existing contract, including its current own-member fields and plan URLs.
 */
export const projectVolunteerScheduleForPersonalAccess = ({
  serviceTimeZone,
  member,
  occurrences,
} = {}) => ({
  success: true,
  ...(serviceTimeZone !== undefined ? { serviceTimeZone } : {}),
  member: member
    ? {
        firstName: member.firstName || "",
        lastName: member.lastName || "",
        updatedAt: member.updatedAt || "",
        blockoutDates: (Array.isArray(member.blockoutDates) ? member.blockoutDates : [])
          .map(projectBlockout),
      }
    : null,
  occurrences: (Array.isArray(occurrences) ? occurrences : []).map((occurrence) => ({
    ...copyIfDefined(occurrence, {}, [
      "occurrenceId", "serviceIds", "name", "date", "startsAt",
    ]),
    serving: (Array.isArray(occurrence?.serving) ? occurrence.serving : []).map((row) =>
      row?.isMe
        ? copyIfDefined(row, { isMe: true }, [
            "name", "scheduleId", "teamName", "positionName", "positionId",
            "columnKey", "isPrimary", "response", "respondedAt",
          ])
        : { name: String(row?.name || ""), isMe: false },
    ),
    ...(occurrence?.plan ? { plan: projectPlan(occurrence.plan) } : {}),
  })),
});
