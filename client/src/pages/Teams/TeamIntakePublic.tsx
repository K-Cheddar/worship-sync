import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Send } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import Button from "../../components/Button/Button";
import { ChurchLogoImg } from "../../components/ChurchLogoImg";
import Input from "../../components/Input/Input";
import Checkbox from "../../components/Checkbox/Checkbox";
import Select from "../../components/Select/Select";
import TextArea from "../../components/TextArea/TextArea";
import Spinner from "../../components/Spinner/Spinner";
import {
  getTeamIntakePreview,
  submitTeamIntake,
  type TeamIntakeSubmissionPayload,
} from "../../api/auth";
import type { TeamIntakePreview } from "../../api/authTypes";
import BlockoutDatesField from "./components/BlockoutDatesField";
import EntityMultiSelect from "./EntityMultiSelect";
import {
  boardDarkFieldClassName,
  boardFieldLabelClassName,
  boardFieldsetDescriptionClassName,
  boardHeaderClassName,
  boardIntakeFormSectionClassName,
  boardPublicPageClassName,
} from "./teamsStyles";
import { formatPlainDateRangeLabel, formatShortOccurrenceDate } from "./teamsUtils";
import { DEFAULT_INTAKE_FORM_COPY, resolveIntakeCopy } from "./intakeFormCopy";
import { resolveIntakeFormFields } from "./intakeFormFields";
import BirthDateField from "./components/BirthDateField";
import {
  DEFAULT_SERVING_FREQUENCY,
  emptyRecurringAvailability,
  recurringAvailabilityWeekOptions,
  servingFrequencyOptions,
} from "./memberPreferences";
import { showApiErrorToast } from "../../utils/apiErrorToast";
import { useToast } from "../../context/toastContext";

type PreviewPosition = TeamIntakePreview["positions"][number];

const emptyPayload = (): TeamIntakeSubmissionPayload => ({
  firstName: "",
  lastName: "",
  email: "",
  title: "",
  birthDate: null,
  positionIds: [],
  occurrenceAvailability: {},
  blockoutRanges: [],
  notes: "",
  servingFrequency: DEFAULT_SERVING_FREQUENCY,
  recurringAvailability: emptyRecurringAvailability(),
});

const TeamIntakePublic = () => {
  const { token: routeToken = "" } = useParams();
  const [params] = useSearchParams();
  const token = routeToken || params.get("token") || "";
  const { showToast } = useToast();
  const [preview, setPreview] = useState<TeamIntakePreview | null>(null);
  const [payload, setPayload] = useState<TeamIntakeSubmissionPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTeamIntakePreview(token)
      .then((response) => {
        if (!cancelled) setPreview(response);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load this form.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async () => {
    const missingNameFields = [
      enabledFields.includes("firstName") && !payload.firstName.trim()
        ? "first name"
        : "",
      enabledFields.includes("lastName") && !payload.lastName.trim()
        ? "last name"
        : "",
    ].filter(Boolean);
    if (missingNameFields.length > 0) {
      const message =
        missingNameFields.length === 2
          ? "First and last name are required."
          : `${missingNameFields[0][0].toUpperCase()}${missingNameFields[0].slice(1)} is required.`;
      showToast(message, "neutral");
      return;
    }
    // Toast, not `setError`: that state renders the "Form unavailable" screen
    // and would throw away everything they had typed.
    if (emailRequired && !payload.email?.trim()) {
      showToast("Email is required.", "neutral");
      return;
    }
    setSubmitting(true);
    try {
      await submitTeamIntake(token, payload);
      setSubmitted(true);
    } catch (submitError) {
      showApiErrorToast(showToast, submitError, "Could not submit this form.");
    } finally {
      setSubmitting(false);
    }
  };

  const churchLogoUrl = preview?.churchLogoUrl?.trim() || "";
  /** Per-form setting; the server rejects a blank address when it is on. */
  const enabledFields = preview ? resolveIntakeFormFields(preview.form) : [];
  const emailRequired =
    enabledFields.includes("email") && Boolean(preview?.form?.requireEmail);

  // Group positions under their team so submitters can skip teams that aren't
  // theirs. The server already scopes which teams appear.
  const positionGroups = useMemo(() => {
    if (!preview) return [];
    const previewTeams = preview.teams || [];
    const teamName = new Map(previewTeams.map((team) => [team.teamId, team.name]));
    const order = previewTeams.map((team) => team.teamId);
    const byTeam = new Map<string, PreviewPosition[]>();
    preview.positions.forEach((position) => {
      const list = byTeam.get(position.teamId) || [];
      list.push(position);
      byTeam.set(position.teamId, list);
    });
    const teamIds = [
      ...order.filter((id) => byTeam.has(id)),
      ...[...byTeam.keys()].filter((id) => !order.includes(id)),
    ];
    return teamIds.map((teamId) => ({
      teamId,
      name: teamName.get(teamId) || "Other positions",
      positions: byTeam.get(teamId) || [],
    }));
  }, [preview]);
  // Headers only earn their keep once more than one team is on the form.
  const showTeamHeaders = positionGroups.length > 1;

  const positionOptions = useMemo(
    () =>
      positionGroups.flatMap((group) =>
        group.positions.map((position) => ({
          id: position.positionId,
          label: position.name,
          icon: position.icon,
          sublabel: showTeamHeaders ? group.name : undefined,
        })),
      ),
    [positionGroups, showTeamHeaders],
  );

  const availableOccurrenceIds = useMemo(
    () =>
      Object.entries(payload.occurrenceAvailability)
        .filter(([, status]) => status === "available")
        .map(([occurrenceId]) => occurrenceId),
    [payload.occurrenceAvailability],
  );

  if (loading) {
    return (
      <main className={cn(boardPublicPageClassName, "flex items-center justify-center")}>
        <Spinner width="40px" borderWidth="4px" />
      </main>
    );
  }

  if (error || !preview) {
    return (
      <main className={boardPublicPageClassName}>
        <div className="mx-auto w-full max-w-4xl">
          <div className="rounded-xl border border-red-400/40 bg-red-950/40 p-6">
            <h1 className="text-xl font-semibold text-stone-50">Form unavailable</h1>
            <p className="mt-2 text-sm text-red-100/80">
              {error || "This form could not be loaded."}
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className={boardPublicPageClassName}>
        <div className="mx-auto w-full max-w-4xl">
          <header className={boardHeaderClassName}>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
              Team availability
            </p>
            <div className="mt-3 flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
              {churchLogoUrl ? (
                <ChurchLogoImg src={churchLogoUrl} variant="board-attendee" />
              ) : null}
              <h1 className="min-w-0 flex-1 text-3xl font-semibold sm:text-4xl">
                {payload.firstName ? `Thanks, ${payload.firstName}.` : "Thanks."}
              </h1>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-300 sm:text-base">
              Your response was submitted. You can close this page.
            </p>
          </header>
        </div>
      </main>
    );
  }

  return (
    <main className={boardPublicPageClassName}>
      <div className="mx-auto w-full max-w-4xl">
        <header className={boardHeaderClassName}>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            Team availability
          </p>
          <div className="mt-3 flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            {churchLogoUrl ? (
              <ChurchLogoImg src={churchLogoUrl} variant="board-attendee" alt={preview.churchName} />
            ) : null}
            <h1 className="min-w-0 flex-1 text-3xl font-semibold sm:text-4xl">
              {preview.form.name}
            </h1>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-300 sm:text-base">
            {preview.churchName} ·{" "}
            {formatPlainDateRangeLabel(preview.form.startDate, preview.form.endDate)}
          </p>
          <p className="mt-2 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-stone-400">
            {resolveIntakeCopy(
              preview.form.welcomeMessage,
              DEFAULT_INTAKE_FORM_COPY.welcome,
            )}
          </p>
        </header>

        <section className={cn(boardIntakeFormSectionClassName, "mt-4 space-y-6")}>
          {[
            "title",
            "firstName",
            "lastName",
            "birthDate",
            "email",
          ].some((field) => enabledFields.includes(field as (typeof enabledFields)[number])) ? (
            <fieldset
              aria-label="Personal information"
              className="grid gap-3 rounded-md border border-stone-700 bg-stone-950/20 p-4 sm:grid-cols-12"
            >
              {enabledFields.includes("title") ? (
                <Input
                  label="Title"
                  value={payload.title || ""}
                  placeholder="Pastor, Dr., Mrs., etc."
                  labelClassName={boardFieldLabelClassName}
                  inputClassName={boardDarkFieldClassName}
                  className="sm:col-span-2"
                  onChange={(title) =>
                    setPayload((current) => ({ ...current, title: String(title) }))
                  }
                />
              ) : null}
              {enabledFields.includes("firstName") ? (
                <Input
                  label="First name"
                  value={payload.firstName}
                  labelClassName={boardFieldLabelClassName}
                  inputClassName={boardDarkFieldClassName}
                  className={enabledFields.includes("title") ? "sm:col-span-5" : "sm:col-span-6"}
                  onChange={(firstName) =>
                    setPayload((current) => ({ ...current, firstName: String(firstName) }))
                  }
                />
              ) : null}
              {enabledFields.includes("lastName") ? (
                <Input
                  label="Last name"
                  value={payload.lastName}
                  labelClassName={boardFieldLabelClassName}
                  inputClassName={boardDarkFieldClassName}
                  className={enabledFields.includes("title") ? "sm:col-span-5" : "sm:col-span-6"}
                  onChange={(lastName) =>
                    setPayload((current) => ({ ...current, lastName: String(lastName) }))
                  }
                />
              ) : null}

          {enabledFields.includes("birthDate") ? (
            <BirthDateField
              label="Birthday"
              value={payload.birthDate}
              labelClassName={boardFieldLabelClassName}
              inputClassName={boardDarkFieldClassName}
              className="sm:col-span-6"
              onChange={(birthDate) =>
                setPayload((current) => ({
                  ...current,
                  birthDate,
                }))
              }
            />
          ) : null}

          {/* Intake is the only place most volunteers will ever give us an
              address. Whether it is required is a per-form setting, and the
              label has to say so before they submit — the server rejects a
              missing address, and discovering that after filling the whole
              form is the worst time to learn it. */}
          {enabledFields.includes("email") ? (
            <Input
              label={emailRequired ? "Email (required)" : "Email"}
              type="email"
              value={payload.email || ""}
              labelClassName={boardFieldLabelClassName}
              inputClassName={boardDarkFieldClassName}
              className="sm:col-span-6"
              onChange={(email) =>
                setPayload((current) => ({ ...current, email: String(email) }))
              }
            />
          ) : null}

            </fieldset>
          ) : null}

          {enabledFields.includes("positions") ? (
            <EntityMultiSelect
            label="Positions"
            description={resolveIntakeCopy(
              preview.form.positionsMessage,
              DEFAULT_INTAKE_FORM_COPY.positions,
            )}
            variant="board-attendee"
            showSearch={false}
            options={positionOptions}
            value={payload.positionIds}
            onChange={(positionIds) =>
              setPayload((current) => ({ ...current, positionIds }))
            }
            />
          ) : null}

          {enabledFields.includes("availability") &&
          preview.form.availabilityOccurrences.length > 0 ? (
            <EntityMultiSelect
              label="Service date availability"
              description={resolveIntakeCopy(
                preview.form.availabilityMessage,
                DEFAULT_INTAKE_FORM_COPY.availability,
              )}
              variant="board-attendee"
              emphasizeSublabel
              options={preview.form.availabilityOccurrences.map((occurrence) => ({
                id: occurrence.occurrenceId,
                label: occurrence.name,
                sublabel: formatShortOccurrenceDate(occurrence.startsAt),
              }))}
              value={availableOccurrenceIds}
              onChange={(occurrenceIds) =>
                setPayload((current) => {
                  const nextAvailability = { ...current.occurrenceAvailability };
                  preview.form.availabilityOccurrences.forEach((occurrence) => {
                    nextAvailability[occurrence.occurrenceId] = occurrenceIds.includes(
                      occurrence.occurrenceId,
                    )
                      ? "available"
                      : "unavailable";
                  });
                  return { ...current, occurrenceAvailability: nextAvailability };
                })
              }
            />
          ) : null}

          {enabledFields.includes("schedulingPreferences") ? (
            <fieldset className="space-y-3 rounded-md border border-stone-700 bg-stone-950/30 p-4 pt-2">
              <legend className={cn(boardFieldLabelClassName, "px-1")}>
                Scheduling preferences
              </legend>
              <Select
                label="Serving frequency"
                value={payload.servingFrequency || DEFAULT_SERVING_FREQUENCY}
                options={servingFrequencyOptions}
                labelClassName={boardFieldLabelClassName}
                selectClassName={boardDarkFieldClassName}
                onChange={(servingFrequency) =>
                  setPayload((current) => ({
                    ...current,
                    servingFrequency:
                      servingFrequency as TeamIntakeSubmissionPayload["servingFrequency"],
                  }))
                }
              />
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-stone-100">
                  Weeks you can usually serve
                </legend>
                <p className="text-xs text-stone-400">
                  Leave every option unchecked if any week works.
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {recurringAvailabilityWeekOptions.map((option) => {
                    const availability =
                      payload.recurringAvailability || emptyRecurringAvailability();
                    return (
                      <Checkbox
                        key={option.value}
                        label={option.label}
                        checked={availability.weeksOfMonth.includes(option.value)}
                        onCheckedChange={(checked) =>
                          setPayload((current) => {
                            const currentAvailability =
                              current.recurringAvailability ||
                              emptyRecurringAvailability();
                            return {
                              ...current,
                              recurringAvailability: {
                                ...currentAvailability,
                                weeksOfMonth: checked
                                  ? [...currentAvailability.weeksOfMonth, option.value].sort()
                                  : currentAvailability.weeksOfMonth.filter(
                                    (week) => week !== option.value,
                                  ),
                              },
                            };
                          })
                        }
                      />
                    );
                  })}
                  <Checkbox
                    label="Last week"
                    checked={Boolean(
                      payload.recurringAvailability?.includeLastWeekOfMonth,
                    )}
                    onCheckedChange={(includeLastWeekOfMonth) =>
                      setPayload((current) => ({
                        ...current,
                        recurringAvailability: {
                          ...(current.recurringAvailability ||
                            emptyRecurringAvailability()),
                          includeLastWeekOfMonth,
                        },
                      }))
                    }
                  />
                </div>
              </fieldset>
            </fieldset>
          ) : null}

          {enabledFields.includes("blockoutDates") ? (
            <BlockoutDatesField
            label="Blockout dates"
            description={`Add days you're away or can't serve within ${formatPlainDateRangeLabel(preview.form.startDate, preview.form.endDate)}.`}
            value={payload.blockoutRanges}
            min={preview.form.startDate}
            max={preview.form.endDate}
            fieldClassName={boardDarkFieldClassName}
            variant="board-attendee"
            onChange={(blockoutRanges) =>
              setPayload((current) => ({ ...current, blockoutRanges }))
            }
            />
          ) : null}

          {enabledFields.includes("notes") ? (
            <TextArea
            label="Notes"
            description={resolveIntakeCopy(
              preview.form.notesMessage,
              DEFAULT_INTAKE_FORM_COPY.notes,
            )}
            descriptionClassName={boardFieldsetDescriptionClassName}
            value={payload.notes || ""}
            labelClassName={boardFieldLabelClassName}
            textareaClassName={cn(boardDarkFieldClassName, "min-h-24")}
            onChange={(notes) => setPayload((current) => ({ ...current, notes }))}
            />
          ) : null}

          <div className="flex justify-center">
            <Button
              variant="cta"
              svg={Send}
              iconSize="sm"
              isLoading={submitting}
              className="w-full justify-center gap-2 py-2 sm:w-48"
              onClick={() => void submit()}
            >
              Submit form
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
};

export default TeamIntakePublic;
