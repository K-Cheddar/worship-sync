const INTEGRATIONS_MAX_RULES = 50;
const INTEGRATIONS_MAX_PEOPLE = 200;
const INTEGRATIONS_MAX_NAMES_PER_PERSON = 20;
const INTEGRATIONS_MAX_STRING = 2000;
const INTEGRATIONS_MAX_SHORT = 500;
const INTEGRATIONS_MAX_LABEL = 120;

const createIntegrationsError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const ALLOWED_MATCH_MODES = new Set(["exact", "contains", "normalize"]);
const ALLOWED_NAME_KEYS = new Set(["elementType", "title", "ledBy"]);
const ALLOWED_MULTI_MODES = new Set(["single", "split"]);
const ALLOWED_OUTLINE_ITEM_TYPES = new Set(["song", "bible", "none"]);

const defaultCatalog = () => ({
  servicePlanning: { status: "available", label: "Service Planning" },
  songSelect: { status: "coming_soon", label: "SongSelect" },
  planningCenter: { status: "coming_soon", label: "Planning Center" },
});

export const getChurchIntegrationsPath = (churchId) =>
  `churches/${churchId}/data/integrations`;

const clampString = (value, max, fieldName) => {
  const s = String(value ?? "").trim();
  if (s.length > max) {
    throw createIntegrationsError(
      `${fieldName} must be ${max} characters or less.`,
    );
  }
  return s;
};

const normalizePerson = (raw, index) => {
  if (!isRecord(raw)) {
    throw createIntegrationsError(`People entry ${index + 1} is invalid.`);
  }
  const id = clampString(
    raw.id,
    INTEGRATIONS_MAX_SHORT,
    `Person ${index + 1} id`,
  );
  if (!id) {
    throw createIntegrationsError(`Person ${index + 1} requires an id.`);
  }
  const namesRaw = Array.isArray(raw.names) ? raw.names : [];
  if (namesRaw.length > INTEGRATIONS_MAX_NAMES_PER_PERSON) {
    throw createIntegrationsError(
      `Person ${index + 1} has too many name aliases.`,
    );
  }
  const names = namesRaw
    .map((n, j) =>
      clampString(
        n,
        INTEGRATIONS_MAX_LABEL,
        `Person ${index + 1} name ${j + 1}`,
      ),
    )
    .filter(Boolean);
  const displayName = clampString(
    raw.displayName,
    INTEGRATIONS_MAX_LABEL,
    `Person ${index + 1} display name`,
  );
  if (!displayName) {
    throw createIntegrationsError(
      `Person ${index + 1} requires a display name.`,
    );
  }
  const title = clampString(
    raw.title,
    INTEGRATIONS_MAX_LABEL,
    `Person ${index + 1} title`,
  );
  return {
    id,
    names,
    displayName,
    ...(title ? { title } : {}),
  };
};

const normalizeElementRule = (raw, index) => {
  if (!isRecord(raw)) {
    throw createIntegrationsError(`Element rule ${index + 1} is invalid.`);
  }
  const id = clampString(
    raw.id,
    INTEGRATIONS_MAX_SHORT,
    `Rule ${index + 1} id`,
  );
  if (!id) {
    throw createIntegrationsError(`Rule ${index + 1} requires an id.`);
  }
  const matchElementType = clampString(
    raw.matchElementType,
    INTEGRATIONS_MAX_SHORT,
    `Rule ${index + 1} match`,
  );
  if (!matchElementType) {
    throw createIntegrationsError(`Rule ${index + 1} requires match text.`);
  }
  const matchMode = String(raw.matchMode || "contains").trim();
  if (!ALLOWED_MATCH_MODES.has(matchMode)) {
    throw createIntegrationsError(`Rule ${index + 1} has invalid match mode.`);
  }
  const displayName = clampString(
    raw.displayName,
    INTEGRATIONS_MAX_SHORT,
    `Rule ${index + 1} display name`,
  );
  const nameSourcesRaw = Array.isArray(raw.nameSources) ? raw.nameSources : [];
  const nameSources = [];
  for (const key of nameSourcesRaw) {
    const k = String(key || "").trim();
    if (!ALLOWED_NAME_KEYS.has(k)) {
      throw createIntegrationsError(
        `Rule ${index + 1} has invalid name column "${k}".`,
      );
    }
    if (!nameSources.includes(k)) nameSources.push(k);
  }
  if (nameSources.length === 0) {
    // Match DEFAULT_SERVICE_PLANNING_NAME_SOURCES (client types/integrations.ts).
    nameSources.push("ledBy");
  }

  const mo = isRecord(raw.multiOverlay) ? raw.multiOverlay : {};
  const mode = String(mo.mode || "single").trim();
  if (!ALLOWED_MULTI_MODES.has(mode)) {
    throw createIntegrationsError(
      `Rule ${index + 1} has invalid multiOverlay mode.`,
    );
  }
  const splitSeparators = Array.isArray(mo.splitSeparators)
    ? mo.splitSeparators
        .map((s, j) =>
          clampString(s, 8, `Rule ${index + 1} separator ${j + 1}`),
        )
        .filter(Boolean)
    : undefined;
  const eventSuffixByPersonIndex = Array.isArray(mo.eventSuffixByPersonIndex)
    ? mo.eventSuffixByPersonIndex.map((s, j) =>
        clampString(
          s,
          INTEGRATIONS_MAX_SHORT,
          `Rule ${index + 1} suffix ${j + 1}`,
        ),
      )
    : undefined;

  const repeatLastEventSuffix = Boolean(mo.repeatLastEventSuffix);

  const ft = isRecord(raw.fieldTemplates) ? raw.fieldTemplates : {};
  const fieldTemplates = {};
  for (const k of ["name", "title", "heading", "subHeading", "event"]) {
    if (ft[k] != null && String(ft[k]).trim()) {
      fieldTemplates[k] = clampString(
        ft[k],
        INTEGRATIONS_MAX_STRING,
        `Rule ${index + 1} template ${k}`,
      );
    }
  }

  const outlineSync = isRecord(raw.outlineSync)
    ? {
        enabled: Boolean(raw.outlineSync.enabled),
        itemType: ALLOWED_OUTLINE_ITEM_TYPES.has(String(raw.outlineSync.itemType))
          ? String(raw.outlineSync.itemType)
          : "none",
      }
    : undefined;

  return {
    id,
    matchElementType,
    matchMode,
    overlaySyncEnabled: raw.overlaySyncEnabled === false ? false : true,
    displayName,
    nameSources,
    multiOverlay: {
      mode,
      ...(splitSeparators?.length ? { splitSeparators } : {}),
      ...(eventSuffixByPersonIndex?.length ? { eventSuffixByPersonIndex } : {}),
      ...(repeatLastEventSuffix ? { repeatLastEventSuffix: true } : {}),
    },
    ...(Object.keys(fieldTemplates).length ? { fieldTemplates } : {}),
    ...(outlineSync ? { outlineSync } : {}),
  };
};

const normalizeSectionRule = (raw, index) => {
  if (!isRecord(raw)) {
    throw createIntegrationsError(`Section rule ${index + 1} is invalid.`);
  }
  const id = clampString(raw.id, INTEGRATIONS_MAX_SHORT, `Section rule ${index + 1} id`);
  if (!id) {
    throw createIntegrationsError(`Section rule ${index + 1} requires an id.`);
  }
  const matchSectionName = clampString(
    raw.matchSectionName,
    INTEGRATIONS_MAX_SHORT,
    `Section rule ${index + 1} match`,
  );
  if (!matchSectionName) {
    throw createIntegrationsError(`Section rule ${index + 1} requires match text.`);
  }
  const matchMode = String(raw.matchMode || "contains").trim();
  if (!ALLOWED_MATCH_MODES.has(matchMode)) {
    throw createIntegrationsError(`Section rule ${index + 1} has invalid match mode.`);
  }
  const headingName = clampString(
    raw.headingName,
    INTEGRATIONS_MAX_SHORT,
    `Section rule ${index + 1} heading name`,
  );
  if (!headingName) {
    throw createIntegrationsError(`Section rule ${index + 1} requires a heading name.`);
  }
  return { id, matchSectionName, matchMode, headingName };
};

const normalizeCatalog = (raw) => {
  const base = defaultCatalog();
  if (!isRecord(raw)) return base;
  const out = { ...base };
  for (const key of ["servicePlanning", "songSelect", "planningCenter"]) {
    if (isRecord(raw[key])) {
      const status = String(raw[key].status || base[key].status).trim();
      const label = clampString(
        raw[key].label,
        INTEGRATIONS_MAX_SHORT,
        `${key} label`,
      );
      out[key] = {
        status:
          status === "coming_soon" || status === "available"
            ? status
            : base[key].status,
        label: label || base[key].label,
      };
    }
  }
  return out;
};

/**
 * Validates and normalizes church integrations for RTDB storage (admin POST body).
 */
export const normalizeChurchIntegrationsForStorage = (input) => {
  const source =
    isRecord(input) && isRecord(input.integrations)
      ? input.integrations
      : input;

  if (source != null && !isRecord(source)) {
    throw createIntegrationsError("Integrations payload is invalid.");
  }

  const safe = isRecord(source) ? source : {};
  const version = Number(safe.version);
  const catalog = normalizeCatalog(safe.catalog);

  const sp = isRecord(safe.servicePlanning) ? safe.servicePlanning : {};
  const enabled = Boolean(sp.enabled);

  const rulesRaw = Array.isArray(sp.elementRules) ? sp.elementRules : [];
  if (rulesRaw.length > INTEGRATIONS_MAX_RULES) {
    throw createIntegrationsError(
      `You can save up to ${INTEGRATIONS_MAX_RULES} element rules.`,
    );
  }
  const elementRules = rulesRaw.map((r, i) => normalizeElementRule(r, i));

  const sectionRulesRaw = Array.isArray(sp.sectionRules) ? sp.sectionRules : [];
  if (sectionRulesRaw.length > INTEGRATIONS_MAX_RULES) {
    throw createIntegrationsError(
      `You can save up to ${INTEGRATIONS_MAX_RULES} section rules.`,
    );
  }
  const sectionRules = sectionRulesRaw.map((r, i) => normalizeSectionRule(r, i));

  const peopleRaw = Array.isArray(sp.people) ? sp.people : [];
  if (peopleRaw.length > INTEGRATIONS_MAX_PEOPLE) {
    throw createIntegrationsError(
      `You can save up to ${INTEGRATIONS_MAX_PEOPLE} people.`,
    );
  }
  const people = peopleRaw.map((p, i) => normalizePerson(p, i));

  return {
    version: Number.isFinite(version) && version > 0 ? Math.floor(version) : 1,
    catalog,
    servicePlanning: {
      enabled,
      elementRules,
      sectionRules,
      people,
    },
  };
};

export const churchIntegrationsLimits = {
  INTEGRATIONS_MAX_RULES,
  INTEGRATIONS_MAX_PEOPLE,
};
