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
import { teamsManagerPageRootClassName } from "../teamsStyles";
import EntityMultiSelect from "../EntityMultiSelect";
import FormActionButtons from "../components/FormActionButtons";
import EntityRow from "../components/EntityRow";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Modal from "../../../components/Modal/Modal";
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
import { formatIntakeFormSaveToast } from "../teamsSaveToasts";
import { cn } from "@/utils/cnHelper";
import { useTeamsUnsavedChanges } from "../hooks/useTeamsUnsavedChanges";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import {
  intakeSubmissionNeedsAction,
  selectIntakeExactMemberMatch,
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
  requireEmail: false,
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
  const { requestDiscardAction } = useTeamsNavigationGuard();
  const churchId = context?.churchId || "";
  const [draft, setDraft] = useState<TeamIntakeFormPayload>(emptyDraft);
  const [editing, setEditing] = useState<TeamIntakeForm | null>(null);
  const [selectedForm, setSelectedForm] = useState<TeamIntakeForm | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastCreatedPublicUrl, setLastCreatedPublicUrl] = useState("");
  const [selectedMemberBySubmission, setSelectedMemberBySubmission] = useState<Record<string, string>>({});
  const [submissionUpdatingKey, setSubmissionUpdatingKey] = useState("");
  const [bulkLinking, setBulkLinking] = useState(false);
  const [showBulkLinkConfirm, setShowBulkLinkConfirm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SubmissionStatusFilter>(
    "needs_action",
  );

  const panelOpen = selectedForm !== null || showCreate;
  const showingEditForm = showCreate || showEditForm;
  const hasPendingChanges = editing
    ? JSON.stringify(draft) !==
      JSON.stringify({
        name: editing.name,
        startDate: editing.startDate,
        endDate: editing.endDate,
        availabilityServices: editing.availabilityServices || [],
        availabilityOccurrences: editing.availabilityOccurrences || [],
        teamIds: editing.teamIds || [],
        active: editing.active,
        requireEmail: Boolean(editing.requireEmail),
        welcomeMessage: editing.welcomeMessage || "",
        positionsMessage: editing.positionsMessage || "",
        availabilityMessage: editing.availabilityMessage || "",
        notesMessage: editing.notesMessage || "",
      })
    : JSON.stringify(draft) !== JSON.stringify(emptyDraft());
  useTeamsUnsavedChanges(hasPendingChanges);

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
          // A service remains discoverable after its recurrence ends. Its own
          // date bounds decide whether it can produce an occurrence in this form.
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
    const saveToastMessage = formatIntakeFormSaveToast(editing, payload, {
      teamNameById: new Map(teams.map((team) => [team.teamId, team.name])),
      serviceNameById: new Map(
        services.map((service) => [service.serviceId, service.name]),
      ),
    });
    setSaving(true);
    try {
      if (editing) {
        const response = await updateTeamIntakeForm(churchId, editing.formId, payload);
        onFormSaved(response.form);
        setSelectedForm(response.form);
        setShowEditForm(false);
        setEditing(null);
        setDraft(emptyDraft());
        showToast(saveToastMessage, "success");
      } else {
        const response = await createTeamIntakeForm(churchId, payload);
        onFormSaved(response.form);
        if (response.publicToken) {
          setLastCreatedPublicUrl(
            response.publicUrl || buildTeamIntakePublicUrl(response.publicToken),
          );
        }
        showToast(saveToastMessage, "success");
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

  // Open submissions whose name exactly matches one active member; these are
  // the only ones safe to link without a person reviewing each match.
  const exactMatchTargets = useMemo(
    () =>
      selectedFormSubmissions
        .filter(intakeSubmissionNeedsAction)
        .flatMap((submission) => {
          const member = selectIntakeExactMemberMatch(submission, activeMembers);
          return member ? [{ submission, member }] : [];
        }),
    [selectedFormSubmissions, activeMembers],
  );

  // Aggregate views so an admin can scan every submitter's notes or blockout
  // dates at once instead of expanding each card. Covers all submissions for
  // the form regardless of the status filter.
  const allSubmissionNotes = useMemo(
    () =>
      selectedFormSubmissions.flatMap((submission) => {
        const notes = (submission.notes || "").trim();
        return notes
          ? [
            {
              submissionId: submission.submissionId,
              name: `${submission.firstName} ${submission.lastName}`.trim(),
              notes,
            },
          ]
          : [];
      }),
    [selectedFormSubmissions],
  );

  const allSubmissionBlockouts = useMemo(
    () =>
      selectedFormSubmissions.flatMap((submission) => {
        const labels = (submission.blockoutRanges || [])
          .map((range) => formatPlainDateRangeLabel(range.startDate, range.endDate))
          .filter(Boolean);
        return labels.length > 0
          ? [
            {
              submissionId: submission.submissionId,
              name: `${submission.firstName} ${submission.lastName}`.trim(),
              labels,
            },
          ]
          : [];
      }),
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

  const submissionActionKey = (
    submissionId: string,
    kind: "link" | "create" | "dismiss" | "restore",
  ) => `${submissionId}:${kind}`;

  const updateSubmission = async (
    submission: TeamIntakeSubmission,
    action: "new" | "applied" | "dismissed",
    memberId?: string,
    createMember = false,
  ) => {
    if (!canEdit) return;
    const updatingKey =
      action === "applied"
        ? submissionActionKey(
          submission.submissionId,
          createMember ? "create" : "link",
        )
        : action === "dismissed"
          ? submissionActionKey(submission.submissionId, "dismiss")
          : submissionActionKey(submission.submissionId, "restore");
    setSubmissionUpdatingKey(updatingKey);
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
    } finally {
      setSubmissionUpdatingKey("");
    }
  };

  const bulkLinkExactMatches = async () => {
    setShowBulkLinkConfirm(false);
    if (!canEdit || bulkLinking || exactMatchTargets.length === 0) return;
    setBulkLinking(true);
    let linked = 0;
    let failed = 0;
    try {
      // Sequential on purpose: each apply can touch the same roster/teams, and
      // the per-row spinner tracks whichever submission is in flight.
      for (const { submission, member } of exactMatchTargets) {
        setSubmissionUpdatingKey(
          submissionActionKey(submission.submissionId, "link"),
        );
        try {
          const response = await applyTeamIntakeSubmission(
            churchId,
            submission.submissionId,
            { action: "applied", memberId: member.memberId },
          );
          onSubmissionSaved(response.submission);
          if (response.member) onMemberSaved(response.member);
          response.teams?.forEach((team) => onTeamSaved(team));
          linked += 1;
        } catch {
          failed += 1;
        }
      }
    } finally {
      setSubmissionUpdatingKey("");
      setBulkLinking(false);
    }
    if (failed === 0) {
      showToast(
        `Linked ${linked} submission${linked === 1 ? "" : "s"} to matching members.`,
        "success",
      );
    } else {
      showToast(
        `Linked ${linked} of ${exactMatchTargets.length} submissions. Link the rest from their cards.`,
        "neutral",
      );
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
    const isUpdatingThisSubmission =
      bulkLinking ||
      submissionUpdatingKey.startsWith(`${submission.submissionId}:`);
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
                    disabled={!selectedMemberId || isUpdatingThisSubmission}
                    isLoading={
                      submissionUpdatingKey ===
                      submissionActionKey(submission.submissionId, "link")
                    }
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
                    disabled={isUpdatingThisSubmission}
                    isLoading={
                      submissionUpdatingKey ===
                      submissionActionKey(submission.submissionId, "create")
                    }
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
                disabled={isUpdatingThisSubmission}
                isLoading={
                  submissionUpdatingKey ===
                  submissionActionKey(submission.submissionId, "dismiss")
                }
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
              disabled={isUpdatingThisSubmission}
              isLoading={
                submissionUpdatingKey ===
                submissionActionKey(submission.submissionId, "restore")
              }
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
      {/* Off by default: an address is how anyone reaches this person later,
          but requiring one turns away volunteers who do not have one to give. */}
      <Checkbox
        label="Require an email address"
        checked={Boolean(draft.requireEmail)}
        onCheckedChange={(requireEmail) =>
          setDraft((d) => ({ ...d, requireEmail }))
        }
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
        <div className="flex flex-wrap items-center gap-2">
          {/* Hidden on "Processed" so the bulk action only appears when its
              target submissions are visible in the list below. */}
          {canEdit && exactMatchTargets.length > 0 && statusFilter !== "processed" ? (
            <Button
              variant="secondary"
              svg={Check}
              iconSize="sm"
              padding="px-2 py-1"
              disabled={bulkLinking}
              isLoading={bulkLinking}
              onClick={() => setShowBulkLinkConfirm(true)}
            >
              Link {exactMatchTargets.length} exact match
              {exactMatchTargets.length === 1 ? "" : "es"}
            </Button>
          ) : null}
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
      </div>
      {allSubmissionBlockouts.length > 0 || allSubmissionNotes.length > 0 ? (
        <div className="rounded-md border border-gray-700 bg-gray-950/60 px-3 pb-3">
          {allSubmissionBlockouts.length > 0 ? (
            <ReviewQueueCollapsibleSection
              title="All blockout dates"
              summary={`${allSubmissionBlockouts.length} ${allSubmissionBlockouts.length === 1 ? "person" : "people"}`}
            >
              <ul className="space-y-1 text-gray-300">
                {allSubmissionBlockouts.map((entry) => (
                  <li key={entry.submissionId}>
                    <span className="font-semibold">{entry.name}: </span>
                    {entry.labels.join("; ")}
                  </li>
                ))}
              </ul>
            </ReviewQueueCollapsibleSection>
          ) : null}
          {allSubmissionNotes.length > 0 ? (
            <ReviewQueueCollapsibleSection
              title="All notes"
              summary={`${allSubmissionNotes.length} note${allSubmissionNotes.length === 1 ? "" : "s"}`}
            >
              <ul className="space-y-2 text-gray-300">
                {allSubmissionNotes.map((entry) => (
                  <li key={entry.submissionId}>
                    <span className="font-semibold">{entry.name}: </span>
                    <span className="whitespace-pre-wrap">{entry.notes}</span>
                  </li>
                ))}
              </ul>
            </ReviewQueueCollapsibleSection>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-3">
        {selectedFormSubmissions.length === 0 ? (
          <p className="text-sm text-gray-300">No submissions yet.</p>
        ) : filteredSubmissions.length === 0 ? (
          renderFilteredSubmissionsEmptyState()
        ) : (
          filteredSubmissions.map(renderSubmissionCard)
        )}
      </div>
      <Modal
        isOpen={showBulkLinkConfirm}
        onClose={() => setShowBulkLinkConfirm(false)}
        title="Link exact matches?"
        size="sm"
      >
        <div className="space-y-3 text-sm text-gray-200">
          <p>
            This links {exactMatchTargets.length} submission
            {exactMatchTargets.length === 1 ? "" : "s"} to the member with the
            same name:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-gray-300">
            {exactMatchTargets.map(({ submission, member }) => (
              <li key={submission.submissionId}>{memberName(member)}</li>
            ))}
          </ul>
          <p>Linked submissions move to Processed.</p>
        </div>
        <div className="mt-6 flex w-full gap-3">
          <Button
            className="flex-1 justify-center"
            type="button"
            variant="tertiary"
            onClick={() => setShowBulkLinkConfirm(false)}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 justify-center"
            type="button"
            variant="secondary"
            onClick={() => void bulkLinkExactMatches()}
          >
            Link members
          </Button>
        </div>
      </Modal>
    </>
  );

  return (
    <div className={teamsManagerPageRootClassName}>
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
                onTitleClick={() => {
                  if (selectedForm?.formId === form.formId) return;
                  requestDiscardAction(() => openFormSubmissions(form));
                }}
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
              hasPendingChanges={hasPendingChanges}
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
