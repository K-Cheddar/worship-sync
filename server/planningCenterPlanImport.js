/**
 * Maps Planning Center Services plan JSON into the shared
 * ServicePlanningImportData shape used by buildServicePlanSectionsFromImport.
 */

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asText = (value) => String(value ?? "").trim();

const includedKey = (type, id) => `${type}:${id}`;

const indexIncluded = (included) => {
  const byKey = new Map();
  for (const entry of Array.isArray(included) ? included : []) {
    if (!isRecord(entry) || !entry.type || entry.id == null) continue;
    byKey.set(includedKey(String(entry.type), String(entry.id)), entry);
  }
  return byKey;
};

const relatedIds = (resource, relationshipName) => {
  const data = resource?.relationships?.[relationshipName]?.data;
  if (Array.isArray(data)) {
    return data
      .filter((ref) => isRecord(ref) && ref.id != null)
      .map((ref) => String(ref.id));
  }
  if (isRecord(data) && data.id != null) return [String(data.id)];
  return [];
};

const relatedOne = (resource, relationshipName) => {
  const data = resource?.relationships?.[relationshipName]?.data;
  if (!isRecord(data) || data.id == null || !data.type) return null;
  return { type: String(data.type), id: String(data.id) };
};

const stripHtml = (value) =>
  asText(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const buildPlanLabel = (planAttributes, planId) => {
  const dates =
    asText(planAttributes.dates) || asText(planAttributes.short_dates);
  const title =
    asText(planAttributes.title) || asText(planAttributes.series_title);
  const label = [dates, title].filter(Boolean).join(" · ");
  return label || `Planning Center plan ${planId}`;
};

const buildSourceUrl = (planAttributes, planId) => {
  const url = asText(planAttributes.planning_center_url);
  if (url.startsWith("https://")) return url;
  return `https://services.planningcenteronline.com/plans/${encodeURIComponent(planId)}`;
};

const noteTextForItem = (item, includedByKey) => {
  const parts = [];
  for (const noteId of relatedIds(item, "item_notes")) {
    const note = includedByKey.get(includedKey("ItemNote", noteId));
    const content = asText(note?.attributes?.content);
    if (content) parts.push(content);
  }
  const description = asText(item?.attributes?.description);
  if (description) parts.push(description);
  const htmlDetails = stripHtml(item?.attributes?.html_details);
  if (htmlDetails && htmlDetails !== description) parts.push(htmlDetails);
  return parts.join("\n").trim();
};

const personDisplayName = (person) => {
  const attrs = isRecord(person?.attributes) ? person.attributes : {};
  const fullName = asText(attrs.name);
  if (fullName) return fullName;
  return [asText(attrs.first_name), asText(attrs.last_name)]
    .filter(Boolean)
    .join(" ")
    .trim();
};

/** Item-level assignments become the shared Led by string and retain whether
 * Planning Center assigned a person or a team position. */
const ledByFromItemAssignments = (item, includedByKey) => {
  const names = [];
  const assignments = [];
  const seen = new Set();
  for (const assignmentId of relatedIds(item, "item_assignments")) {
    const assignment = includedByKey.get(
      includedKey("ItemAssignment", assignmentId),
    );
    const assignable = relatedOne(assignment, "assignable");
    if (!assignable) continue;
    const resource = includedByKey.get(
      includedKey(assignable.type, assignable.id),
    );
    let name = "";
    if (assignable.type === "Person") {
      name = personDisplayName(resource);
    } else if (assignable.type === "TeamPosition") {
      name = asText(resource?.attributes?.name);
    }
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    assignments.push({
      kind: assignable.type === "Person" ? "person" : "teamPosition",
      id: assignable.id,
      name,
    });
  }
  return { ledBy: names.join(", "), ledByAssignments: assignments };
};

/**
 * Prefer the wall-clock HH:mm from the ISO string so org-local offsets from
 * Planning Center survive. Fall back to UTC components only when needed.
 */
const formatStartsAtToPlanTime = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/T(\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes(),
  ).padStart(2, "0")}`;
};

const startTimeFromItemTimes = (item, includedByKey) => {
  const candidates = [];
  for (const timeId of relatedIds(item, "item_times")) {
    const itemTime = includedByKey.get(includedKey("ItemTime", timeId));
    if (!itemTime || itemTime.attributes?.exclude === true) continue;
    const planTimeRef = relatedOne(itemTime, "plan_time");
    if (!planTimeRef) continue;
    const planTime = includedByKey.get(
      includedKey(planTimeRef.type, planTimeRef.id),
    );
    const startsAt = planTime?.attributes?.starts_at;
    const formatted = formatStartsAtToPlanTime(startsAt);
    if (!formatted) continue;
    const timeType = asText(planTime?.attributes?.time_type).toLowerCase();
    candidates.push({
      formatted,
      isService: timeType === "service" || timeType === "",
    });
  }
  const preferred =
    candidates.find((entry) => entry.isService) || candidates[0];
  return preferred?.formatted || "";
};

const songKeyName = (item, includedByKey) => {
  const attrs = isRecord(item?.attributes) ? item.attributes : {};
  const fromAttribute = asText(attrs.key_name);
  if (fromAttribute) return fromAttribute;
  const keyRef = relatedOne(item, "key");
  if (!keyRef) return "";
  const key = includedByKey.get(includedKey(keyRef.type, keyRef.id));
  return (
    asText(key?.attributes?.name) || asText(key?.attributes?.starting_key) || ""
  );
};

const arrangementName = (item, includedByKey) => {
  const arrangementRef = relatedOne(item, "arrangement");
  if (!arrangementRef) return "";
  const arrangement = includedByKey.get(
    includedKey(arrangementRef.type, arrangementRef.id),
  );
  return asText(arrangement?.attributes?.name);
};

const hasTrailingKey = (title) =>
  /\s\([A-G][#b]?(?:m)?(?:\s*(?:→|->)\s*[A-G][#b]?(?:m)?)?\)\s*$/i.test(title);

/**
 * Matches Service Planning title conventions: arrangement in the label, key in
 * trailing parentheses so cleanPlanningTitle / library matching still work.
 */
const buildSongDisplayTitle = ({
  songTitle,
  itemTitle,
  arrangement,
  keyName,
}) => {
  const base = songTitle || itemTitle || "Untitled";
  let title = base;
  if (
    arrangement &&
    arrangement.toLowerCase() !== base.toLowerCase() &&
    !title.toLowerCase().includes(arrangement.toLowerCase())
  ) {
    title = `${title} — ${arrangement}`;
  }
  if (keyName && !hasTrailingKey(title)) {
    title = `${title} (${keyName})`;
  }
  return title;
};

const servicePositionForItem = (item) => {
  const position = asText(item?.attributes?.service_position).toLowerCase();
  if (position === "pre" || position === "post") return position;
  return "during";
};

const rowFromItem = (item, includedByKey) => {
  const attrs = isRecord(item?.attributes) ? item.attributes : {};
  const itemType = asText(attrs.item_type) || "item";
  const songIds = relatedIds(item, "song");
  const song = songIds.length
    ? includedByKey.get(includedKey("Song", songIds[0]))
    : null;
  const songTitle = asText(song?.attributes?.title);
  const itemTitle = asText(attrs.title);
  const isSong = itemType === "song" || Boolean(songTitle);
  const keyName = isSong ? songKeyName(item, includedByKey) : "";
  const arrangement = isSong ? arrangementName(item, includedByKey) : "";
  const title = isSong
    ? buildSongDisplayTitle({
        songTitle,
        itemTitle,
        arrangement,
        keyName,
      })
    : itemTitle || songTitle || "Untitled";
  const lengthSeconds = Number(attrs.length);
  const durationMinutes =
    Number.isFinite(lengthSeconds) && lengthSeconds > 0
      ? lengthSeconds / 60
      : undefined;
  const note = noteTextForItem(item, includedByKey);
  const { ledBy, ledByAssignments } = ledByFromItemAssignments(
    item,
    includedByKey,
  );
  const startTime = startTimeFromItemTimes(item, includedByKey);

  let elementType = "Item";
  if (isSong) elementType = itemTitle || "Song";
  else if (itemType === "media") elementType = "Media";

  return {
    elementType,
    title,
    contentTitle: title,
    ledBy,
    ...(ledByAssignments.length ? { ledByAssignments } : {}),
    ...(startTime ? { startTime } : {}),
    ...(durationMinutes != null ? { durationMinutes } : {}),
    ...(note ? { note } : {}),
    ...(isSong ? { songTitle: songTitle || itemTitle || title } : {}),
  };
};

const mapItemGroupToSections = (items, includedByKey, defaultSectionName) => {
  const sections = [];
  let current = { sectionName: defaultSectionName, rows: [] };

  for (const item of items) {
    if (!isRecord(item)) continue;
    const attrs = isRecord(item.attributes) ? item.attributes : {};
    const itemType = asText(attrs.item_type) || "item";

    if (itemType === "header") {
      const headerName = asText(attrs.title) || "Section";
      if (current.rows.length === 0 && sections.length === 0) {
        current.sectionName = headerName;
      } else {
        sections.push(current);
        current = { sectionName: headerName, rows: [] };
      }
      continue;
    }

    current.rows.push(rowFromItem(item, includedByKey));
  }

  if (current.rows.length > 0 || sections.length === 0) {
    sections.push(current);
  }

  return sections.filter(
    (section, index, list) =>
      section.rows.length > 0 || (list.length === 1 && index === 0),
  );
};

/**
 * @param {{ plan: object, items: object[], included?: object[] }} input
 * @returns {{
 *   planLabel: string,
 *   sourceUrl: string,
 *   serviceTypeId: string,
 *   planId: string,
 *   sections: Array<{ sectionName: string, rows: object[] }>,
 *   teamAssignments: [],
 * }}
 */
export const mapPlanningCenterPlanToImportData = ({
  plan,
  items,
  included = [],
}) => {
  if (!isRecord(plan) || plan.id == null) {
    throw new Error("Planning Center did not return a plan.");
  }
  const planId = String(plan.id);
  const planAttributes = isRecord(plan.attributes) ? plan.attributes : {};
  const serviceTypeIds = relatedIds(plan, "service_type");
  const serviceTypeId = serviceTypeIds[0] || "";
  const includedByKey = indexIncluded(included);

  const groups = { pre: [], during: [], post: [] };
  for (const item of Array.isArray(items) ? items : []) {
    if (!isRecord(item)) continue;
    groups[servicePositionForItem(item)].push(item);
  }

  const sections = [
    ...mapItemGroupToSections(groups.pre, includedByKey, "Pre-Service"),
    ...mapItemGroupToSections(groups.during, includedByKey, "Plan"),
    ...mapItemGroupToSections(groups.post, includedByKey, "Post-Service"),
  ].filter((section) => section.rows.length > 0);

  return {
    planLabel: buildPlanLabel(planAttributes, planId),
    sourceUrl: buildSourceUrl(planAttributes, planId),
    serviceTypeId,
    planId,
    sections:
      sections.length > 0 ? sections : [{ sectionName: "Plan", rows: [] }],
    teamAssignments: [],
  };
};
