import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../../components/Button/Button";
import Checkbox from "../../components/Checkbox/Checkbox";
import Spinner from "../../components/Spinner/Spinner";
import { AuthApiError, updateCurrentServiceWorkspace } from "../../api/auth";
import type {
  CurrentServiceWorkspaceConfig,
  CurrentServiceWorkspaceSectionKey,
  CurrentServiceWorkspaceSectionPatch,
  CurrentServiceWorkspaceSections,
} from "../../api/authTypes";
import { useToast } from "../../context/toastContext";
import { normalizeCurrentServiceWorkspace } from "../../utils/currentServiceWorkspace";
import { formatAccountError } from "../Account/accountUtils";

type CurrentServiceWorkspaceSettingsPanelProps = {
  churchId: string;
  configuration: CurrentServiceWorkspaceConfig;
  configurationStatus: "loading" | "ready";
};

const workspaceSectionOptions: Array<{
  key: CurrentServiceWorkspaceSectionKey;
  label: string;
}> = [
  { key: "displays", label: "Displays" },
  { key: "credits", label: "Credits" },
  { key: "team", label: "Team" },
  { key: "chat", label: "Chat" },
];

export const CurrentServiceWorkspaceSettingsPanel = ({
  churchId,
  configuration,
  configurationStatus,
}: CurrentServiceWorkspaceSettingsPanelProps) => {
  const { showToast } = useToast();
  const initialConfiguration = normalizeCurrentServiceWorkspace(configuration);
  const [draft, setDraft] = useState(initialConfiguration);
  const draftRef = useRef(draft);
  const configurationRef = useRef(initialConfiguration);
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextConfiguration = normalizeCurrentServiceWorkspace(configuration);
    const previousConfiguration = configurationRef.current;
    const currentDraft = draftRef.current;
    const nextDraft = isDirtyRef.current
      ? {
          sections: workspaceSectionOptions.reduce(
            (sections, option) => {
              sections[option.key] =
                currentDraft.sections[option.key] ===
                previousConfiguration.sections[option.key]
                  ? nextConfiguration.sections[option.key]
                  : currentDraft.sections[option.key];
              return sections;
            },
            {} as CurrentServiceWorkspaceSections,
          ),
        }
      : nextConfiguration;
    const nextIsDirty = workspaceSectionOptions.some(
      (option) =>
        nextDraft.sections[option.key] !==
        nextConfiguration.sections[option.key],
    );
    configurationRef.current = nextConfiguration;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    isDirtyRef.current = nextIsDirty;
    setIsDirty(nextIsDirty);
    setError(null);
  }, [configuration]);

  const updateSection = useCallback(
    (key: CurrentServiceWorkspaceSectionKey, checked: boolean) => {
      const nextDraft = {
        sections: { ...draftRef.current.sections, [key]: checked },
      };
      const nextIsDirty = workspaceSectionOptions.some(
        (option) =>
          nextDraft.sections[option.key] !==
          configurationRef.current.sections[option.key],
      );
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      isDirtyRef.current = nextIsDirty;
      setIsDirty(nextIsDirty);
      setError(null);
    },
    [],
  );

  const resetDraft = useCallback(() => {
    const nextDraft = configurationRef.current;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    isDirtyRef.current = false;
    setIsDirty(false);
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!churchId || isSaving) return;
    const currentDraft = draftRef.current;
    const currentConfiguration = configurationRef.current;
    const changedSections: CurrentServiceWorkspaceSectionPatch = {};
    for (const option of workspaceSectionOptions) {
      if (
        currentDraft.sections[option.key] !==
        currentConfiguration.sections[option.key]
      ) {
        changedSections[option.key] = currentDraft.sections[option.key];
      }
    }
    if (Object.keys(changedSections).length === 0) {
      isDirtyRef.current = false;
      setIsDirty(false);
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const response = await updateCurrentServiceWorkspace(
        churchId,
        changedSections,
      );
      const savedDraft = normalizeCurrentServiceWorkspace(
        response.currentServiceWorkspace,
      );
      draftRef.current = savedDraft;
      configurationRef.current = savedDraft;
      setDraft(savedDraft);
      isDirtyRef.current = false;
      setIsDirty(false);
      showToast("Workspace settings saved.", "success");
    } catch (nextError) {
      setError(
        nextError instanceof AuthApiError
          ? nextError.message
          : formatAccountError(
              nextError,
              "Could not save workspace settings. Try again.",
            ),
      );
    } finally {
      setIsSaving(false);
    }
  }, [churchId, isSaving, showToast]);

  if (configurationStatus === "loading") {
    return (
      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
        <div
          className="flex items-center gap-2 text-sm text-gray-200"
          role="status"
        >
          <Spinner
            width="16px"
            borderWidth="2px"
            className="shrink-0 border-cyan-400/90 border-b-transparent"
          />
          <span>Loading workspace settings…</span>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
      <div className="flex flex-col gap-3 border-b border-gray-700 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Current Service Workspace</h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            Choose which tools are available in the Current Service Workspace.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="tertiary"
            disabled={!isDirty || isSaving}
            onClick={resetDraft}
          >
            Reset changes
          </Button>
          <Button
            variant="cta"
            isLoading={isSaving}
            disabled={!isDirty || isSaving}
            onClick={() => void handleSave()}
          >
            {isSaving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {workspaceSectionOptions.map((option) => (
          <Checkbox
            key={option.key}
            id={`current-service-workspace-${option.key}`}
            label={option.label}
            checked={draft.sections[option.key]}
            onCheckedChange={(checked) => updateSection(option.key, checked)}
            className="rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2"
          />
        ))}
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
