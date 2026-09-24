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
import { useSelector } from "../../hooks";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { isPushOutputType } from "../../utils/displayOutputs";
import {
  getCurrentServiceWorkspaceOutputPreviewIds,
  normalizeCurrentServiceWorkspace,
} from "../../utils/currentServiceWorkspace";
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
  const outputs = useSelector(selectDisplayOutputs).filter(
    (output) => output.enabled && isPushOutputType(output.type),
  );
  const initialConfiguration = normalizeCurrentServiceWorkspace(configuration);
  const [draft, setDraft] = useState({
    ...initialConfiguration,
    outputPreviewIds: getCurrentServiceWorkspaceOutputPreviewIds(configuration),
  });
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
          outputPreviewIds:
            currentDraft.outputPreviewIds.join("\0") ===
            getCurrentServiceWorkspaceOutputPreviewIds(previousConfiguration).join("\0")
              ? getCurrentServiceWorkspaceOutputPreviewIds(nextConfiguration)
              : currentDraft.outputPreviewIds,
        }
      : {
          ...nextConfiguration,
          outputPreviewIds:
            getCurrentServiceWorkspaceOutputPreviewIds(nextConfiguration),
        };
    const nextIsDirty =
      workspaceSectionOptions.some(
        (option) =>
          nextDraft.sections[option.key] !==
          nextConfiguration.sections[option.key],
      ) ||
      nextDraft.outputPreviewIds.join("\0") !==
        getCurrentServiceWorkspaceOutputPreviewIds(nextConfiguration).join("\0");
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
        ...draftRef.current,
        sections: { ...draftRef.current.sections, [key]: checked },
      };
      const nextIsDirty =
        workspaceSectionOptions.some(
          (option) =>
            nextDraft.sections[option.key] !==
            configurationRef.current.sections[option.key],
        ) ||
        nextDraft.outputPreviewIds.join("\0") !==
          getCurrentServiceWorkspaceOutputPreviewIds(configurationRef.current).join("\0");
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      isDirtyRef.current = nextIsDirty;
      setIsDirty(nextIsDirty);
      setError(null);
    },
    [],
  );

  const updateOutputPreview = useCallback(
    (outputId: string, checked: boolean) => {
      const selected = new Set(draftRef.current.outputPreviewIds);
      if (checked) selected.add(outputId);
      else selected.delete(outputId);
      const nextDraft = {
        ...draftRef.current,
        outputPreviewIds: outputs
          .map((output) => output.id)
          .filter((id) => selected.has(id)),
      };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      const nextIsDirty =
        workspaceSectionOptions.some(
          (option) =>
            nextDraft.sections[option.key] !==
            configurationRef.current.sections[option.key],
        ) ||
        nextDraft.outputPreviewIds.join("\0") !==
          getCurrentServiceWorkspaceOutputPreviewIds(configurationRef.current).join("\0");
      isDirtyRef.current = nextIsDirty;
      setIsDirty(nextIsDirty);
      setError(null);
    },
    [outputs],
  );

  const resetDraft = useCallback(() => {
    const nextDraft = {
      ...configurationRef.current,
      outputPreviewIds: getCurrentServiceWorkspaceOutputPreviewIds(configurationRef.current),
    };
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
    if (
      currentDraft.outputPreviewIds.join("\0") !==
      getCurrentServiceWorkspaceOutputPreviewIds(currentConfiguration).join("\0")
    ) {
      changedSections.outputPreviewIds = currentDraft.outputPreviewIds;
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
      const completeSavedDraft = {
        ...savedDraft,
        outputPreviewIds: getCurrentServiceWorkspaceOutputPreviewIds(savedDraft),
      };
      draftRef.current = completeSavedDraft;
      configurationRef.current = completeSavedDraft;
      setDraft(completeSavedDraft);
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
            disabled={isSaving}
            onCheckedChange={(checked) => updateSection(option.key, checked)}
            className="rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2"
          />
        ))}
      </div>

      <fieldset className="mt-5 border-t border-gray-700 pt-4">
        <legend className="text-sm font-semibold text-gray-100">
          Output previews
        </legend>
        <p className="mt-1 text-sm text-gray-400">
          Choose the displays shown in the workspace. These previews are read-only.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {outputs.map((output) => (
            <Checkbox
              key={output.id}
              id={`current-service-workspace-output-${output.id}`}
              label={output.name}
              checked={draft.outputPreviewIds.includes(output.id)}
              disabled={isSaving}
              onCheckedChange={(checked) => updateOutputPreview(output.id, checked)}
              className="rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2"
            />
          ))}
        </div>
      </fieldset>

      {error ? (
        <p className="mt-4 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
