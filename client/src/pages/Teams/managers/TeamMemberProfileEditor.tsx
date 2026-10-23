import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../../../components/Button/Button";
import Select from "../../../components/Select/Select";
import { useToast } from "../../../context/toastContext";
import {
  getTeamRosterMemberProfile,
  updateTeamRosterMemberProfile,
  type TeamMemberProfile,
  type TeamMemberTeamProfile,
} from "../../../api/auth";
import type {
  TeamPosition,
  TeamQualificationArea,
  TeamQualificationLevel,
  TeamRecord,
  TeamRole,
} from "../../../api/authTypes";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import MemberTeamProfileFields from "./MemberTeamProfileFields";

const safeMemberName = (member: TeamMemberProfile | null) =>
  member ? [member.title, member.firstName, member.lastName].filter(Boolean).join(" ") : "team member";

export type TeamMemberProfileEditorStatus = {
  identity: string;
  loading: boolean;
  saving: boolean;
  hasPendingChanges: boolean;
  save: () => void;
};

type Props = {
  churchId: string;
  team: TeamRecord;
  teams: TeamRecord[];
  member: TeamMemberProfile | null;
  initialProfile?: TeamMemberTeamProfile;
  positions: TeamPosition[];
  roles: TeamRole[];
  qualificationAreas: TeamQualificationArea[];
  qualificationLevels: TeamQualificationLevel[];
  onTeamChange: (teamId: string) => void;
  onEditorStateChange: (status: TeamMemberProfileEditorStatus) => void;
  onSaved: (memberId: string) => void;
};

const TeamMemberProfileEditor = ({
  churchId,
  team,
  teams,
  member,
  initialProfile,
  positions,
  roles,
  qualificationAreas,
  qualificationLevels,
  onTeamChange,
  onEditorStateChange,
  onSaved,
}: Props) => {
  const selectedMemberId = member?.memberId;
  const selectedMemberName = safeMemberName(member);
  const identity = `${churchId}:${team.teamId}:${selectedMemberId || ""}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const mountedRef = useRef(false);
  const { showToast } = useToast();
  const hasInitialProfile = initialProfile?.teamId === team.teamId;
  const [profile, setProfile] = useState<TeamMemberTeamProfile | null>(
    hasInitialProfile ? initialProfile : null,
  );
  const [savedProfile, setSavedProfile] = useState<TeamMemberTeamProfile | null>(
    hasInitialProfile ? initialProfile : null,
  );
  const [loadedIdentity, setLoadedIdentity] = useState(hasInitialProfile ? identity : "");
  const [loadError, setLoadError] = useState<{ identity: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const currentProfile = loadedIdentity === identity ? profile : null;
  const currentSavedProfile = loadedIdentity === identity ? savedProfile : null;
  const currentLoadError = loadError?.identity === identity ? loadError.message : "";
  const loading = Boolean(selectedMemberId) && !currentProfile && !currentLoadError;
  const hasPendingChanges = Boolean(
    currentProfile &&
    currentSavedProfile &&
    JSON.stringify(currentProfile) !== JSON.stringify(currentSavedProfile),
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!selectedMemberId) return undefined;
    if (initialProfile?.teamId === team.teamId) {
      if (loadedIdentity !== identity) {
        setProfile(initialProfile);
        setSavedProfile(initialProfile);
        setLoadedIdentity(identity);
      }
      return undefined;
    }
    if (loadedIdentity === identity) return undefined;
    let active = true;
    setLoadError(null);
    void getTeamRosterMemberProfile(churchId, team.teamId, selectedMemberId)
      .then((response) => {
        if (!active) return;
        setProfile(response.teamProfile);
        setSavedProfile(response.teamProfile);
        setLoadedIdentity(identity);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError({
          identity,
          message: error instanceof Error
            ? error.message
            : "Could not load this team profile.",
        });
      });
    return () => { active = false; };
  }, [churchId, identity, initialProfile, loadedIdentity, requestVersion, selectedMemberId, team.teamId]);

  const updateCurrentProfile = (update: (current: TeamMemberTeamProfile) => TeamMemberTeamProfile) => {
    setProfile((current) => current && loadedIdentity === identity ? update(current) : current);
  };

  const save = useCallback(async () => {
    if (!member || !currentProfile || saving || !hasPendingChanges) return;
    const saveIdentity = identity;
    setSaving(true);
    try {
      const response = await updateTeamRosterMemberProfile(churchId, team.teamId, member.memberId, {
        positionIds: currentProfile.positionIds,
        desiredPositionIds: currentProfile.desiredPositionIds,
        membership: {
          roleId: currentProfile.membership.roleId || null,
        },
        qualifications: currentProfile.qualifications.map((qualification) => ({
          qualificationId: qualification.qualificationId,
          areaId: qualification.areaId,
          levelId: qualification.levelId,
          teamId: qualification.teamId,
          status: qualification.status,
          completedAt: qualification.completedAt,
          expiresAt: qualification.expiresAt,
          notes: qualification.notes,
        })),
      });
      onSaved(member.memberId);
      if (mountedRef.current && identityRef.current === saveIdentity) {
        setProfile(response.teamProfile);
        setSavedProfile(response.teamProfile);
        setLoadedIdentity(saveIdentity);
        showToast({ message: `${selectedMemberName}'s ${team.name} profile was saved.`, variant: "success" });
      }
    } catch (saveError) {
      if (mountedRef.current && identityRef.current === saveIdentity) {
        showApiErrorToast(showToast, saveError, "Could not save this team profile.");
      }
    } finally {
      if (mountedRef.current && identityRef.current === saveIdentity) setSaving(false);
    }
  }, [
    churchId,
    currentProfile,
    hasPendingChanges,
    identity,
    member,
    onSaved,
    saving,
    selectedMemberName,
    showToast,
    team.name,
    team.teamId,
  ]);

  useEffect(() => {
    onEditorStateChange({ identity, loading, saving, hasPendingChanges, save: () => void save() });
  }, [hasPendingChanges, identity, loading, onEditorStateChange, save, saving]);

  return (
    <div className="min-w-0 space-y-5">
      <div className="space-y-2">
        {teams.length > 1 ? (
          <Select
            label="Team profile"
            value={team.teamId}
            disabled={saving}
            onChange={onTeamChange}
            options={teams.map((availableTeam) => ({
              value: availableTeam.teamId,
              label: availableTeam.name,
            }))}
          />
        ) : null}
        <h3 className="text-base font-semibold text-gray-100">{team.name}</h3>
      </div>

      {loading ? (
        <div aria-busy="true" className="space-y-4">
          <p role="status" className="text-sm text-gray-300">Loading {team.name} profile…</p>
          <div className="space-y-4 text-sm text-gray-400" aria-hidden="true">
            <div className="space-y-2">
              <p className="font-semibold text-gray-300">Positions</p>
              <div className="h-12 animate-pulse rounded-md border border-gray-700 bg-gray-950/60" />
            </div>
            <p className="rounded-md border border-gray-700 bg-gray-950/60 px-3 py-3">Desired positions</p>
            <p className="rounded-md border border-gray-700 bg-gray-950/60 px-3 py-3">Team roles</p>
            <div className="space-y-2">
              <p className="font-semibold text-gray-300">Qualifications</p>
              <div className="h-24 animate-pulse rounded-md border border-gray-700 bg-gray-950/60" />
            </div>
          </div>
        </div>
      ) : null}
      {currentLoadError ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm text-red-300">{currentLoadError}</p>
          <Button type="button" variant="secondary" onClick={() => setRequestVersion((value) => value + 1)}>
            Try again
          </Button>
        </div>
      ) : null}
      {currentProfile ? (
        <MemberTeamProfileFields
          teams={[team]}
          positions={[
            ...positions.filter((position) => position.teamId === team.teamId),
            ...[...new Set([...currentProfile.positionIds, ...currentProfile.desiredPositionIds])]
              .filter((positionId) => !positions.some((position) => position.positionId === positionId))
              .map((positionId) => ({
                positionId,
                churchId,
                teamId: team.teamId,
                name: `Archived position (${positionId})`,
                archivedAt: "archived",
              })),
          ]}
          roles={roles.filter((role) => role.teamId === team.teamId)}
          qualificationAreas={[
            ...qualificationAreas.filter((area) => area.teamId === team.teamId),
            ...[...new Set(currentProfile.qualifications.map((qualification) => qualification.areaId))]
              .filter((areaId) => !qualificationAreas.some((area) => area.areaId === areaId))
              .map((areaId) => ({
                areaId,
                churchId,
                teamId: team.teamId,
                name: `Archived qualification area (${areaId})`,
                archivedAt: "archived",
              })),
          ]}
          qualificationLevels={qualificationLevels.filter((level) =>
            qualificationAreas.some((area) => area.teamId === team.teamId && area.areaId === level.areaId) ||
            currentProfile.qualifications.some((qualification) => qualification.areaId === level.areaId))}
          selectedTeamIds={[team.teamId]}
          positionIds={currentProfile.positionIds}
          desiredPositionIds={currentProfile.desiredPositionIds}
          teamMemberships={{
            [team.teamId]: {
              teamId: team.teamId,
              roleId: currentProfile.membership.roleId,
            },
          }}
          qualifications={currentProfile.qualifications}
          disabled={saving}
          onPositionIdsChange={(positionIds) => updateCurrentProfile((current) => ({ ...current, positionIds }))}
          onDesiredPositionIdsChange={(desiredPositionIds) => updateCurrentProfile((current) => ({ ...current, desiredPositionIds }))}
          onRoleChange={(_teamId, roleId) => updateCurrentProfile((current) => ({
            ...current,
            membership: { ...current.membership, roleId },
          }))}
          onQualificationsChange={(qualifications) => updateCurrentProfile((current) => ({ ...current, qualifications }))}
        />
      ) : null}
    </div>
  );
};

export default TeamMemberProfileEditor;
