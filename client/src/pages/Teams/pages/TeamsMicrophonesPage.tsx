import { useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import { Mic2 } from "lucide-react";
import Icon from "../../../components/Icon/Icon";
import Spinner from "../../../components/Spinner/Spinner";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  getServicePlanMicrophones,
  saveServicePlanMicrophones,
} from "../../../api/auth";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import ServicePlanMicrophoneManager from "../../Services/ServicePlanMicrophoneManager";
import { collectServicePlanRoleNoteOptions } from "../../Services/servicePlanNoteOptions";
import { useTeamsPage } from "../TeamsPageContext";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import {
  panelHeaderPaddingClassName,
  panelScrollPaddingClassName,
  panelShellClassName,
  teamsManagerPageRootClassName,
  teamsPanelMaxHeightClassName,
} from "../teamsStyles";
import { cn } from "@/utils/cnHelper";
import type {
  ServicePlanMicrophone,
  ServicePlanMicrophoneAudience,
} from "../../../types/servicePlan";

/** Church-wide microphone catalog; plan rows only assign from this list. */
const TeamsMicrophonesPage = () => {
  const { churchId, canEditServices, canEditTeams: canEditTeamsFromContext } =
    useContext(GlobalInfoContext) || {};
  const { canEditTeams, pageData } = useTeamsPage();
  const microphoneGuardId = useId();
  const { setDirtySource } = useTeamsNavigationGuard();
  const { showToast } = useToast();
  const canEdit = Boolean(
    canEditServices ?? canEditTeamsFromContext ?? canEditTeams,
  );
  const [microphones, setMicrophones] = useState<ServicePlanMicrophone[]>([]);
  const [microphoneAudiences, setMicrophoneAudiences] = useState<
    ServicePlanMicrophoneAudience[]
  >([]);
  const [loading, setLoading] = useState(Boolean(churchId));
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const handleDirtyChange = useCallback(
    (isDirty: boolean) => setDirtySource(microphoneGuardId, isDirty),
    [microphoneGuardId, setDirtySource],
  );

  useEffect(
    () => () => setDirtySource(microphoneGuardId, false),
    [microphoneGuardId, setDirtySource],
  );
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
    return () => {
      cancelled = true;
    };
  }, [churchId, showToast]);

  const handleSave = async (
    next: ServicePlanMicrophone[],
    nextAudiences: ServicePlanMicrophoneAudience[],
    saveTarget: "microphones" | "visibility",
  ) => {
    if (!churchId) return;
    const microphonesToSave =
      saveTarget === "microphones" ? next : microphones;
    const audiencesToSave =
      saveTarget === "visibility" ? nextAudiences : microphoneAudiences;
    const hasUnsavedChangesOnOtherTab =
      saveTarget === "microphones"
        ? JSON.stringify(nextAudiences) !== JSON.stringify(microphoneAudiences)
        : JSON.stringify(next) !== JSON.stringify(microphones);
    setSaving(true);
    try {
      const result = await saveServicePlanMicrophones(
        churchId,
        microphonesToSave,
        audiencesToSave,
      );
      setMicrophones(result.microphones);
      setMicrophoneAudiences(result.audiences || []);
      setIsEditing(hasUnsavedChangesOnOtherTab);
      showToast(
        saveTarget === "visibility"
          ? "Who sees microphone notes saved."
          : "Microphone list saved.",
        "success",
      );
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save the microphone list.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={teamsManagerPageRootClassName}>
      <section
        className={cn(
          panelShellClassName,
          "flex flex-col",
          teamsPanelMaxHeightClassName,
        )}
      >
        <div className={cn("shrink-0", panelHeaderPaddingClassName)}>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon svg={Mic2} size="md" className="text-violet-300" />
            Microphones
          </h2>
        </div>
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            panelScrollPaddingClassName,
          )}
        >
          {loading ? (
            <div className="flex h-32 items-center justify-center gap-3 text-sm text-gray-400">
              <Spinner width="20px" borderWidth="3px" /> Loading microphones…
            </div>
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
        </div>
      </section>
    </div>
  );
};

export default TeamsMicrophonesPage;
