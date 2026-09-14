import type {
  CurrentServiceWorkspaceConfig,
  CurrentServiceWorkspaceSectionKey,
  CurrentServiceWorkspaceSections,
} from "../api/authTypes";

export const CURRENT_SERVICE_WORKSPACE_DEFAULT_SECTIONS: CurrentServiceWorkspaceSections = {
  displays: true,
  credits: true,
  team: true,
  chat: true,
};

export const createDefaultCurrentServiceWorkspace = (): CurrentServiceWorkspaceConfig => ({
  sections: { ...CURRENT_SERVICE_WORKSPACE_DEFAULT_SECTIONS },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readSectionEnabled = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

/** Normalizes shared RTDB data without requiring a migration for old churches. */
export const normalizeCurrentServiceWorkspace = (
  value: unknown,
): CurrentServiceWorkspaceConfig => {
  const source =
    isRecord(value) && isRecord(value.currentServiceWorkspace)
      ? value.currentServiceWorkspace
      : value;
  const sections = isRecord(source) && isRecord(source.sections)
    ? source.sections
    : {};

  return {
    sections: {
      displays: readSectionEnabled(
        sections.displays,
        CURRENT_SERVICE_WORKSPACE_DEFAULT_SECTIONS.displays,
      ),
      credits: readSectionEnabled(
        sections.credits,
        CURRENT_SERVICE_WORKSPACE_DEFAULT_SECTIONS.credits,
      ),
      team: readSectionEnabled(
        sections.team,
        CURRENT_SERVICE_WORKSPACE_DEFAULT_SECTIONS.team,
      ),
      chat: readSectionEnabled(
        sections.chat,
        CURRENT_SERVICE_WORKSPACE_DEFAULT_SECTIONS.chat,
      ),
    },
  };
};

export type CurrentServiceWorkspacePreviewTab =
  | "displays"
  | "credits"
  | "serving"
  | "chat";

export type CurrentServiceWorkspacePreviewSection = {
  key: CurrentServiceWorkspaceSectionKey;
  tab: CurrentServiceWorkspacePreviewTab;
  label: string;
};

export const CURRENT_SERVICE_WORKSPACE_PREVIEW_SECTIONS: readonly CurrentServiceWorkspacePreviewSection[] = [
  { key: "displays", tab: "displays", label: "Displays" },
  { key: "credits", tab: "credits", label: "Credits" },
  { key: "team", tab: "serving", label: "Team" },
  { key: "chat", tab: "chat", label: "Chat" },
];

export type CurrentServiceWorkspaceAvailability = Partial<
  Record<CurrentServiceWorkspaceSectionKey, boolean>
>;

/** Combines church configuration with permission/system availability once. */
export const resolveCurrentServiceWorkspaceSections = (
  configuration: unknown,
  availability: CurrentServiceWorkspaceAvailability = {},
): CurrentServiceWorkspacePreviewSection[] => {
  const sections = normalizeCurrentServiceWorkspace(configuration).sections;
  return CURRENT_SERVICE_WORKSPACE_PREVIEW_SECTIONS.filter(
    ({ key }) => sections[key] && availability[key] !== false,
  );
};

export const resolveCurrentServiceWorkspaceTab = (
  tab: "plan" | CurrentServiceWorkspacePreviewTab,
  sections: readonly CurrentServiceWorkspacePreviewSection[],
): "plan" | CurrentServiceWorkspacePreviewTab => {
  if (tab === "plan") return tab;
  return sections.find((section) => section.tab === tab)?.tab ?? sections[0]?.tab ?? "plan";
};
