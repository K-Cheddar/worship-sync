import { useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  getServicePlanMicrophones,
  saveServicePlanMicrophones,
  getServiceEquipment,
  saveServiceEquipment,
} from "../../../api/auth";
import Button from "../../../components/Button/Button";
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
  teamsPanelMaxHeightClassName,
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
      setIsEditing(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
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
      .catch(() => {
        if (!cancelled) {
          setIemEquipment([]);
          setIemDraft([]);
        }
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
      <h2 className="sr-only">Audio Equipment</h2>
      <section
        className={cn(
          panelShellClassName,
          "flex flex-col",
          teamsPanelMaxHeightClassName,
        )}
      >
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            panelScrollPaddingClassName,
          )}
        >
          {loading ? (
            <TeamsMicrophonesListSkeleton />
          ) : (
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
            />
          )}
          {!loading ? (
            <section aria-labelledby="iem-catalog-heading" className="mt-4 rounded-lg border border-gray-700/70 bg-gray-900/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 id="iem-catalog-heading" className="text-sm font-semibold text-white">In-Ear Monitors (IEMs)</h3>
                  <p className="mt-1 text-xs text-gray-400">Manage the physical IEMs/beltpacks available for assignments.</p>
                </div>
                {canEdit ? (isEditingIems ? (
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" disabled={savingIems} onClick={() => { setIemDraft(iemEquipment); setIsEditingIems(false); }}>Cancel</Button>
                    <Button type="button" variant="primary" disabled={savingIems} onClick={() => void saveIems()}>{savingIems ? "Saving…" : "Save IEMs"}</Button>
                  </div>
                ) : <Button type="button" variant="secondary" onClick={() => { setIemDraft(iemEquipment); setIsEditingIems(true); }}>Edit IEMs</Button>) : null}
              </div>
              <div className="mt-3 space-y-2">
                {(isEditingIems ? iemDraft : iemEquipment).map((item, index) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border border-gray-700/60 p-2">
                    {isEditingIems ? <>
                      <input aria-label={`IEM ${index + 1} name`} className="min-w-36 flex-1 rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-white" value={item.name} onChange={(event) => setIemDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, name: event.target.value } : entry))} />
                      <input aria-label={`IEM ${index + 1} type`} className="min-w-28 flex-1 rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-white" placeholder="Type (optional)" value={item.subtype || ""} onChange={(event) => setIemDraft((current) => current.map((entry) => entry.id === item.id ? { ...entry, subtype: event.target.value || undefined } : entry))} />
                      <Button type="button" variant="tertiary" disabled={savingIems} onClick={() => setIemDraft((current) => current.filter((entry) => entry.id !== item.id))}>Remove</Button>
                    </> : <><span className="text-sm font-medium text-white">{item.name}</span><span className="text-xs text-gray-400">{item.subtype || "IEM"}</span></>}
                  </div>
                ))}
                {isEditingIems ? <Button type="button" variant="tertiary" disabled={savingIems} onClick={() => setIemDraft((current) => [...current, { id: generateRandomId(), category: "iem", name: `IEM ${current.length + 1}`, subtype: "wireless-beltpack" }])}>Add IEM</Button> : iemEquipment.length === 0 ? <p className="text-sm text-gray-400">No IEMs configured.</p> : null}
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
};

export default TeamsMicrophonesPage;
