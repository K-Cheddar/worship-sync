import { type ReactNode, useContext, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Clipboard, Pencil, Plus, Undo2 } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import TextArea from "../../../components/TextArea/TextArea";
import DateRangePicker from "@/components/ui/DateRangePicker";
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
  TeamPosition,
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
import { DEFAULT_INTAKE_FORM_COPY } from "../intakeFormCopy";
import { emptyData } from "../teamsConstants";
import {
  buildTeamIntakePublicUrl,
  buildIntakeAvailabilityServiceOptions,
  formatPlainDateRangeLabel,
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
  positions: TeamPosition[];
  teams: TeamRecord[];
  canEdit: boolean;
  onFormSaved: (form: TeamIntakeForm) => void;
  onSubmissionSaved: (submission: TeamIntakeSubmission) => void;
  onMemberSaved: (member: TeamRosterMember) => void;
  onTeamSaved: (team: TeamRecord) => void;
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

const ReviewQueueCollapsibleSection = ({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) => (
  <details className="group mt-3 text-xs">
    <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-gray-300 [&::-webkit-details-marker]:hidden">
      <ChevronDown
        className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-open:rotate-0 -rotate-90"
        aria-hidden
      />
      <span>{title}</span>
      <span className="font-normal text-gray-500">({summary})</span>
    </summary>
    <div className="mt-2 pl-5">{children}</div>
  </details>
);

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
  positions,
  teams,
  canEdit,
  onFormSaved,
  onSubmissionSaved,
  onMemberSaved,
  onTeamSaved,
}: IntakeManagerProps) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const [draft, setDraft] = useState<TeamIntakeFormPayload>(emptyDraft);
  const [editing, setEditing] = useState<TeamIntakeForm | null>(null);
  const [selectedForm, setSelectedForm] = useState<TeamIntakeForm | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastCreatedPublicUrl, setLastCreatedPublicUrl] = useState("");
  const [selectedMemberBySubmission, setSelectedMemberBySubmission] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<SubmissionStatusFilter>(
    "needs_action",
  );

  const panelOpen = selectedForm !== null || showCreate;
  const showingEditForm = showCreate || showEditForm;

  const closePanel = () => {
    setSelectedForm(null);
    setShowCreate(false);
    setShowEditForm(false);
    setEditing(null);
    setDraft(emptyDraft());
  };

  const openCreate = () => {
    setSelectedForm(null);
    setShowCreate(true);
    setShowEditForm(false);
    setEditing(null);
    setDraft(emptyDraft());
  };

  const openFormSubmissions = (form: TeamIntakeForm) => {
    setSelectedForm(form);
    setShowCreate(false);
    setShowEditForm(false);
    setEditing(null);
    setDraft(emptyDraft());
  };

  const openFormEditor = (form: TeamIntakeForm) => {
    setSelectedForm(form);
    setShowCreate(false);
    setShowEditForm(true);
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
  };

  const cancelFormEdit = () => {
    if (showCreate) {
      closePanel();
      return;
    }
    setShowEditForm(false);
    setEditing(null);
    setDraft(emptyDraft());
  };

  const handlePanelBack = () => {
    if (showEditForm) {
      cancelFormEdit();
      return;
    }
    closePanel();
  };

  const teamNameById = useMemo(
    () => new Map(teams.map((team) => [team.teamId, team.name])),
    [teams],
  );

  const positionNameById = useMemo(
    () =>
      new Map(
        positions.map((position) => [position.positionId, position.name]),
      ),
    [positions],
  );

  // Archived members must not be offered as link targets in the match dropdown
  // (or auto-suggested), though they stay searchable for already-linked rows.
  const activeMembers = useMemo(() => members.filter(isActive), [members]);
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

  const availabilityServiceOptions = useMemo(
    () => buildIntakeAvailabilityServiceOptions(applicableServices),
    [applicableServices],
  );

  const selectedAvailabilityServiceOptionIds = useMemo(() => {
    const selectedServiceIds = new Set(
      draft.availabilityServices.map((item) => item.serviceId),
    );
    return availabilityServiceOptions
      .filter((option) =>
        option.serviceIds.every((serviceId) => selectedServiceIds.has(serviceId)),
      )
      .map((option) => option.id);
  }, [availabilityServiceOptions, draft.availabilityServices]);

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
        setSelectedForm(response.form);
        setShowEditForm(false);
        setEditing(null);
        setDraft(emptyDraft());
      } else {
        const response = await createTeamIntakeForm(churchId, payload);
        onFormSaved(response.form);
        if (response.publicToken) {
          setLastCreatedPublicUrl(
            response.publicUrl || buildTeamIntakePublicUrl(response.publicToken),
          );
        }
        closePanel();
      }
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

  const activeSelectedForm = useMemo(() => {
    if (!selectedForm) return null;
    return forms.find((form) => form.formId === selectedForm.formId) ?? selectedForm;
  }, [forms, selectedForm]);

  const selectedFormSubmissions = useMemo(
    () =>
      activeSelectedForm
        ? newestSubmissions.filter(
          (submission) => submission.formId === activeSelectedForm.formId,
        )
        : [],
    [newestSubmissions, activeSelectedForm],
  );

  const filteredSubmissions = useMemo(
    () =>
      selectedFormSubmissions.filter((submission) =>
        submissionMatchesStatusFilter(submission.status, statusFilter),
      ),
    [selectedFormSubmissions, statusFilter],
  );

  const selectedFormNeedsActionCount = useMemo(
    () => selectedFormSubmissions.filter(intakeSubmissionNeedsAction).length,
    [selectedFormSubmissions],
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
      // Reflect roster changes locally so a created/linked member appears on
      // their team's schedule right away (no full reload needed).
      response.teams?.forEach((team) => onTeamSaved(team));
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

  const panelTitle = showCreate
    ? "Create intake form"
    : showingEditForm
      ? "Edit intake form"
      : activeSelectedForm?.name || "Intake form";

  const renderSubmissionCard = (submission: TeamIntakeSubmission) => {
    const suggestedMember = selectIntakeMemberMatch(submission, activeMembers);
    const selectedMemberId =
      selectedMemberBySubmission[submission.submissionId] ??
      suggestedMember?.memberId ??
      "";
    const canLinkSubmission = submission.status !== "applied";
    const needsAction = submission.status === "new";
    const linkedMember = submission.appliedMemberId
      ? members.find((member) => member.memberId === submission.appliedMemberId)
      : undefined;
    const requestedPositions = (submission.positionIds || [])
      .map((positionId) => positionNameById.get(positionId))
      .filter((name): name is string => Boolean(name));
    const blockoutLabels = (submission.blockoutRanges || [])
      .map((range) => formatPlainDateRangeLabel(range.startDate, range.endDate))
      .filter(Boolean);
    const availabilityEntries = Object.entries(submission.occurrenceAvailability || {});
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
                ? `${submission.appliedMemberCreated ? "Created" : "Linked to"} ${memberName(linkedMember)}`
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
                    options={activeMembers.map((member) => ({
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
        {requestedPositions.length > 0 ? (
          <ReviewQueueCollapsibleSection
            title="Requested positions"
            summary={`${requestedPositions.length} position${requestedPositions.length === 1 ? "" : "s"}`}
          >
            <p className="text-gray-300">{requestedPositions.join(", ")}</p>
          </ReviewQueueCollapsibleSection>
        ) : null}
        {blockoutLabels.length > 0 ? (
          <ReviewQueueCollapsibleSection
            title="Blockout dates"
            summary={`${blockoutLabels.length} range${blockoutLabels.length === 1 ? "" : "s"}`}
          >
            <p className="text-gray-300">{blockoutLabels.join("; ")}</p>
          </ReviewQueueCollapsibleSection>
        ) : null}
        {availableDates.length > 0 || unavailableDates.length > 0 ? (
          <ReviewQueueCollapsibleSection
            title="Service availability"
            summary={[
              availableDates.length > 0 ? `${availableDates.length} available` : null,
              unavailableDates.length > 0 ? `${unavailableDates.length} unavailable` : null,
            ]
              .filter(Boolean)
              .join(", ")}
          >
            <div className="space-y-1">
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
          </ReviewQueueCollapsibleSection>
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
  };

  const renderEditForm = () => (
    <>
      <Input label="Name" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name: String(name) }))} />
      {editing ? (
        <p className="px-1 text-sm text-gray-300">
          <span className="font-bold">Submissions: </span>
          {editing.submissionCount || 0}
        </p>
      ) : null}
      <DateRangePicker
        label="Date range"
        value={{ startDate: draft.startDate, endDate: draft.endDate }}
        onChange={({ startDate, endDate }) =>
          updateDraftDates({ startDate, endDate })
        }
      />
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
        description="Select services that fall within this form's date range. Combined services appear together, and people will mark one availability date for the group."
        options={availabilityServiceOptions.map((option) => ({
          id: option.id,
          label: option.label,
          sublabel: option.sublabel,
        }))}
        value={selectedAvailabilityServiceOptionIds}
        onChange={(optionIds) => {
          const serviceIds = availabilityServiceOptions
            .filter((option) => optionIds.includes(option.id))
            .flatMap((option) => option.serviceIds);
          setDraft((current) => ({
            ...current,
            availabilityServices: serviceIds.map((serviceId) => {
              const service = services.find((item) => item.serviceId === serviceId);
              return {
                serviceId,
                name: service?.name || "",
              };
            }),
          }));
        }}
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
    </>
  );

  const renderFilteredSubmissionsEmptyState = () => {
    const filterLabel =
      statusFilterOptions.find((option) => option.value === statusFilter)?.label ??
      "this filter";

    if (statusFilter === "needs_action") {
      return (
        <div className="space-y-2 text-sm text-gray-300">
          <p>No submissions need action for this form.</p>
          <Button
            variant="textLink"
            padding="px-0 py-0"
            onClick={() => setStatusFilter("all")}
          >
            View all submissions
          </Button>
        </div>
      );
    }

    if (statusFilter === "processed") {
      return (
        <div className="space-y-2 text-sm text-gray-300">
          <p>No processed submissions for this form.</p>
          <Button
            variant="textLink"
            padding="px-0 py-0"
            onClick={() => setStatusFilter("needs_action")}
          >
            View submissions that need action
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-2 text-sm text-gray-300">
        <p>No submissions match the {filterLabel} filter.</p>
        <Button
          variant="textLink"
          padding="px-0 py-0"
          onClick={() => setStatusFilter("all")}
        >
          View all submissions
        </Button>
      </div>
    );
  };

  const renderSubmissionsPanel = () => (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-gray-400">Submissions for this form</p>
          {selectedFormNeedsActionCount > 0 ? (
            <p className="mt-1 text-xs text-amber-200">
              {selectedFormNeedsActionCount} need
              {selectedFormNeedsActionCount === 1 ? "s" : ""} action
            </p>
          ) : null}
        </div>
        {selectedFormSubmissions.length > 0 ? (
          <Select
            label="Status"
            hideLabel
            className="min-w-40"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as SubmissionStatusFilter)}
            options={statusFilterOptions}
          />
        ) : null}
      </div>
      <div className="space-y-3">
        {selectedFormSubmissions.length === 0 ? (
          <p className="text-sm text-gray-300">No submissions yet.</p>
        ) : filteredSubmissions.length === 0 ? (
          renderFilteredSubmissionsEmptyState()
        ) : (
          filteredSubmissions.map(renderSubmissionCard)
        )}
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      <CreatePanel
        open={panelOpen}
        onOpenCreate={openCreate}
        canEdit={canEdit}
        title={panelTitle}
        sectionTitle="Intake forms"
        description="Share intake forms and review submissions."
        createLabel="Create intake form"
        formHeaderActions={
          panelOpen ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="tertiary"
                svg={ArrowLeft}
                iconSize="sm"
                padding="px-2 py-1"
                onClick={handlePanelBack}
              >
                Back
              </Button>
              {activeSelectedForm && !showingEditForm && canEdit ? (
                <Button
                  variant="secondary"
                  svg={Pencil}
                  iconSize="sm"
                  padding="px-2 py-1"
                  onClick={() => openFormEditor(activeSelectedForm)}
                >
                  Edit
                </Button>
              ) : null}
            </div>
          ) : null
        }
        list={
          <>
            {lastCreatedPublicUrl && canEdit && !panelOpen ? (
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
            {forms.length === 0 ? (
              <p className="text-sm text-gray-300">No intake forms yet.</p>
            ) : null}
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
                onTitleClick={() => openFormSubmissions(form)}
              />
            ))}
          </>
        }
        formFooter={
          showingEditForm ? (
            <FormActionButtons
              pinFooter
              saveLabel="Save form"
              onSave={() => void submit()}
              onCancel={cancelFormEdit}
              disabled={!canEdit}
              isLoading={saving}
            />
          ) : undefined
        }
      >
        {showingEditForm
          ? renderEditForm()
          : activeSelectedForm
            ? renderSubmissionsPanel()
            : null}
      </CreatePanel>
    </div>
  );
};

export default IntakeManager;
