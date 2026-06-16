import { useContext, useMemo, useState } from "react";
import { Check, ChevronDown, Clipboard, Plus, Undo2 } from "lucide-react";
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
import { DEFAULT_INTAKE_FORM_COPY } from "../intakeFormCopy";
import { emptyData } from "../teamsConstants";
import {
  buildTeamIntakePublicUrl,
  formatPlainDateRangeLabel,
  formatServiceTiming,
  formatShortOccurrenceDate,
  isActive,
  memberName,
} from "../teamsUtils";
import { cn } from "@/utils/cnHelper";
import {
  intakeSubmissionNeedsAction,
  selectIntakeMemberMatch,
  selectNewestIntakeSubmissions,
  submissionMatchesStatusFilter,
  type SubmissionStatusFilter,
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

const IntakeFormStatusBadge = ({ active }: { active: boolean }) => (
  <span
    className={cn(
      "shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium",
      active
        ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
        : "border-gray-600 bg-gray-900/60 text-gray-300",
    )}
  >
    {active ? "Open" : "Closed"}
  </span>
);

const IntakeFormDetails = ({
  startDate,
  endDate,
  submissionCount,
}: {
  startDate: string;
  endDate: string;
  submissionCount: number;
}) => {
  const dateRange = formatPlainDateRangeLabel(startDate, endDate);

  return (
    <div className="mt-1 space-y-0.5 text-sm leading-relaxed text-gray-300">
      <p>
        <span className="font-bold">Dates: </span>
        {dateRange}
      </p>
      <p>
        <span className="font-bold">Submissions: </span>
        {submissionCount}
      </p>
    </div>
  );
};

const ALL_FORMS_VALUE = "all";

const statusFilterOptions: { value: SubmissionStatusFilter; label: string }[] = [
  { value: "needs_action", label: "Needs action" },
  { value: "processed", label: "Processed" },
  { value: "all", label: "All" },
];

const emptyDraft = (): TeamIntakeFormPayload => ({
  name: "",
  startDate: "",
  endDate: "",
  availabilityServices: [],
  availabilityOccurrences: [],
  teamIds: [],
  active: true,
  welcomeMessage: "",
  positionsMessage: "",
  availabilityMessage: "",
  notesMessage: "",
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
  const [statusFilter, setStatusFilter] = useState<SubmissionStatusFilter>(
    "needs_action",
  );
  const [formFilter, setFormFilter] = useState<string>("all");

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

  // Forms that actually have submissions, so the form filter only lists
  // relevant options. Falls back to the form id when a form was deleted.
  const formFilterOptions = useMemo(() => {
    const formIdsWithSubmissions = new Set(
      newestSubmissions.map((submission) => submission.formId),
    );
    const named = forms
      .filter((form) => formIdsWithSubmissions.has(form.formId))
      .map((form) => ({
        value: form.formId,
        label: `${form.name}${form.archivedAt ? " (archived)" : ""}`,
      }));
    const namedIds = new Set(named.map((option) => option.value));
    const orphaned = [...formIdsWithSubmissions]
      .filter((formId) => !namedIds.has(formId))
      .map((formId) => ({ value: formId, label: "Deleted form" }));
    return [
      { value: ALL_FORMS_VALUE, label: "All forms" },
      ...named,
      ...orphaned,
    ];
  }, [forms, newestSubmissions]);

  const filteredSubmissions = useMemo(
    () =>
      newestSubmissions.filter(
        (submission) =>
          submissionMatchesStatusFilter(submission.status, statusFilter) &&
          (formFilter === ALL_FORMS_VALUE || submission.formId === formFilter),
      ),
    [newestSubmissions, statusFilter, formFilter],
  );

  // Always reflects the true backlog regardless of the current view.
  const needsActionCount = useMemo(
    () => newestSubmissions.filter(intakeSubmissionNeedsAction).length,
    [newestSubmissions],
  );

  // occurrenceId (`serviceId@startsAt`) -> the form's label/date for it, so the
  // review queue can show which services a submitter is (un)available for.
  const occurrenceLabelById = useMemo(() => {
    const map = new Map<string, { name: string; startsAt: string }>();
    forms.forEach((form) => {
      (form.availabilityOccurrences || []).forEach((occurrence) => {
        map.set(occurrence.occurrenceId, {
          name: occurrence.name,
          startsAt: occurrence.startsAt,
        });
      });
    });
    return map;
  }, [forms]);

  // Turn a set of occurrence ids into human labels sorted by date. Falls back to
  // the date encoded in the id when the form/occurrence is no longer available.
  const describeOccurrences = (occurrenceIds: string[]) =>
    occurrenceIds
      .map((id) => {
        const known = occurrenceLabelById.get(id);
        const startsAt = known?.startsAt || id.split("@")[1] || "";
        return { name: known?.name || "Service", startsAt };
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(({ name, startsAt }) =>
        startsAt ? `${name} · ${formatShortOccurrenceDate(startsAt)}` : name,
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
      welcomeMessage: form.welcomeMessage || "",
      positionsMessage: form.positionsMessage || "",
      availabilityMessage: form.availabilityMessage || "",
      notesMessage: form.notesMessage || "",
    });
    setShowCreate(true);
  };

  const updateSubmission = async (
    submission: TeamIntakeSubmission,
    action: "new" | "applied" | "dismissed",
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
      // Dismiss hides the row from the default "Needs action" view, so point the
      // admin to where it went and that it can be brought back.
      if (action === "dismissed") {
        showToast("Submission dismissed. Find it under Processed to restore.", "success");
      } else if (action === "new") {
        showToast("Submission restored to Needs action.", "success");
      }
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
                showChevron={false}
                headerBadge={<IntakeFormStatusBadge active={form.active} />}
                headerBadgePlacement="top-end"
                actionsPlacement="footer-end"
                details={
                  form.active ? (
                    <IntakeFormDetails
                      startDate={form.startDate}
                      endDate={form.endDate}
                      submissionCount={form.submissionCount || 0}
                    />
                  ) : undefined
                }
                note={
                  form.active
                    ? [
                      describeTeamScope(form.teamIds || []),
                      form.availabilityOccurrences?.length
                        ? `${form.availabilityOccurrences.length} availability dates`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                    : undefined
                }
                archived={Boolean(form.archivedAt)}
                actions={
                  form.active && canEdit ? (
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
        formFooter={
          <FormActionButtons
            pinFooter
            saveLabel="Save form"
            onSave={() => void submit()}
            onCancel={reset}
            disabled={!canEdit}
            isLoading={saving}
          />
        }
      >
        <Input label="Name" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name: String(name) }))} />
        {editing ? (
          <p className="px-1 text-sm text-gray-300">
            <span className="font-bold">Submissions: </span>
            {editing.submissionCount || 0}
          </p>
        ) : null}
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
        <EntityMultiSelect
          label="Teams to collect for"
          description="Leave empty to collect for every team. The public form only shows the selected teams' positions, grouped by team."
          options={teams.map((team) => ({
            id: team.teamId,
            label: team.name,
            archived: Boolean(team.archivedAt),
          }))}
          value={draft.teamIds}
          onChange={(teamIds) => setDraft((d) => ({ ...d, teamIds }))}
          emptyText="No teams yet."
        />
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
        <fieldset className="space-y-3">
          <legend className="p-1 text-sm font-semibold">Form wording</legend>
          <p className="px-1 text-xs text-gray-400">
            Customize what people read on the public form. Leave a field blank to
            use the default wording shown in each box.
          </p>
          <TextArea
            label="Welcome message"
            value={draft.welcomeMessage || ""}
            placeholder={DEFAULT_INTAKE_FORM_COPY.welcome}
            textareaClassName="min-h-16"
            onChange={(welcomeMessage) =>
              setDraft((d) => ({ ...d, welcomeMessage }))
            }
          />
          <Input
            label="Positions message"
            value={draft.positionsMessage || ""}
            placeholder={DEFAULT_INTAKE_FORM_COPY.positions}
            onChange={(positionsMessage) =>
              setDraft((d) => ({ ...d, positionsMessage: String(positionsMessage) }))
            }
          />
          <Input
            label="Availability message"
            value={draft.availabilityMessage || ""}
            placeholder={DEFAULT_INTAKE_FORM_COPY.availability}
            onChange={(availabilityMessage) =>
              setDraft((d) => ({
                ...d,
                availabilityMessage: String(availabilityMessage),
              }))
            }
          />
          <Input
            label="Notes message"
            value={draft.notesMessage || ""}
            placeholder={DEFAULT_INTAKE_FORM_COPY.notes}
            onChange={(notesMessage) =>
              setDraft((d) => ({ ...d, notesMessage: String(notesMessage) }))
            }
          />
        </fieldset>
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
      </CreatePanel>

      <section className={panelClassName}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-lg font-semibold">
            Review queue
            {needsActionCount > 0 ? (
              <span className="ml-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-200">
                {needsActionCount} need{needsActionCount === 1 ? "s" : ""} action
              </span>
            ) : null}
          </h2>
          {newestSubmissions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Select
                label="Status"
                hideLabel
                className="min-w-40"
                value={statusFilter}
                onChange={(value) =>
                  setStatusFilter(value as SubmissionStatusFilter)
                }
                options={statusFilterOptions}
              />
              <Select
                label="Form"
                hideLabel
                className="min-w-44"
                value={formFilter}
                onChange={(value) => setFormFilter(String(value))}
                options={formFilterOptions}
              />
            </div>
          ) : null}
        </div>
        <div className="mt-3 space-y-3">
          {newestSubmissions.length === 0 ? (
            <p className="text-sm text-gray-300">No submissions yet.</p>
          ) : filteredSubmissions.length === 0 ? (
            <p className="text-sm text-gray-300">
              No submissions match these filters.
            </p>
          ) : null}
          {filteredSubmissions.map((submission) => {
            const suggestedMember = selectIntakeMemberMatch(submission, members);
            const selectedMemberId =
              selectedMemberBySubmission[submission.submissionId] ??
              suggestedMember?.memberId ??
              "";
            const canLinkSubmission = submission.status !== "applied";
            const needsAction = submission.status === "new";
            const linkedMember = submission.appliedMemberId
              ? members.find((member) => member.memberId === submission.appliedMemberId)
              : undefined;
            const availabilityEntries = Object.entries(
              submission.occurrenceAvailability || {},
            );
            const availableDates = describeOccurrences(
              availabilityEntries
                .filter(([, status]) => status === "available")
                .map(([occurrenceId]) => occurrenceId),
            );
            const unavailableDates = describeOccurrences(
              availabilityEntries
                .filter(([, status]) => status === "unavailable")
                .map(([occurrenceId]) => occurrenceId),
            );
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
                      <Button
                        variant="textLink"
                        padding="px-1 py-0.5"
                        onClick={() => void updateSubmission(submission, "dismissed")}
                      >
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                  {canEdit && submission.status === "dismissed" ? (
                    <Button
                      variant="secondary"
                      svg={Undo2}
                      iconSize="sm"
                      padding="px-2 py-1"
                      onClick={() => void updateSubmission(submission, "new")}
                    >
                      Restore
                    </Button>
                  ) : null}
                </div>
                {availableDates.length > 0 || unavailableDates.length > 0 ? (
                  <details className="group mt-3 text-xs">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-gray-300 [&::-webkit-details-marker]:hidden">
                      <ChevronDown
                        className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-open:rotate-0 -rotate-90"
                        aria-hidden
                      />
                      <span>Service availability</span>
                      <span className="font-normal text-gray-500">
                        (
                        {[
                          availableDates.length > 0
                            ? `${availableDates.length} available`
                            : null,
                          unavailableDates.length > 0
                            ? `${unavailableDates.length} unavailable`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                        )
                      </span>
                    </summary>
                    <div className="mt-2 space-y-1 pl-5">
                      {availableDates.length > 0 ? (
                        <p className="text-emerald-200">
                          Available: {availableDates.join(", ")}
                        </p>
                      ) : null}
                      {unavailableDates.length > 0 ? (
                        <p className="text-gray-400">
                          Unavailable: {unavailableDates.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  </details>
                ) : null}
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
