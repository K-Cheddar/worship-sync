import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Send } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import Button from "../../components/Button/Button";
import { ChurchLogoImg } from "../../components/ChurchLogoImg";
import Input from "../../components/Input/Input";
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
import { showApiErrorToast } from "../../utils/apiErrorToast";
import { useToast } from "../../context/toastContext";

type PreviewPosition = TeamIntakePreview["positions"][number];

const emptyPayload = (): TeamIntakeSubmissionPayload => ({
  firstName: "",
  lastName: "",
  positionIds: [],
  occurrenceAvailability: {},
  blockoutRanges: [],
  notes: "",
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
    if (!payload.firstName.trim() || !payload.lastName.trim()) {
      showToast("First and last name are required.", "neutral");
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
                Thanks, {payload.firstName}.
              </h1>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-300 sm:text-base">
              Your availability was submitted. You can close this page.
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="First name"
              value={payload.firstName}
              labelClassName={boardFieldLabelClassName}
              inputClassName={boardDarkFieldClassName}
              onChange={(firstName) =>
                setPayload((current) => ({ ...current, firstName: String(firstName) }))
              }
            />
            <Input
              label="Last name"
              value={payload.lastName}
              labelClassName={boardFieldLabelClassName}
              inputClassName={boardDarkFieldClassName}
              onChange={(lastName) =>
                setPayload((current) => ({ ...current, lastName: String(lastName) }))
              }
            />
          </div>

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

          {preview.form.availabilityOccurrences.length > 0 ? (
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

          <Button
            variant="cta"
            svg={Send}
            iconSize="sm"
            isLoading={submitting}
            className="w-full justify-center gap-2 py-2 sm:w-auto"
            onClick={() => void submit()}
          >
            Submit availability
          </Button>
        </section>
      </div>
    </main>
  );
};

export default TeamIntakePublic;
