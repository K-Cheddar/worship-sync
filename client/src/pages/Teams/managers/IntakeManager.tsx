import { useContext, useMemo, useState } from "react";
import { Check, Clipboard, Plus } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import TextArea from "../../../components/TextArea/TextArea";
import DatePicker from "@/components/ui/DatePicker";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  applyTeamIntakeSubmission,
  createTeamIntakeForm,
  getTeamIntakeFormLink,
  updateTeamIntakeForm,
  type TeamIntakeFormPayload,
} from "../../../api/auth";
import type {
  TeamIntakeForm,
  TeamIntakeSubmission,
  TeamRecord,
  TeamRosterMember,
  TeamService,
} from "../../../api/authTypes";
import { generateScheduleOccurrences, filterServicesWithOccurrencesInRange } from "../../../utils/teamScheduleOccurrences";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import CreatePanel from "../CreatePanel";
import EntityMultiSelect from "../EntityMultiSelect";
import FormActionButtons from "../components/FormActionButtons";
import EntityRow from "../components/EntityRow";
import Checkbox from "../../../components/Checkbox/Checkbox";
import { panelClassName } from "../teamsStyles";
import { emptyData } from "../teamsConstants";
import { buildTeamIntakePublicUrl, formatServiceTiming, isActive, memberName } from "../teamsUtils";
import {
  selectIntakeMemberMatch,
  selectNewestIntakeSubmissions,
} from "../teamsSelectors";

type IntakeManagerProps = {
  forms: TeamIntakeForm[];
  submissions: TeamIntakeSubmission[];
  services: TeamService[];
  members: TeamRosterMember[];
  teams: TeamRecord[];
  canEdit: boolean;
  onFormSaved: (form: TeamIntakeForm) => void;
  onSubmissionSaved: (submission: TeamIntakeSubmission) => void;
  onMemberSaved: (member: TeamRosterMember) => void;
};

const emptyDraft = (): TeamIntakeFormPayload => ({
  name: "",
  startDate: "",
  endDate: "",
  availabilityServices: [],
  availabilityOccurrences: [],
  teamIds: [],
  active: true,
});

const IntakeManager = ({
  forms,
  submissions,
  services,
  members,
  teams,
  canEdit,
  onFormSaved,
  onSubmissionSaved,
  onMemberSaved,
}: IntakeManagerProps) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const [draft, setDraft] = useState<TeamIntakeFormPayload>(emptyDraft);
  const [editing, setEditing] = useState<TeamIntakeForm | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastCreatedPublicUrl, setLastCreatedPublicUrl] = useState("");
  const [selectedMemberBySubmission, setSelectedMemberBySubmission] = useState<Record<string, string>>({});

  const reset = () => {
    setEditing(null);
    setShowCreate(false);
    setDraft(emptyDraft());
  };

  const teamNameById = useMemo(
    () => new Map(teams.map((team) => [team.teamId, team.name])),
    [teams],
  );
  const describeTeamScope = (ids: string[]) =>
    ids.length === 0
      ? "All teams"
      : ids.map((id) => teamNameById.get(id) || "Unknown team").join(", ");

  const applicableServices = useMemo(
    () =>
      draft.startDate && draft.endDate
        ? filterServicesWithOccurrencesInRange({
          services: services.filter(isActive),
          startDate: draft.startDate,
          endDate: draft.endDate,
        })
        : [],
    [draft.endDate, draft.startDate, services],
  );

  const pruneAvailabilityServices = (
    availabilityServices: TeamIntakeFormPayload["availabilityServices"],
    startDate: string,
    endDate: string,
  ) => {
    const applicableIds = new Set(
      filterServicesWithOccurrencesInRange({
        services,
        startDate,
        endDate,
      }).map((service) => service.serviceId),
    );
    return availabilityServices.filter((item) =>
      applicableIds.has(item.serviceId),
    );
  };

  const updateDraftDates = (patch: { startDate?: string; endDate?: string }) =>
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (next.startDate && next.endDate) {
        next.availabilityServices = pruneAvailabilityServices(
          next.availabilityServices,
          next.startDate,
          next.endDate,
        );
      }
      return next;
    });

  const buildPayload = (): TeamIntakeFormPayload => {
    const serviceIds = draft.availabilityServices.map((service) => service.serviceId);
    const availabilityOccurrences =
      draft.startDate && draft.endDate
        ? generateScheduleOccurrences({
          services,
          serviceIds,
          startDate: draft.startDate,
          endDate: draft.endDate,
        }).map((occurrence) => ({
          occurrenceId: occurrence.occurrenceId,
          serviceId: occurrence.serviceId,
          name: occurrence.name,
          startsAt: occurrence.startsAt,
        }))
        : [];
    return {
      ...draft,
      availabilityOccurrences,
    };
  };

  const submit = async () => {
    if (!canEdit) return;
    if (!draft.name.trim() || !draft.startDate || !draft.endDate) {
      showToast("Name and date range are required.", "neutral");
      return;
    }
    const payload = buildPayload();
    setSaving(true);
    try {
      if (editing) {
        const response = await updateTeamIntakeForm(churchId, editing.formId, payload);
        onFormSaved(response.form);
      } else {
        const response = await createTeamIntakeForm(churchId, payload);
        onFormSaved(response.form);
        if (response.publicToken) {
          setLastCreatedPublicUrl(
            response.publicUrl || buildTeamIntakePublicUrl(response.publicToken),
          );
        }
      }
      reset();
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this intake form.");
    } finally {
      setSaving(false);
    }
  };

  const newestSubmissions = useMemo(
    () =>
      selectNewestIntakeSubmissions({
        ...emptyData,
        intakeSubmissions: submissions || [],
      }),
    [submissions],
  );

  const copyPublicUrl = async (url: string) => {
    await navigator.clipboard?.writeText(url);
    showToast("Intake link copied.", "success");
  };

  const copyFormLink = async (form: TeamIntakeForm) => {
    if (!canEdit) return;
    if (form.publicUrl) {
      await copyPublicUrl(form.publicUrl);
      return;
    }
    try {
      const response = await getTeamIntakeFormLink(churchId, form.formId);
      onFormSaved(response.form);
      await copyPublicUrl(
        response.publicUrl || buildTeamIntakePublicUrl(response.publicToken),
      );
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not create a new intake link.");
    }
  };

  const openIntakeFormEditor = (form: TeamIntakeForm) => {
    setEditing(form);
    setDraft({
      name: form.name,
      startDate: form.startDate,
      endDate: form.endDate,
      availabilityServices: form.availabilityServices || [],
      availabilityOccurrences: form.availabilityOccurrences || [],
      teamIds: form.teamIds || [],
      active: form.active,
    });
    setShowCreate(true);
  };

  const updateSubmission = async (
    submission: TeamIntakeSubmission,
    action: "reviewed" | "applied" | "dismissed",
    memberId?: string,
    createMember = false,
  ) => {
    if (!canEdit) return;
    try {
      const response = await applyTeamIntakeSubmission(churchId, submission.submissionId, {
        action,
        memberId,
        createMember,
      });
      onSubmissionSaved(response.submission);
      if (response.member) onMemberSaved(response.member);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not update this submission.");
    }
  };

  return (
    <div className="space-y-4">
      <CreatePanel
        open={showCreate}
        onOpenCreate={() => {
          reset();
          setShowCreate(true);
        }}
        canEdit={canEdit}
        title={editing ? "Edit intake form" : "Create intake form"}
        sectionTitle="Intake forms"
        description="Share intake forms and review submissions."
        createLabel="Create intake form"
        list={
          <>
            {lastCreatedPublicUrl && canEdit ? (
              <div className="mb-3 rounded-md border border-emerald-400/40 bg-emerald-950/30 p-3 text-sm text-emerald-100">
                <p className="font-semibold">New public link ready.</p>
                <Button
                  className="mt-2"
                  variant="secondary"
                  svg={Clipboard}
                  iconSize="sm"
                  onClick={() => void copyPublicUrl(lastCreatedPublicUrl)}
                >
                  Copy public link
                </Button>
              </div>
            ) : null}
            {forms.length === 0 ? <p className="text-sm text-gray-300">No intake forms yet.</p> : null}
            {forms.map((form) => (
              <EntityRow
                key={form.formId}
                title={form.name}
                subtitle={`${form.startDate} to ${form.endDate} | ${form.active ? "Open" : "Closed"} | ${form.submissionCount || 0} submissions`}
                note={[
                  describeTeamScope(form.teamIds || []),
                  form.availabilityOccurrences?.length
                    ? `${form.availabilityOccurrences.length} availability dates`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                archived={Boolean(form.archivedAt)}
                actions={
                  canEdit ? (
                    <Button
                      variant="tertiary"
                      svg={Clipboard}
                      iconSize="sm"
                      padding="px-2 py-1"
                      onClick={(event) => {
                        event.stopPropagation();
                        void copyFormLink(form);
                      }}
                    >
                      Copy link
                    </Button>
                  ) : null
                }
                canEdit={canEdit}
                onTitleClick={() => openIntakeFormEditor(form)}
              />
            ))}
          </>
        }
      >
        <Input label="Name" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name: String(name) }))} />
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            label="Start date"
            value={draft.startDate}
            onChange={(startDate) => updateDraftDates({ startDate: String(startDate) })}
          />
          <DatePicker
            label="End date"
            value={draft.endDate}
            onChange={(endDate) => updateDraftDates({ endDate: String(endDate) })}
          />
        </div>
        <Checkbox
          label="Open for submissions"
          checked={draft.active}
          onCheckedChange={(active) => setDraft((d) => ({ ...d, active }))}
          labelClassName="text-sm"
        />
        <div className="space-y-1">
          <EntityMultiSelect
            label="Teams to collect for"
            options={teams.map((team) => ({
              id: team.teamId,
              label: team.name,
              archived: Boolean(team.archivedAt),
            }))}
            value={draft.teamIds}
            onChange={(teamIds) => setDraft((d) => ({ ...d, teamIds }))}
            emptyText="No teams yet."
          />
          <p className="px-1 text-xs text-gray-400">
            Leave empty to collect for every team. The public form only shows the
            selected teams&apos; positions, grouped by team.
          </p>
        </div>
        <EntityMultiSelect
          label="Show services for availability"
          description="Select services that fall within this form's date range. People will mark availability for each date on the public form."
          options={applicableServices.map((service) => ({
            id: service.serviceId,
            label: service.name,
            sublabel: formatServiceTiming(service),
          }))}
          value={draft.availabilityServices.map((item) => item.serviceId)}
          onChange={(serviceIds) =>
            setDraft((current) => ({
              ...current,
              availabilityServices: serviceIds.map((serviceId) => {
                const service = services.find((item) => item.serviceId === serviceId);
                return {
                  serviceId,
                  name: service?.name || "",
                };
              }),
            }))
          }
          emptyText={
            draft.startDate && draft.endDate
              ? "No services fall in this date range."
              : "Set the form start and end dates first."
          }
        />
        {editing && canEdit ? (
          <Button
            variant="secondary"
            svg={Clipboard}
            iconSize="sm"
            onClick={() => void copyFormLink(editing)}
          >
            Copy public link
          </Button>
        ) : null}
        <FormActionButtons
          pinFooter
          saveLabel="Save form"
          onSave={() => void submit()}
          onCancel={reset}
          disabled={!canEdit}
          isLoading={saving}
        />
      </CreatePanel>

      <section className={panelClassName}>
        <h2 className="text-lg font-semibold">Review queue</h2>
        <div className="mt-3 space-y-3">
          {newestSubmissions.length === 0 ? (
            <p className="text-sm text-gray-300">No submissions yet.</p>
          ) : null}
          {newestSubmissions.map((submission) => {
            const suggestedMember = selectIntakeMemberMatch(submission, members);
            const selectedMemberId =
              selectedMemberBySubmission[submission.submissionId] ??
              suggestedMember?.memberId ??
              "";
            const canLinkSubmission = submission.status !== "applied";
            const needsAction =
              submission.status === "new" || submission.status === "reviewed";
            const linkedMember = submission.appliedMemberId
              ? members.find((member) => member.memberId === submission.appliedMemberId)
              : undefined;
            return (
              <article
                key={submission.submissionId}
                className="rounded-md border border-gray-700 bg-gray-950/60 p-3"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <h3 className="font-semibold">
                      {submission.firstName} {submission.lastName}
                    </h3>
                    <p className="text-xs text-gray-400">
                      {submission.status === "applied" && linkedMember
                        ? `Linked to ${memberName(linkedMember)}`
                        : submission.status}{" "}
                      | {new Date(submission.submittedAt).toLocaleString()}
                    </p>
                    {suggestedMember && canLinkSubmission ? (
                      <p className="mt-1 text-xs text-emerald-200">
                        Suggested match: {memberName(suggestedMember)}
                      </p>
                    ) : null}
                  </div>
                  {canEdit && needsAction ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {canLinkSubmission ? (
                        <>
                          <Select
                            label="Match member"
                            hideLabel
                            className="min-w-48"
                            value={selectedMemberId}
                            onChange={(memberId) =>
                              setSelectedMemberBySubmission((current) => ({
                                ...current,
                                [submission.submissionId]: String(memberId),
                              }))
                            }
                            options={members.map((member) => ({
                              label: memberName(member),
                              value: member.memberId,
                            }))}
                          />
                          <Button
                            variant="secondary"
                            svg={Check}
                            iconSize="sm"
                            padding="px-2 py-1"
                            disabled={!selectedMemberId}
                            onClick={() =>
                              void updateSubmission(submission, "applied", selectedMemberId)
                            }
                          >
                            Link to member
                          </Button>
                          <Button
                            variant="tertiary"
                            svg={Plus}
                            iconSize="sm"
                            padding="px-2 py-1"
                            onClick={() =>
                              void updateSubmission(submission, "applied", undefined, true)
                            }
                          >
                            Create member
                          </Button>
                        </>
                      ) : null}
                      {submission.status === "new" ? (
                        <Button
                          variant="textLink"
                          padding="px-1 py-0.5"
                          onClick={() => void updateSubmission(submission, "reviewed")}
                        >
                          Mark reviewed
                        </Button>
                      ) : null}
                      <Button
                        variant="textLink"
                        padding="px-1 py-0.5"
                        onClick={() => void updateSubmission(submission, "dismissed")}
                      >
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
                {submission.notes ? (
                  <TextArea
                    label="Notes"
                    value={submission.notes}
                    disabled
                    onChange={() => { }}
                    textareaClassName="mt-3 min-h-16"
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default IntakeManager;
