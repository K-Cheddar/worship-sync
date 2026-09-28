const PERSONALIZED_RESPONSE_FIELDS = new Set([
  "positions",
  "availability",
  "schedulingPreferences",
  "recurringAvailability",
  "schedulingFrequency",
  "blockoutDates",
  "notes",
]);

export const hasPersonalizedIntakeResponseFields = (enabledFields, availabilityOccurrences = []) => {
  const fields = Array.isArray(enabledFields)
    ? enabledFields
    : ["positions", "availability", "blockoutDates", "notes"];
  return fields.some((field) => {
    if (!PERSONALIZED_RESPONSE_FIELDS.has(field)) return false;
    if (field !== "availability") return true;
    return Array.isArray(availabilityOccurrences) && availabilityOccurrences.length > 0;
  });
};

export const intakeFormCollectsServiceAvailability = (enabledFields, availabilityOccurrences = []) =>
  Array.isArray(enabledFields) && enabledFields.includes("availability") &&
  Array.isArray(availabilityOccurrences) && availabilityOccurrences.length > 0;
