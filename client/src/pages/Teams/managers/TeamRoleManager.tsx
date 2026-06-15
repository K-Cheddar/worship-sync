import { useContext, useMemo, useState } from "react";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import TextArea from "../../../components/TextArea/TextArea";
import DeleteModal from "../../../components/Modal/DeleteModal";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  archiveTeamRole,
  createTeamRole,
  deleteTeamRole,
  updateTeamRole,
  type TeamRolePayload,
} from "../../../api/auth";
import type { TeamRecord, TeamRole } from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import CreatePanel from "../CreatePanel";
import EntityListSearch from "../components/EntityListSearch";
import EntityRow from "../components/EntityRow";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { isActive, roleMatchesListQuery } from "../teamsUtils";

type TeamRoleManagerProps = {
  roles: TeamRole[];
  teams: TeamRecord[];
  canEdit: boolean;
  onSaved: (role: TeamRole, replaceId?: string) => void;
  onArchived: () => void;
  onRemoved: (roleId: string) => void;
};

const TeamRoleManager = ({
  roles,
  teams,
  canEdit,
  onSaved,
  onArchived,
  onRemoved,
}: TeamRoleManagerProps) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const activeTeams = useMemo(() => teams.filter(isActive), [teams]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [editing, setEditing] = useState<TeamRole | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<TeamRole | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [draft, setDraft] = useState<TeamRolePayload>({
    teamId: "",
    name: "",
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [listQuery, setListQuery] = useState("");

  const teamId = selectedTeamId || activeTeams[0]?.teamId || "";
  const teamRoles = roles.filter((role) => role.teamId === teamId);
  const filteredTeamRoles = useMemo(
    () => teamRoles.filter((role) => roleMatchesListQuery(role, listQuery)),
    [teamRoles, listQuery],
  );

  const reset = () => {
    setEditing(null);
    setShowCreate(false);
    setDraft({ teamId: teamId, name: "", description: "" });
  };

  const openRoleEditor = (role: TeamRole) => {
    setEditing(role);
    setSelectedTeamId(role.teamId);
    setShowCreate(true);
    setDraft({
      teamId: role.teamId,
      name: role.name,
      description: role.description || "",
    });
  };

  const confirmDelete = async () => {
    if (!canEdit || !deleting) return;
    const role = deleting;
    if (role.roleId.startsWith("local-")) {
      onRemoved(role.roleId);
      setDeleting(null);
      return;
    }
    setDeleteBusy(true);
    onRemoved(role.roleId);
    try {
      await deleteTeamRole(churchId, role.roleId);
      setDeleting(null);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not delete this role.");
      onSaved(role);
    } finally {
      setDeleteBusy(false);
    }
  };

  const submit = async () => {
    if (!canEdit) return;
    const roleTeamId = editing?.teamId || teamId;
    if (!roleTeamId) {
      showToast("Create a team first, then add its roles.", "neutral");
      return;
    }
    setSaving(true);
    const localRoleId = editing?.roleId || `local-role-${generateRandomId()}`;
    const payload: TeamRolePayload = {
      teamId: roleTeamId,
      name: draft.name.trim(),
      description: draft.description || "",
    };
    const optimisticRole: TeamRole = {
      churchId,
      roleId: localRoleId,
      teamId: roleTeamId,
      name: payload.name,
      description: payload.description,
      archivedAt: editing?.archivedAt || null,
    };
    onSaved(editing ? { ...editing, ...optimisticRole } : optimisticRole);
    try {
      const response = editing
        ? await updateTeamRole(churchId, editing.roleId, payload)
        : await createTeamRole(churchId, payload);
      if (!editing) {
        onSaved(response.role, localRoleId);
      }
      reset();
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this role.");
      onArchived();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <CreatePanel
        open={showCreate}
        onOpenCreate={() => {
          reset();
          setShowCreate(true);
        }}
        canEdit={canEdit}
        title={editing ? "Edit role" : "Create role"}
        sectionTitle="Team roles"
        description="Define team roles for members."
        createLabel="Create role"
        scrollableList
        listToolbar={
          activeTeams.length === 0 ? null : (
            <div className="space-y-3">
              <Select
                label="Team"
                value={teamId}
                onChange={(value) => {
                  setSelectedTeamId(value);
                  if (editing) reset();
                }}
                options={activeTeams.map((team) => ({
                  label: team.name,
                  value: team.teamId,
                }))}
              />
              {teamRoles.length > 0 ? (
                <EntityListSearch
                  label="Roles"
                  value={listQuery}
                  onChange={setListQuery}
                />
              ) : null}
            </div>
          )
        }
        list={
          <>
            {activeTeams.length === 0 ? (
              <p className="text-sm text-gray-300">
                Create a team first — roles belong to a team.
              </p>
            ) : (
              <>
                {teamRoles.length === 0 ? (
                  <p className="text-sm text-gray-300">No roles in this team yet.</p>
                ) : null}
                {teamRoles.length > 0 && filteredTeamRoles.length === 0 ? (
                  <p className="text-sm text-gray-300">No matches.</p>
                ) : null}
                {filteredTeamRoles.map((role) => (
                  <EntityRow
                    key={role.roleId}
                    title={role.name}
                    subtitle={role.description || undefined}
                    archived={Boolean(role.archivedAt)}
                    compact
                    canEdit={canEdit}
                    onTitleClick={() => openRoleEditor(role)}
                  />
                ))}
              </>
            )}
          </>
        }
        formHeaderActions={
          editing ? (
            <EntityFormDangerActions
              archived={Boolean(editing.archivedAt)}
              canEdit={canEdit}
              archiveLabel="Archive role"
              deleteLabel="Delete role"
              menuLabel="Role actions"
              onArchive={
                editing.archivedAt
                  ? undefined
                  : async () => {
                    const archivedRole = {
                      ...editing,
                      archivedAt: new Date().toISOString(),
                    };
                    onSaved(archivedRole);
                    try {
                      await archiveTeamRole(churchId, editing.roleId);
                      reset();
                    } catch (error) {
                      showApiErrorToast(showToast, error, "Could not archive this role.");
                      onSaved(editing);
                    }
                  }
              }
              onDelete={() => setDeleting(editing)}
            />
          ) : null
        }
        formFooter={
          <FormActionButtons
            pinFooter
            saveLabel="Save role"
            onSave={() => void submit()}
            onCancel={reset}
            disabled={!canEdit || !draft.name.trim()}
            isLoading={saving}
          />
        }
      >
        <p className="text-xs text-gray-400">
          Adding to{" "}
          <span className="font-semibold text-gray-200">
            {activeTeams.find((team) => team.teamId === (editing?.teamId || teamId))?.name ||
              "a team"}
          </span>
          .
        </p>
        <Input
          label="Name"
          value={draft.name}
          onChange={(name) => setDraft((current) => ({ ...current, name: String(name) }))}
        />
        <TextArea
          label="Description"
          value={draft.description || ""}
          textareaClassName="min-h-20"
          onChange={(description) =>
            setDraft((current) => ({ ...current, description }))
          }
        />
      </CreatePanel>
      <DeleteModal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        itemName={deleting?.name}
        isConfirming={deleteBusy}
        message="Permanently delete the role"
        warningMessage="This cannot be undone. Archive instead if you only want to hide it."
      />
    </>
  );
};

export default TeamRoleManager;
