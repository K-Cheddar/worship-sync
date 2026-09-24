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

  const outputPreviewIds = Array.isArray(source?.outputPreviewIds)
    ? Array.from(
        new Set(
          source.outputPreviewIds
            .filter((id) => typeof id === "string")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      )
    : source?.outputPreviewsConfigured === true
      ? []
      : undefined;
  return {
    sections: Object.fromEntries(
      CURRENT_SERVICE_WORKSPACE_SECTION_KEYS.map((key) => [
        key,
        typeof sections[key] === "boolean" ? sections[key] : defaults[key],
      ]),
    ),
    ...(outputPreviewIds ? { outputPreviewIds } : {}),
  };
};

/** Extracts only explicit boolean changes for a field-level RTDB update. */
export const normalizeCurrentServiceWorkspacePatch = (input) => {
  const source =
    isRecord(input) && isRecord(input.currentServiceWorkspace)
      ? input.currentServiceWorkspace
      : input;
  if (!isRecord(source) || (source.sections !== undefined && !isRecord(source.sections))) {
    throw createWorkspaceConfigError("Workspace settings are invalid.");
  }

  const sections = {};
  for (const key of CURRENT_SERVICE_WORKSPACE_SECTION_KEYS) {
    if (source.sections?.[key] === undefined) continue;
    if (typeof source.sections[key] !== "boolean") {
      throw createWorkspaceConfigError(`${key} workspace setting must be a boolean.`);
    }
    sections[key] = source.sections[key];
  }

  const patch = { sections };
  if (source.outputPreviewIds !== undefined) {
    if (
      !Array.isArray(source.outputPreviewIds) ||
      source.outputPreviewIds.length > 500 ||
      source.outputPreviewIds.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 160,
      )
    ) {
      throw createWorkspaceConfigError("Output preview settings are invalid.");
    }
    patch.outputPreviewIds = Array.from(new Set(source.outputPreviewIds));
  }
  if (Object.keys(sections).length === 0 && patch.outputPreviewIds === undefined) {
    throw createWorkspaceConfigError("At least one workspace setting is required.");
  }
  return patch;
};
