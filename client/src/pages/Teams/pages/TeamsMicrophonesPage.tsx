import { useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import { Headphones, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  getServicePlanMicrophones,
  saveServicePlanMicrophones,
  getServiceEquipment,
  saveServiceEquipment,
} from "../../../api/auth";
import Button from "../../../components/Button/Button";
import ColorField from "../../../components/ColorField/ColorField";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import {
  SERVICE_EQUIPMENT_CUSTOM_SUBTYPE,
  SERVICE_EQUIPMENT_DEFAULT_COLOR,
  NEW_SERVICE_EQUIPMENT_COLOR,
  ServiceEquipmentIcon,
  getServiceEquipmentSubtypeLabel,
  isPresetServiceEquipmentSubtype,
  serviceEquipmentSubtypeOptions,
} from "../../../components/ServiceEquipmentIcon";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import ServicePlanMicrophoneManager from "../../Services/ServicePlanMicrophoneManager";
import { collectServicePlanRoleNoteOptions } from "../../Services/servicePlanNoteOptions";
import { useTeamsPage } from "../TeamsPageContext";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import { TeamsMicrophonesListSkeleton } from "../teamsPageSkeletons";
import {
  panelScrollPaddingClassName,
  panelShellClassName,
  teamsManagerPageRootClassName,
  teamsRowIconButtonClassName,
  teamsRowIconButtonPadding,
  equipmentCatalogGridClassName,
} from "../teamsStyles";
import { cn } from "@/utils/cnHelper";
import generateRandomId from "../../../utils/generateRandomId";
import type {
  ServicePlanMicrophone,
  ServicePlanMicrophoneAudience,
} from "../../../types/servicePlan";
import type { ServiceEquipment } from "../../../types/servicePlan";

/** Church-wide microphone catalog; plan rows only assign from this list. */
const TeamsMicrophonesPage = () => {
  const { churchId, canEditServices, canEditTeams: canEditTeamsFromContext } =
    useContext(GlobalInfoContext) || {};
  const { canEditTeams, pageData } = useTeamsPage();
  const microphoneGuardId = useId();
  const iemGuardId = useId();
  const { setDirtySource } = useTeamsNavigationGuard();
  const { showToast } = useToast();
  const canEdit = Boolean(
    canEditServices ?? canEditTeamsFromContext ?? canEditTeams,
  );
  const [microphones, setMicrophones] = useState<ServicePlanMicrophone[]>([]);
  const [microphoneAudiences, setMicrophoneAudiences] = useState<
    ServicePlanMicrophoneAudience[]
  >([]);
  const [iemEquipment, setIemEquipment] = useState<ServiceEquipment[]>([]);
  const [iemDraft, setIemDraft] = useState<ServiceEquipment[]>([]);
  const [isEditingIems, setIsEditingIems] = useState(false);
  const [savingIems, setSavingIems] = useState(false);
  const [loadingIems, setLoadingIems] = useState(Boolean(churchId));
  const [iemLoadError, setIemLoadError] = useState(false);
  const [loading, setLoading] = useState(Boolean(churchId));
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const handleDirtyChange = useCallback(
    (isDirty: boolean) => setDirtySource(microphoneGuardId, isDirty),
    [microphoneGuardId, setDirtySource],
  );

  useEffect(
    () => () => {
      setDirtySource(microphoneGuardId, false);
      setDirtySource(iemGuardId, false);
    },
    [iemGuardId, microphoneGuardId, setDirtySource],
  );
  useEffect(() => setDirtySource(iemGuardId, isEditingIems && JSON.stringify(iemDraft) !== JSON.stringify(iemEquipment)), [iemDraft, iemEquipment, isEditingIems, iemGuardId, setDirtySource]);
  const positionNoteOptions = useMemo(
    () => collectServicePlanRoleNoteOptions(
      [],
      pageData.positions,
      pageData.teams,
      microphoneAudiences,
    ),
    [microphoneAudiences, pageData.positions, pageData.teams],
  );

  useEffect(() => {
    if (!churchId) {
      setMicrophones([]);
      setMicrophoneAudiences([]);
      setIemEquipment([]);
      setIemDraft([]);
      setIsEditingIems(false);
      setLoadingIems(false);
      setIemLoadError(false);
      setIsEditing(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoadingIems(true);
    setIemLoadError(false);
    setLoading(true);
    getServicePlanMicrophones(churchId)
      .then((res) => {
        if (!cancelled) {
          setMicrophones(res.microphones);
          setMicrophoneAudiences(res.audiences || []);
          setIsEditing(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          showApiErrorToast(showToast, error, "Could not load the microphone list.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    Promise.resolve().then(() => getServiceEquipment(churchId))
      .then((result) => {
        if (!cancelled) {
          const iems = result.equipment.filter((item) => item.category === "iem");
          setIemEquipment(iems);
          setIemDraft(iems);
          setIsEditingIems(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setIemEquipment([]);
          setIemDraft([]);
          setIemLoadError(true);
          showApiErrorToast(showToast, error, "Could not load the IEM list.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingIems(false);
      });
    return () => {
      cancelled = true;
    };
  }, [churchId, showToast]);

  const saveIems = async () => {
    if (!churchId || savingIems) return;
    setSavingIems(true);
    try {
      const result = await saveServiceEquipment(churchId, iemDraft);
      const iems = result.equipment.filter((item) => item.category === "iem");
      setIemEquipment(iems);
      setIemDraft(iems);
      setIsEditingIems(false);
      showToast("IEM list saved.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save the IEM list.");
    } finally {
      setSavingIems(false);
    }
  };

  const visibleIems = isEditingIems ? iemDraft : iemEquipment;
  const hasIncompleteIem = iemDraft.some((item) => !item.name.trim());
  const updateIem = (id: string, changes: Partial<ServiceEquipment>) =>
    setIemDraft((current) => current.map((item) =>
      item.id === id ? { ...item, ...changes } : item,
    ));
  const addIem = () => setIemDraft((current) => [...current, {
    id: generateRandomId(),
    category: "iem",
    name: `IEM ${current.length + 1}`,
    subtype: "wireless-beltpack",
    color: NEW_SERVICE_EQUIPMENT_COLOR,
  }]);

  const handleSave = async (
    next: ServicePlanMicrophone[],
    nextAudiences: ServicePlanMicrophoneAudience[],
    saveTarget: "microphones" | "visibility",
  ): Promise<boolean> => {
    if (!churchId) return false;
    const microphonesToSave =
      saveTarget === "microphones" ? next : microphones;
    const audiencesToSave =
      saveTarget === "visibility" ? nextAudiences : microphoneAudiences;
    setSaving(true);
    try {
      const result = await saveServicePlanMicrophones(
        churchId,
        microphonesToSave,
        audiencesToSave,
      );
      setMicrophones(result.microphones);
      setMicrophoneAudiences(result.audiences || []);
      showToast(
        saveTarget === "visibility"
          ? "Mic note visibility saved."
          : "Microphone list saved.",
        "success",
      );
      return true;
    } catch (error) {
      showApiErrorToast(
        showToast,
        error,
        saveTarget === "visibility"
          ? "Could not save mic note visibility."
          : "Could not save the microphone list.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={teamsManagerPageRootClassName}>
          <h2 className="text-base font-semibold text-white">Equipment</h2>
      <section
        className={cn(
          panelShellClassName,
          "min-h-0 flex-1 max-lg:flex-none lg:overflow-y-auto scrollbar-variable",
        )}
      >
        <div className={cn("space-y-4", panelScrollPaddingClassName, "pt-4")}>
          {loading ? (
            <TeamsMicrophonesListSkeleton />
          ) : (
            <section aria-labelledby="microphone-catalog-heading">
              <ServicePlanMicrophoneManager
                microphones={microphones}
                microphoneAudiences={microphoneAudiences}
                disabled={!canEdit}
                isEditing={isEditing}
                saving={saving}
                onSave={handleSave}
                onDirtyChange={handleDirtyChange}
                onStartEditing={() => setIsEditing(true)}
                onCancelEditing={() => setIsEditing(false)}
                positionNoteOptions={positionNoteOptions}
                renderHeader={(actions) => (
                  <header className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 id="microphone-catalog-heading" className="text-sm font-semibold text-white">Microphones</h3>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {!actions.editing && !actions.disabled ? (
                        <Button type="button" svg={Pencil} aria-label="Edit microphones" onClick={actions.onStartEditing}>Edit</Button>
                      ) : null}
                      {actions.editing ? (
                        <>
                          <Button type="button" variant="secondary" svg={Plus} disabled={!actions.canAdd} aria-label="Add microphone" onClick={actions.onAdd}>Add</Button>
                          <Button type="button" variant="tertiary" svg={X} disabled={actions.saving} onClick={actions.onCancel}>Cancel</Button>
                          <Button type="button" variant="cta" svg={Save} disabled={!actions.canSave} aria-label={actions.saving ? "Saving microphones" : "Save microphones"} onClick={actions.onSave}>{actions.saving ? "Saving…" : "Save"}</Button>
                        </>
                      ) : null}
                    </div>
                  </header>
                )}
              />
            </section>
          )}
          {!loading ? (
            <section aria-labelledby="iem-catalog-heading" className="border-t border-gray-700/70 pt-4">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 id="iem-catalog-heading" className="text-sm font-semibold text-white">In-Ear Monitors (IEMs)</h3>
                  <p className="mt-1 text-xs text-gray-400">Manage the physical IEMs/beltpacks available for assignments.</p>
                </div>
                {!isEditingIems && canEdit && !loadingIems && !iemLoadError ? (
                  <Button type="button" svg={Pencil} className="self-start sm:self-auto" aria-label="Edit IEMs" onClick={() => { setIemDraft(iemEquipment); setIsEditingIems(true); }}>Edit</Button>
                ) : null}
                {isEditingIems && canEdit && !loadingIems && !iemLoadError ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" svg={Plus} disabled={savingIems || iemDraft.length >= 80} aria-label="Add IEM" onClick={addIem}>Add</Button>
                    <Button type="button" variant="tertiary" svg={X} disabled={savingIems} onClick={() => { setIemDraft(iemEquipment); setIsEditingIems(false); }}>Cancel</Button>
                    <Button type="button" variant="cta" svg={Save} disabled={savingIems || hasIncompleteIem} aria-label={savingIems ? "Saving IEMs" : "Save IEMs"} onClick={() => void saveIems()}>{savingIems ? "Saving…" : "Save"}</Button>
                  </div>
                ) : null}
              </div>
              <div className="mt-3">
                {loadingIems ? (
                  <p role="status" className="py-6 text-center text-sm text-gray-400">Loading IEMs…</p>
                ) : iemLoadError ? (
                  <p role="alert" className="py-6 text-center text-sm text-amber-200">Could not load IEMs. Refresh the page to try again.</p>
                ) : visibleIems.length ? (
                  <div className={equipmentCatalogGridClassName}>
                    {visibleIems.map((item, index) => {
                      const title = item.name.trim() || `IEM ${index + 1}`;
                      const isCustomSubtype = !isPresetServiceEquipmentSubtype(item.subtype);
                      return isEditingIems ? (
                        <section key={item.id} aria-label={title} className="flex h-full flex-col gap-2 rounded-md border border-gray-800 bg-gray-900/60 p-2">
                          <div className="flex items-center gap-2">
                            <ServiceEquipmentIcon equipment={item} color={item.color} className="size-7 shrink-0" />
                            <div className="w-fit shrink-0 [&_button]:w-auto [&_button]:min-w-0 [&_button]:px-2">
                              <ColorField alpha={false} className="w-fit" label={`Color for ${title}`} hideLabel value={item.color || SERVICE_EQUIPMENT_DEFAULT_COLOR} onChange={(color) => updateIem(item.id, { color })} />
                            </div>
                            <Button type="button" variant="tertiary" svg={Trash2} className={cn("ml-auto shrink-0", teamsRowIconButtonClassName)} padding={teamsRowIconButtonPadding} disabled={savingIems} aria-label={`Remove ${title}`} onClick={() => setIemDraft((current) => current.filter((entry) => entry.id !== item.id))} />
                          </div>
                          <Input label="Name" hideLabel placeholder="Name" className="min-w-0 w-full" value={item.name} disabled={savingIems} onChange={(name) => updateIem(item.id, { name: String(name) })} />
                          <Select label="Type" hideLabel className="w-full min-w-0" selectClassName="h-10" value={isCustomSubtype ? SERVICE_EQUIPMENT_CUSTOM_SUBTYPE : item.subtype || "wireless-beltpack"} options={serviceEquipmentSubtypeOptions.map(({ value, label }) => ({ value, label }))} disabled={savingIems} onChange={(subtype) => updateIem(item.id, { subtype: subtype === SERVICE_EQUIPMENT_CUSTOM_SUBTYPE ? (isPresetServiceEquipmentSubtype(item.subtype) ? "" : item.subtype) : subtype })} />
                          {isCustomSubtype ? <Input label="Custom type" hideLabel placeholder="Custom type" className="min-w-0 w-full" value={item.subtype || ""} disabled={savingIems} onChange={(subtype) => updateIem(item.id, { subtype: String(subtype) })} /> : null}
                        </section>
                      ) : (
                        <div key={item.id} aria-label={title} className="flex items-center gap-2.5 rounded-md border border-gray-800 bg-gray-900/60 px-2.5 py-2">
                          <ServiceEquipmentIcon equipment={item} color={item.color} className="size-7 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-100">{title}</p>
                            <p className="truncate text-xs text-gray-400">{getServiceEquipmentSubtypeLabel(item.subtype)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-center">
                    <Headphones className="mx-auto size-6 text-gray-500" aria-hidden />
                    <p className="mt-2 text-sm font-medium text-gray-200">No IEMs yet</p>
                    <p className="mt-1 text-xs text-gray-400">Add the IEMs or beltpacks your teams use, then assign them to people and schedule positions.</p>
                  </div>
                )}
              </div>
              {canEdit && isEditingIems && !loadingIems && !iemLoadError && hasIncompleteIem ? <p className="mt-2 text-xs text-amber-200" role="status">Add a name to each IEM before saving.</p> : null}
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
};

export default TeamsMicrophonesPage;
