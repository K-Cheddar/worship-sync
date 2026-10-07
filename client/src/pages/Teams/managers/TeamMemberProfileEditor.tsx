import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Button from "../../../components/Button/Button";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Modal from "../../../components/Modal/Modal";
import Select from "../../../components/Select/Select";
import DatePicker from "../../../components/ui/DatePicker";
import TextArea from "../../../components/TextArea/TextArea";
import { useToast } from "../../../context/toastContext";
import {
  getTeamRosterMemberProfile,
  updateTeamRosterMemberProfile,
  type TeamMemberProfile,
  type TeamMemberTeamProfile,
} from "../../../api/auth";
import type {
  TeamQualificationArea,
  TeamQualificationLevel,
  TeamPosition,
  TeamRecord,
  TeamRole,
} from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import { showApiErrorToast } from "../../../utils/apiErrorToast";

const safeMemberName = (member: TeamMemberProfile | null) =>
  member ? [member.title, member.firstName, member.lastName].filter(Boolean).join(" ") : "team member";

type Props = {
  churchId: string;
  team: TeamRecord;
  member: TeamMemberProfile | null;
  positions: TeamPosition[];
  roles: TeamRole[];
  qualificationAreas: TeamQualificationArea[];
  qualificationLevels: TeamQualificationLevel[];
  onClose: () => void;
  onSaved: (memberId: string) => void;
};

const TeamMemberProfileEditor = ({
  churchId,
  team,
  member,
  positions,
  roles,
  qualificationAreas,
  qualificationLevels,
  onClose,
  onSaved,
}: Props) => {
  const selectedMemberId = member?.memberId;
  const selectedMemberName = safeMemberName(member);
  const identity = `${churchId}:${team.teamId}:${selectedMemberId || ""}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const mountedRef = useRef(false);
  const { showToast } = useToast();
  const [profile, setProfile] = useState<TeamMemberTeamProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setSaving(false);
    if (!selectedMemberId) {
      setProfile(null);
      return;
    }
    let active = true;
    setProfile(null);
    setError("");
    setLoading(true);
    void getTeamRosterMemberProfile(churchId, team.teamId, selectedMemberId)
      .then((response) => {
        if (active) setProfile(response.teamProfile);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load this team profile.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [churchId, requestVersion, selectedMemberId, team.teamId]);

  const activeTeamPositions = useMemo(
    () => positions.filter((position) => position.teamId === team.teamId && !position.archivedAt),
    [positions, team.teamId],
  );
  const activeTeamRoles = useMemo(
    () => roles.filter((role) => role.teamId === team.teamId && !role.archivedAt),
    [roles, team.teamId],
  );
  const activeTeamAreas = useMemo(
    () => qualificationAreas.filter((area) => area.teamId === team.teamId && !area.archivedAt),
    [qualificationAreas, team.teamId],
  );
  const currentPositionIds = useMemo(
    () => [...new Set([...(profile?.positionIds || []), ...(profile?.desiredPositionIds || [])])],
    [profile?.desiredPositionIds, profile?.positionIds],
  );
  const positionOptions = useMemo(() => {
    const knownIds = new Set(activeTeamPositions.map((position) => position.positionId));
    return [
      ...activeTeamPositions,
      ...currentPositionIds.filter((id) => !knownIds.has(id)).map((positionId) => ({
        positionId,
        churchId,
        teamId: team.teamId,
        name: `Archived position (${positionId})`,
        archivedAt: "archived",
      })),
    ];
  }, [activeTeamPositions, churchId, currentPositionIds, team.teamId]);
  const currentAreaIds = useMemo(
    () => [...new Set((profile?.qualifications || []).map((item) => item.areaId))],
    [profile?.qualifications],
  );
  const areaOptions = useMemo(() => {
    const knownIds = new Set(activeTeamAreas.map((area) => area.areaId));
    return [
      ...activeTeamAreas,
      ...currentAreaIds.filter((id) => !knownIds.has(id)).map((areaId) => ({
        areaId,
        churchId,
        teamId: team.teamId,
        name: `Archived qualification area (${areaId})`,
        archivedAt: "archived",
      })),
    ];
  }, [activeTeamAreas, churchId, currentAreaIds, team.teamId]);

  const toggleId = (field: "positionIds" | "desiredPositionIds", id: string, checked: boolean) => {
    setProfile((current) => {
      if (!current) return current;
      const values = current[field];
      return {
        ...current,
        [field]: checked ? [...new Set([...values, id])] : values.filter((value) => value !== id),
      };
    });
  };

  const setQualification = (index: number, key: string, value: string) => {
    setProfile((current) => {
      if (!current) return current;
      const qualifications = current.qualifications.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        if (key === "areaId") return { ...row, areaId: value, levelId: undefined };
        if (key === "levelId") return { ...row, levelId: value || undefined };
        if (key === "status") return { ...row, status: value as typeof row.status };
        if (key === "completedAt") return { ...row, completedAt: value };
        if (key === "expiresAt") return { ...row, expiresAt: value };
        if (key === "notes") return { ...row, notes: value };
        return row;
      });
      return { ...current, qualifications };
    });
  };

  const save = async () => {
    if (!member || !profile || saving) return;
    const saveIdentity = identity;
    setSaving(true);
    setError("");
    try {
      const response = await updateTeamRosterMemberProfile(churchId, team.teamId, member.memberId, {
        positionIds: profile.positionIds,
        desiredPositionIds: profile.desiredPositionIds,
        membership: profile.membership,
        qualifications: profile.qualifications.map((qualification) => ({
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
        showToast({ message: `${selectedMemberName}'s ${team.name} profile was saved.`, variant: "success" });
      }
    } catch (saveError) {
      if (mountedRef.current && identityRef.current === saveIdentity) {
        showApiErrorToast(showToast, saveError, "Could not save this team profile.");
      }
    } finally {
      if (mountedRef.current && identityRef.current === saveIdentity) setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={Boolean(member)}
      onClose={() => { if (!saving) onClose(); }}
      title={`Manage ${selectedMemberName}`}
      description={`Only ${team.name} positions, role, lead state, and qualifications are shown here.`}
      size="lg"
      busy={loading || saving}
    >
      {loading ? <p role="status" className="text-sm text-gray-300">Loading {team.name} profile…</p> : null}
      {error ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm text-red-300">{error}</p>
          {!profile ? <Button type="button" variant="secondary" onClick={() => setRequestVersion((value) => value + 1)}>Try again</Button> : null}
        </div>
      ) : null}
      {profile ? (
        <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
          {(["positionIds", "desiredPositionIds"] as const).map((field) => (
            <section key={field} className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-100">
                {field === "positionIds" ? "Eligible positions" : "Desired positions"}
              </h3>
              {positionOptions.length ? positionOptions.map((position) => (
                <Checkbox
                  key={`${field}-${position.positionId}`}
                  label={position.name}
                  checked={profile[field].includes(position.positionId)}
                  disabled={saving}
                  onCheckedChange={(checked) => toggleId(field, position.positionId, checked)}
                />
              )) : <p className="text-sm text-gray-400">No positions are set up for this team.</p>}
            </section>
          ))}

          <section className="grid gap-4 sm:grid-cols-2">
            <Select
              label={`${team.name} role`}
              value={profile.membership.roleId || ""}
              onChange={(roleId) => setProfile((current) => current ? {
                ...current,
                membership: { ...current.membership, roleId: roleId || undefined },
              } : current)}
              disabled={saving}
              options={[
                { value: "", label: "No role" },
                ...activeTeamRoles.map((role) => ({ value: role.roleId, label: role.name })),
                ...(profile.membership.roleId && !activeTeamRoles.some((role) => role.roleId === profile.membership.roleId)
                  ? [{ value: profile.membership.roleId, label: `Archived role (${profile.membership.roleId})` }]
                  : []),
              ]}
            />
            <Checkbox
              label={`${selectedMemberName} is a ${team.name} team lead`}
              checked={profile.membership.isTeamLead}
              disabled={saving}
              onCheckedChange={(isTeamLead) => setProfile((current) => current ? {
                ...current,
                membership: { ...current.membership, isTeamLead },
              } : current)}
              className="self-end"
            />
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-100">{team.name} qualifications</h3>
              <Button
                type="button"
                variant="secondary"
                svg={Plus}
                iconSize="sm"
                disabled={saving || !activeTeamAreas.length}
                onClick={() => setProfile((current) => current ? {
                  ...current,
                  qualifications: [...current.qualifications, {
                    qualificationId: `new-${generateRandomId()}`,
                    areaId: activeTeamAreas[0].areaId,
                    teamId: team.teamId,
                    status: "in_training",
                  }],
                } : current)}
              >Add qualification</Button>
            </div>
            {profile.qualifications.map((qualification, index) => {
              const levels = qualificationLevels.filter((level) => level.areaId === qualification.areaId && !level.archivedAt);
              return (
                <div key={`${qualification.qualificationId}-${index}`} className="space-y-3 rounded-md border border-gray-700 p-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <Select
                    label="Area"
                    value={qualification.areaId}
                    disabled={saving}
                    onChange={(value) => setQualification(index, "areaId", value)}
                    options={areaOptions.map((area) => ({ value: area.areaId, label: area.name }))}
                  />
                  <Select
                    label="Level"
                    value={qualification.levelId || ""}
                    disabled={saving}
                    onChange={(value) => setQualification(index, "levelId", value)}
                    options={[
                      { value: "", label: "No level" },
                      ...levels.map((level) => ({ value: level.levelId, label: level.name })),
                      ...(qualification.levelId && !levels.some((level) => level.levelId === qualification.levelId)
                        ? [{ value: qualification.levelId, label: `Archived level (${qualification.levelId})` }]
                        : []),
                    ]}
                  />
                  <Select
                    label="Status"
                    value={qualification.status}
                    disabled={saving}
                    onChange={(value) => setQualification(index, "status", value)}
                    options={[
                      { value: "in_training", label: "In training" },
                      { value: "completed", label: "Completed" },
                      { value: "expired", label: "Expired" },
                    ]}
                  />
                  <Button
                    type="button"
                    variant="tertiary"
                    svg={Trash2}
                    aria-label={`Remove ${qualification.areaId} qualification`}
                    disabled={saving}
                    className="self-end"
                    onClick={() => setProfile((current) => current ? {
                      ...current,
                      qualifications: current.qualifications.filter((_, rowIndex) => rowIndex !== index),
                    } : current)}
                  />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DatePicker
                      label="Completed"
                      value={qualification.completedAt || ""}
                      disabled={saving}
                      onChange={(value) => setQualification(index, "completedAt", value)}
                    />
                    <DatePicker
                      label="Expires"
                      value={qualification.expiresAt || ""}
                      disabled={saving}
                      onChange={(value) => setQualification(index, "expiresAt", value)}
                    />
                  </div>
                  <TextArea
                    label="Notes"
                    value={qualification.notes || ""}
                    disabled={saving}
                    textareaClassName="min-h-16 max-h-28"
                    onChange={(value) => setQualification(index, "notes", value)}
                  />
                </div>
              );
            })}
            {!profile.qualifications.length ? <p className="text-sm text-gray-400">No {team.name} qualifications.</p> : null}
          </section>
          <div className="flex justify-end gap-2 border-t border-gray-700 pt-4">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Close</Button>
            <Button type="button" isLoading={saving} disabled={loading || saving} onClick={() => void save()}>Save {team.name} profile</Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
};

export default TeamMemberProfileEditor;
