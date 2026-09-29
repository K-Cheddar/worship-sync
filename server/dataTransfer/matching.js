import { portableServiceGroupLabel } from "./schemas.js";

export const normalizePortableMatchValue = (value) =>
  String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");

export const findPortableMatch = ({ records, id, idField, label, includeArchived = false }) => {
  if (id) {
    const match = records.find((record) => record[idField] === id);
    if (match) return { record: match, method: "id", archived: Boolean(match.archivedAt) };
    // An explicit portable identity is authoritative. Falling through to a
    // label match can silently update an unrelated record in another church.
    return { record: null, candidates: [], foreignOrUnknownId: true };
  }
  const normalizedLabel = normalizePortableMatchValue(label);
  if (!normalizedLabel) return { record: null, candidates: [] };
  const candidates = records.filter((record) =>
    normalizePortableMatchValue(record.name) === normalizedLabel && (includeArchived || !record.archivedAt),
  );
  if (candidates.length === 1) return { record: candidates[0], method: "name", archived: Boolean(candidates[0].archivedAt) };
  return { record: null, candidates };
};

export const classifyPortablePreviewAction = ({ issues = [], match = null, candidates = [] }) => {
  const blockingCodes = new Set([
    "required", "column_count_mismatch", "unclosed_quote", "missing_header",
    "characters_after_quote", "quote_in_unquoted_value", "blank_header", "duplicate_header",
    "missing_reference", "invalid_value", "archived_match", "unresolved_reference",
    "archive_import_unsupported",
  ]);
  if (issues.some((issue) => blockingCodes.has(issue.code)
    || (issue.code === "ambiguous_reference" && !issue.candidates?.length)
    || (issue.code === "foreign_or_unknown_reference_id" && !issue.candidates?.length))) return "invalid";
  if (candidates.length > 1 || issues.some((issue) => [
    "ambiguous_reference", "foreign_or_unknown_record_id", "foreign_or_unknown_reference_id",
  ].includes(issue.code))) return "review";
  return match ? "update" : "create";
};

const weekdayNumber = (value) => {
  const index = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(normalizePortableMatchValue(value));
  return index >= 0 ? index : Number(value);
};

export const portableServiceMatches = (service, record, services) => {
  if (service.reccurence !== record.recurrence) return false;
  const group = portableServiceGroupLabel(service, services);
  if (normalizePortableMatchValue(group) !== normalizePortableMatchValue(record.combinedGroup || "")) return false;
  if (String(service.startDateISO || "") !== String(record.startDate || "")) return false;
  if (String(service.endDateISO || "") !== String(record.endDate || "")) return false;
  if (service.reccurence === "one_time") {
    return String(service.dateTimeISO || "").slice(0, 10) === String(record.date || "")
      && (!record.time || String(service.dateTimeISO || "").slice(11, 16) === String(record.time));
  }
  if (service.reccurence === "multi_weekly") {
    const current = (service.daysOfWeek || []).map((item) => `${item.day}@${item.time}`).sort().join("|");
    const imported = String(record.daysOfWeek || "").split(" | ").filter(Boolean).map((item) => {
      const [day, time] = item.split("@");
      return `${weekdayNumber(day)}@${time}`;
    }).sort().join("|");
    return current === imported;
  }
  if (String(service.time || "") !== String(record.time || "")) return false;
  if (service.reccurence === "weekly") return Number(service.dayOfWeek) === weekdayNumber(record.weekday);
  if (service.reccurence === "monthly") return Number(service.ordinal) === Number(record.weekOrdinal) && Number(service.weekday) === weekdayNumber(record.weekday);
  return false;
};
