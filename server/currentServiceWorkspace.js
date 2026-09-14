const CURRENT_SERVICE_WORKSPACE_SECTION_KEYS = [
  "displays",
  "credits",
  "team",
  "chat",
];

const createWorkspaceConfigError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const getCurrentServiceWorkspacePath = (churchId) =>
  `churches/${churchId}/data/currentServiceWorkspace`;

export const createDefaultCurrentServiceWorkspace = () => ({
  sections: {
    displays: true,
    credits: true,
    team: true,
    chat: true,
  },
});

/** Normalizes a full shared snapshot, including missing legacy settings. */
export const normalizeCurrentServiceWorkspaceForStorage = (input) => {
  const source =
    isRecord(input) && isRecord(input.currentServiceWorkspace)
      ? input.currentServiceWorkspace
      : input;
  const sections = isRecord(source) && isRecord(source.sections)
    ? source.sections
    : {};
  const defaults = createDefaultCurrentServiceWorkspace().sections;

  return {
    sections: Object.fromEntries(
      CURRENT_SERVICE_WORKSPACE_SECTION_KEYS.map((key) => [
        key,
        typeof sections[key] === "boolean" ? sections[key] : defaults[key],
      ]),
    ),
  };
};

/** Extracts only explicit boolean changes for a field-level RTDB update. */
export const normalizeCurrentServiceWorkspacePatch = (input) => {
  const source =
    isRecord(input) && isRecord(input.currentServiceWorkspace)
      ? input.currentServiceWorkspace
      : input;
  if (!isRecord(source) || !isRecord(source.sections)) {
    throw createWorkspaceConfigError("Workspace settings are invalid.");
  }

  const sections = {};
  for (const key of CURRENT_SERVICE_WORKSPACE_SECTION_KEYS) {
    if (source.sections[key] === undefined) continue;
    if (typeof source.sections[key] !== "boolean") {
      throw createWorkspaceConfigError(`${key} workspace setting must be a boolean.`);
    }
    sections[key] = source.sections[key];
  }

  if (Object.keys(sections).length === 0) {
    throw createWorkspaceConfigError("At least one workspace setting is required.");
  }
  return { sections };
};
