import { useEffect, useMemo, useState } from "react";
import { Eye, Mic2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import Button from "../../components/Button/Button";
import Checkbox from "../../components/Checkbox/Checkbox";
import ColorField from "../../components/ColorField/ColorField";
import Icon from "../../components/Icon/Icon";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import {
  SERVICE_PLAN_MICROPHONE_CUSTOM_TYPE,
  ServicePlanMicrophoneIcon,
  isPresetServicePlanMicrophoneType,
  servicePlanMicrophoneTypeOptions,
} from "../../components/ServicePlanMicrophoneIcon";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import generateRandomId from "../../utils/generateRandomId";
import { resolvePositionLucideIcon } from "../Teams/lucidePositionIcons";
import {
  teamsRowIconButtonClassName,
  teamsRowIconButtonPadding,
  microphoneCatalogGridClassName,
} from "../Teams/teamsStyles";
import {
  MAX_SERVICE_PLAN_MICROPHONES,
  type ServicePlanMicrophone,
  type ServicePlanMicrophoneAudience,
} from "../../types/servicePlan";
import { cn } from "@/utils/cnHelper";

export type MicrophonePositionOption = {
  positionId: string;
  roleName?: string;
  label: string;
  /** Lucide position icon key from the church positions catalog. */
  icon?: string;
  teamId?: string;
  teamName?: string;
};

type PositionTeamGroup = {
  heading: string;
  positions: MicrophonePositionOption[];
};

type MicrophoneSaveTarget = "microphones" | "visibility";

const MICROPHONE_NOTES_TEAM_FILTER_KEY = "worshipsyncMicrophoneNotesTeamFilter";

const positionOptionLabel = (position: MicrophonePositionOption) =>
  position.roleName?.trim() || position.label;

const collectPositionTeams = (options: MicrophonePositionOption[]) => {
  const byId = new Map<string, string>();
  options.forEach((position) => {
    if (position.teamId && position.teamName) byId.set(position.teamId, position.teamName);
  });
  return Array.from(byId, ([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
};

const groupPositionsByTeam = (
  options: MicrophonePositionOption[],
): PositionTeamGroup[] => {
  const groups = new Map<string, PositionTeamGroup>();
  options.forEach((position) => {
    const key = position.teamId || position.teamName || "other";
    const heading = position.teamName || "Other positions";
    const existing = groups.get(key) || { heading, positions: [] };
    existing.positions.push(position);
    groups.set(key, existing);
  });
  return Array.from(groups.values())
    .sort((left, right) => left.heading.localeCompare(right.heading))
    .map((group) => ({
      ...group,
      positions: [...group.positions].sort((left, right) =>
        positionOptionLabel(left).localeCompare(positionOptionLabel(right)),
      ),
    }));
};

const readStoredTeamFilter = () => {
  try {
    return window.localStorage.getItem(MICROPHONE_NOTES_TEAM_FILTER_KEY) || "";
  } catch {
    return "";
  }
};

const persistTeamFilter = (teamId: string) => {
  try {
    if (teamId) window.localStorage.setItem(MICROPHONE_NOTES_TEAM_FILTER_KEY, teamId);
    else window.localStorage.removeItem(MICROPHONE_NOTES_TEAM_FILTER_KEY);
  } catch {
    // Storage is optional; filtering still works for this session.
  }
};

const createMicrophone = (): ServicePlanMicrophone => ({
  id: generateRandomId(),
  name: "",
  type: "Handheld",
  color: "#f97316",
});

/**
 * Rebuild selections from the visible position ids without dropping a saved
 * audience that is temporarily unavailable (for example, an archived position).
 */
export const rebuildMicrophoneAudiences = (
  positionIds: string[],
  positionOptions: MicrophonePositionOption[],
  existingAudiences: ServicePlanMicrophoneAudience[],
): ServicePlanMicrophoneAudience[] => {
  const optionsByPositionId = new Map(
    positionOptions.map((position) => [position.positionId, position]),
  );
  const audiencesByPositionId = new Map(
    existingAudiences.map((audience) => [audience.positionId, audience]),
  );
  const seenPositionIds = new Set<string>();

  return positionIds.flatMap((positionId) => {
    if (seenPositionIds.has(positionId)) return [];
    seenPositionIds.add(positionId);

    const position = optionsByPositionId.get(positionId);
    if (!position) {
      const existingAudience = audiencesByPositionId.get(positionId);
      return existingAudience ? [existingAudience] : [];
    }

    return [{
      positionId: position.positionId,
      roleName: position.roleName?.trim() || position.label,
      ...(position.teamId ? { teamId: position.teamId } : {}),
      ...(position.teamName ? { teamName: position.teamName } : {}),
    }];
  });
};

type ServicePlanMicrophoneManagerProps = {
  microphones: ServicePlanMicrophone[];
  microphoneAudiences: ServicePlanMicrophoneAudience[];
  disabled?: boolean;
  isEditing?: boolean;
  saving?: boolean;
  onSave: (
    microphones: ServicePlanMicrophone[],
    microphoneAudiences: ServicePlanMicrophoneAudience[],
    saveTarget: MicrophoneSaveTarget,
  ) => Promise<boolean>;
  onDirtyChange?: (hasUnsavedChanges: boolean) => void;
  onStartEditing?: () => void;
  onCancelEditing?: () => void;
  positionNoteOptions?: MicrophonePositionOption[];
};

const microphoneTitle = (microphone: ServicePlanMicrophone, index: number) =>
  microphone.name.trim() || `Microphone ${index + 1}`;

/** Church-wide mic catalog. Assignments stay on individual service-plan rows. */
const ServicePlanMicrophoneManager = ({
  microphones,
  microphoneAudiences,
  disabled = false,
  isEditing = false,
  saving = false,
  onSave,
  onDirtyChange,
  onStartEditing,
  onCancelEditing,
  positionNoteOptions = [],
}: ServicePlanMicrophoneManagerProps) => {
  const [draft, setDraft] = useState<ServicePlanMicrophone[]>(microphones);
  const [audienceDraft, setAudienceDraft] = useState<ServicePlanMicrophoneAudience[]>(
    microphoneAudiences,
  );
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [isEditingVisibility, setIsEditingVisibility] = useState(false);
  const [visibilityTeamFilter, setVisibilityTeamFilter] = useState(readStoredTeamFilter);
  const savedFingerprint = useMemo(
    () => JSON.stringify({ microphones, microphoneAudiences }),
    [microphones, microphoneAudiences],
  );
  const hasUnsavedChanges = JSON.stringify({
    microphones: draft,
    microphoneAudiences: audienceDraft,
  }) !== savedFingerprint;
  const hasUnsavedVisibilityChanges =
    JSON.stringify(audienceDraft) !== JSON.stringify(microphoneAudiences);

  const positionTeams = useMemo(
    () => collectPositionTeams(positionNoteOptions),
    [positionNoteOptions],
  );
  const filteredPositionOptions = useMemo(() => {
    if (!visibilityTeamFilter) return positionNoteOptions;
    return positionNoteOptions.filter((position) => position.teamId === visibilityTeamFilter);
  }, [positionNoteOptions, visibilityTeamFilter]);
  const positionGroups = useMemo(
    () => groupPositionsByTeam(filteredPositionOptions),
    [filteredPositionOptions],
  );
  const selectedPositionOptions = useMemo(
    () => positionNoteOptions.filter((option) =>
      audienceDraft.some((audience) => audience.positionId === option.positionId),
    ),
    [audienceDraft, positionNoteOptions],
  );
  const selectedPositionsByTeam = useMemo(() => {
    const visible = visibilityTeamFilter
      ? selectedPositionOptions.filter((position) => position.teamId === visibilityTeamFilter)
      : selectedPositionOptions;
    return groupPositionsByTeam(visible);
  }, [selectedPositionOptions, visibilityTeamFilter]);

  const toggleAudiencePosition = (positionId: string, checked: boolean) => {
    setAudienceDraft((current) => {
      const selectedIds = current.map((audience) => audience.positionId);
      let nextIds: string[];
      if (checked) {
        nextIds = selectedIds.includes(positionId)
          ? selectedIds
          : [...selectedIds, positionId];
      } else {
        nextIds = selectedIds.filter((id) => id !== positionId);
      }
      return rebuildMicrophoneAudiences(nextIds, positionNoteOptions, current);
    });
  };

  const chooseVisibilityTeam = (teamId: string) => {
    setVisibilityTeamFilter(teamId);
    persistTeamFilter(teamId);
  };

  useEffect(() => {
    if (
      visibilityTeamFilter
      && positionTeams.length > 0
      && !positionTeams.some((team) => team.id === visibilityTeamFilter)
    ) {
      setVisibilityTeamFilter("");
      persistTeamFilter("");
    }
  }, [positionTeams, visibilityTeamFilter]);

  useEffect(() => {
    setDraft(microphones);
  }, [microphones]);

  useEffect(() => {
    setAudienceDraft(microphoneAudiences);
  }, [microphoneAudiences]);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const updateMicrophone = (
    microphoneId: string,
    changes: Partial<ServicePlanMicrophone>,
  ) => {
    setDraft((current) => current.map((microphone) =>
      microphone.id === microphoneId ? { ...microphone, ...changes } : microphone,
    ));
  };

  const removeMicrophone = (microphoneId: string) => {
    setDraft((current) => current.filter((microphone) => microphone.id !== microphoneId));
  };

  const hasIncompleteMicrophone = draft.some((microphone) =>
    !microphone.name.trim() || !microphone.type.trim(),
  );
  const isLocked = disabled || saving || !isEditing;
  const isVisibilityLocked = disabled || saving || !isEditingVisibility;
  const showCompactList = !isEditing;

  const cancelEditing = () => {
    setDraft(microphones);
    onCancelEditing?.();
  };

  const cancelVisibilityEditing = () => {
    setAudienceDraft(microphoneAudiences);
    setIsEditingVisibility(false);
  };

  const saveVisibility = async () => {
    const saved = await onSave(microphones, audienceDraft, "visibility");
    if (saved) setIsEditingVisibility(false);
  };

  const saveMicrophones = async () => {
    await onSave(draft, microphoneAudiences, "microphones");
  };

  const teamFilterControls = positionTeams.length > 1 ? (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-gray-400">Filter by team</p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by team">
        <Button
          type="button"
          variant={!visibilityTeamFilter ? "cta" : "tertiary"}
          aria-pressed={!visibilityTeamFilter}
          className="max-md:min-h-0 rounded-full px-2 py-0.5 text-xs"
          onClick={() => chooseVisibilityTeam("")}
        >
          All teams
        </Button>
        {positionTeams.map((team) => {
          const selected = team.id === visibilityTeamFilter;
          return (
            <Button
              key={team.id}
              type="button"
              variant={selected ? "cta" : "tertiary"}
              aria-pressed={selected}
              className="max-md:min-h-0 rounded-full px-2 py-0.5 text-xs"
              onClick={() => chooseVisibilityTeam(team.id)}
            >
              {team.name}
            </Button>
          );
        })}
      </div>
    </div>
  ) : null;

  const emptyMicrophones = (
    <div className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-center">
      <Mic2 className="mx-auto size-6 text-gray-500" aria-hidden />
      <p className="mt-2 text-sm font-medium text-gray-200">No microphones yet</p>
      <p className="mt-1 text-xs text-gray-400">
        Add the microphones your teams use, then assign them to plan items.
      </p>
    </div>
  );

  const microphonesContent = showCompactList ? (
    draft.length === 0 ? (
      emptyMicrophones
    ) : (
      <div className={microphoneCatalogGridClassName}>
        {draft.map((microphone, index) => {
          const title = microphoneTitle(microphone, index);
          const typeLabel = microphone.type.trim();
          return (
            <div
              key={microphone.id}
              aria-label={title}
              className="flex items-center gap-2.5 rounded-md border border-gray-800 bg-gray-900/60 px-2.5 py-2"
            >
              <ServicePlanMicrophoneIcon
                microphone={microphone}
                color={microphone.color}
                className="size-7 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-100">{title}</p>
                {typeLabel ? (
                  <p className="truncate text-xs text-gray-400">{typeLabel}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    )
  ) : (
    draft.length === 0 ? (
      emptyMicrophones
    ) : (
      <div className={microphoneCatalogGridClassName}>
        {draft.map((microphone, index) => {
          const title = microphoneTitle(microphone, index);
          const isCustomType = !isPresetServicePlanMicrophoneType(microphone.type);
          return (
            <section
              key={microphone.id}
              aria-label={title}
              className="flex h-full flex-col gap-2 rounded-md border border-gray-800 bg-gray-900/60 p-2"
            >
              <div className="flex items-center gap-2">
                <ServicePlanMicrophoneIcon
                  microphone={microphone}
                  color={microphone.color}
                  className="size-7 shrink-0"
                />
                {isLocked ? (
                  <div
                    className="size-7 shrink-0 rounded-md border-2 border-white/25"
                    style={{ backgroundColor: microphone.color }}
                    aria-label={`Color for ${title}: ${microphone.color}`}
                  />
                ) : (
                  <div className="w-fit shrink-0 [&_button]:w-auto [&_button]:min-w-0 [&_button]:px-2">
                    <ColorField
                      className="w-fit"
                      label={`Color for ${title}`}
                      hideLabel
                      value={microphone.color}
                      onChange={(color) => updateMicrophone(microphone.id, { color })}
                    />
                  </div>
                )}
                <Button
                  type="button"
                  variant="tertiary"
                  svg={Trash2}
                  className={cn("ml-auto shrink-0", teamsRowIconButtonClassName)}
                  padding={teamsRowIconButtonPadding}
                  disabled={isLocked}
                  aria-label={`Remove ${title}`}
                  onClick={() => removeMicrophone(microphone.id)}
                />
              </div>
              <Input
                label="Name"
                hideLabel
                placeholder="Name"
                className="min-w-0 w-full"
                value={microphone.name}
                disabled={isLocked}
                onChange={(name) => updateMicrophone(microphone.id, { name: String(name) })}
              />
              <Select
                label="Type"
                hideLabel
                className="w-full min-w-0"
                selectClassName="h-10"
                value={
                  isPresetServicePlanMicrophoneType(microphone.type)
                    ? microphone.type
                    : SERVICE_PLAN_MICROPHONE_CUSTOM_TYPE
                }
                options={servicePlanMicrophoneTypeOptions}
                disabled={isLocked}
                onChange={(type) => updateMicrophone(microphone.id, {
                  type: type === SERVICE_PLAN_MICROPHONE_CUSTOM_TYPE ? "" : type,
                })}
              />
              {isCustomType ? (
                <Input
                  label="Custom type"
                  hideLabel
                  placeholder="Custom type (e.g. Instrument mic)"
                  className="min-w-0 w-full"
                  value={microphone.type}
                  disabled={isLocked}
                  onChange={(type) => updateMicrophone(microphone.id, {
                    type: String(type),
                  })}
                />
              ) : null}
            </section>
          );
        })}
      </div>
    )
  );

  const visibilityContent = (
    <div className="space-y-3">
      {positionNoteOptions.length ? teamFilterControls : null}
      {isVisibilityLocked ? (
        selectedPositionsByTeam.length ? (
          <div className="space-y-3">
            {selectedPositionsByTeam.map((group) => (
              <div key={group.heading} className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {group.heading}
                </p>
                <ul className={microphoneCatalogGridClassName}>
                  {group.positions.map((position) => {
                    const PositionIcon = resolvePositionLucideIcon(position.icon);
                    return (
                      <li
                        key={position.positionId}
                        className="flex min-h-8 items-center gap-2 rounded-md border border-gray-800 bg-gray-900/60 px-2 py-1.5 text-sm text-gray-300"
                      >
                        {PositionIcon ? (
                          <Icon
                            svg={PositionIcon}
                            size="sm"
                            className="shrink-0 text-orange-300"
                            alt=""
                          />
                        ) : (
                          <span className="size-4 shrink-0" aria-hidden />
                        )}
                        <span className="truncate">{positionOptionLabel(position)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-300">
            {selectedPositionOptions.length && visibilityTeamFilter
              ? "No selected positions on this team."
              : "No positions selected"}
          </p>
        )
      ) : positionNoteOptions.length ? (
        positionGroups.length ? (
          <div className="space-y-3">
            {positionGroups.map((group) => (
              <div key={group.heading} className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {group.heading}
                </p>
                <div
                  className={cn(
                    microphoneCatalogGridClassName,
                    "rounded-md border border-gray-700 bg-gray-950/60 p-2",
                  )}
                >
                  {group.positions.map((position) => {
                    const PositionIcon = resolvePositionLucideIcon(position.icon);
                    const checked = audienceDraft.some(
                      (audience) => audience.positionId === position.positionId,
                    );
                    return (
                      <Checkbox
                        key={position.positionId}
                        className="rounded px-2 py-1"
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          toggleAudiencePosition(position.positionId, nextChecked)
                        }
                        label={
                          <>
                            {PositionIcon ? (
                              <Icon
                                svg={PositionIcon}
                                size="sm"
                                className="shrink-0 text-orange-300"
                                alt=""
                              />
                            ) : null}
                            <span className="truncate">
                              {positionOptionLabel(position)}
                            </span>
                          </>
                        }
                        labelClassName="gap-2 text-sm"
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No positions on this team.</p>
        )
      ) : (
        <p className="text-sm text-gray-400">
          Add team positions before choosing who can see microphone notes.
        </p>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto pt-2 pr-1">
        {microphonesContent}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-gray-800 pt-3">
        {isEditing && hasIncompleteMicrophone ? (
          <p className="text-xs text-amber-200" role="status">
            Complete each microphone&apos;s name and type before saving.
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="tertiary"
            svg={Eye}
            className="self-start"
            aria-label={
              hasUnsavedVisibilityChanges
                ? "Mic note visibility (unsaved changes)"
                : "Mic note visibility"
            }
            onClick={() => setVisibilityOpen(true)}
          >
            Mic note visibility
            {hasUnsavedVisibilityChanges ? (
              <span className="ml-1 size-1.5 rounded-full bg-amber-400" aria-hidden />
            ) : null}
          </Button>
          {!isEditing && !disabled ? (
            <Button
              type="button"
              svg={Pencil}
              className="self-end sm:self-auto"
              aria-label="Edit microphones"
              onClick={onStartEditing}
            >
              Edit
            </Button>
          ) : null}
          {isEditing ? (
            <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                svg={Plus}
                disabled={isLocked || draft.length >= MAX_SERVICE_PLAN_MICROPHONES}
                aria-label="Add microphone"
                onClick={() => setDraft((current) => [...current, createMicrophone()])}
              >
                Add
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="tertiary"
                  svg={X}
                  disabled={saving}
                  onClick={cancelEditing}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="cta"
                  svg={Save}
                  disabled={isLocked || hasIncompleteMicrophone}
                  aria-label={
                    saving && isEditing ? "Saving microphones" : "Save microphones"
                  }
                  onClick={() => void saveMicrophones()}
                >
                  {saving && isEditing ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <Sheet open={visibilityOpen} onOpenChange={setVisibilityOpen}>
        <SheetContent
          side="right"
          className="max-w-xl sm:max-w-2xl"
        >
          <SheetHeader>
            <SheetTitle>Mic note visibility</SheetTitle>
            <SheetDescription>
              Roles selected here can read microphone notes on service plans.
            </SheetDescription>
          </SheetHeader>
          <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {visibilityContent}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-700 px-6 py-4">
            {!isEditingVisibility && !disabled ? (
              <Button
                type="button"
                svg={Pencil}
                className="ml-auto"
                onClick={() => setIsEditingVisibility(true)}
              >
                Edit visibility
              </Button>
            ) : null}
            {isEditingVisibility ? (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="tertiary"
                  svg={X}
                  disabled={saving}
                  onClick={cancelVisibilityEditing}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="cta"
                  svg={Save}
                  disabled={isVisibilityLocked}
                  onClick={() => void saveVisibility()}
                >
                  {saving && isEditingVisibility ? "Saving…" : "Save visibility"}
                </Button>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ServicePlanMicrophoneManager;
