import { useEffect, useId, useRef, useState } from "react";
import { Clock } from "lucide-react";
import type { Option } from "../../types";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import { updateChurchServiceTimeZone } from "../../api/auth";
import { useChat } from "../../chat/ChatContext";
import { useChurchServiceTimeZone } from "../../context/churchServiceTimeZone";
import { useToast } from "../../context/toastContext";
import { showApiErrorToast } from "../../utils/apiErrorToast";

type Props = {
  churchId: string;
  canEdit: boolean;
};

const getFriendlyTimeZoneName = (timeZone: string) => {
  if (timeZone === "UTC") return "UTC";

  const city = timeZone.split("/").at(-1)?.replace(/_/g, " ");
  let timeZoneName: string | undefined;
  try {
    timeZoneName = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longGeneric",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
  } catch {
    return timeZone.replace(/_/g, " ");
  }

  if (!timeZoneName) return timeZone.replace(/_/g, " ");
  return city ? `${timeZoneName} (${city})` : timeZoneName;
};

const TIME_ZONE_OPTIONS: Option[] = [
  { label: "Eastern Time (New York)", value: "America/New_York" },
  { label: "Central Time (Chicago)", value: "America/Chicago" },
  { label: "Mountain Time (Denver)", value: "America/Denver" },
  { label: "Mountain Time (Arizona)", value: "America/Phoenix" },
  { label: "Pacific Time (Los Angeles)", value: "America/Los_Angeles" },
  { label: "Alaska Time (Anchorage)", value: "America/Anchorage" },
  { label: "Hawaii Time (Honolulu)", value: "Pacific/Honolulu" },
  { label: "Atlantic Time (Puerto Rico)", value: "America/Puerto_Rico" },
];

const ChurchServiceTimeZoneSettings = ({ churchId, canEdit }: Props) => {
  const churchTimeZone = useChurchServiceTimeZone();
  const chat = useChat();
  const { showToast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [timeZoneDraft, setTimeZoneDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const timeZoneControlId = useId();
  const actionButtonRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const hasEnteredEditor = useRef(false);
  const isLoaded = churchTimeZone.status === "ready";
  const savedTimeZone = churchTimeZone.isConfigured
    ? churchTimeZone.timeZone
    : null;

  useEffect(() => {
    if (isEditing) {
      hasEnteredEditor.current = true;
      document.getElementById(timeZoneControlId)?.focus();
    } else if (hasEnteredEditor.current) {
      actionButtonRef.current?.focus();
    }
  }, [isEditing, timeZoneControlId]);

  const hasSelectionChange = Boolean(
    timeZoneDraft && timeZoneDraft !== (savedTimeZone || ""),
  );
  const timeZoneOptions = [
    ...TIME_ZONE_OPTIONS,
    ...(savedTimeZone &&
    !TIME_ZONE_OPTIONS.some((option) => option.value === savedTimeZone)
      ? [
          {
            value: savedTimeZone,
            label: getFriendlyTimeZoneName(savedTimeZone),
            group: "Current setting",
          },
        ]
      : []),
  ];

  const startEditing = () => {
    setTimeZoneDraft(savedTimeZone || "America/New_York");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setTimeZoneDraft("");
    setIsEditing(false);
  };

  const save = async () => {
    if (!canEdit || !isLoaded || isSaving || !hasSelectionChange) return;

    setIsSaving(true);
    try {
      const result = await updateChurchServiceTimeZone(churchId, timeZoneDraft);
      setTimeZoneDraft(result.serviceTimeZone);
      await churchTimeZone.refresh();
      await chat?.refreshContext();
      setIsEditing(false);
      showToast("Church time zone saved.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save the church time zone.");
    } finally {
      setIsSaving(false);
    }
  };

  const savedTimeZoneLabel = savedTimeZone
    ? getFriendlyTimeZoneName(savedTimeZone)
    : null;
  return (
    <section
      aria-label="Church time zone settings"
      className="border-b border-gray-700/60 pb-3"
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Clock className="size-4 shrink-0 text-gray-400" aria-hidden="true" />
          <span className="shrink-0 font-semibold text-gray-100">
            Church time zone
          </span>
          {!isEditing && (
            <span
              className={
                savedTimeZoneLabel
                  ? "min-w-0 break-words text-gray-300"
                  : "min-w-0 text-gray-400"
              }
              role="status"
            >
              {!isLoaded
                ? churchTimeZone.status === "error"
                  ? "Could not load"
                  : "Loading..."
                : savedTimeZoneLabel || "Not configured"}
            </span>
          )}
        </div>

        {isEditing ? (
          <div className="min-w-0 flex-1 sm:max-w-xl">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                id={timeZoneControlId}
                aria-label="Time zone"
                options={timeZoneOptions}
                value={timeZoneDraft}
                onChange={setTimeZoneDraft}
                placeholder="Select time zone"
                className="w-full min-w-0 sm:flex-1"
                size="sm"
                disabled={!canEdit || !isLoaded || isSaving}
                textColor="text-neutral-100"
                backgroundColor="bg-neutral-900"
                contentBackgroundColor="bg-neutral-900"
                contentTextColor="text-neutral-100"
                contentClassName="max-h-[min(60vh,24rem)]"
              />
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="primary"
                  className="px-3 py-1.5"
                  disabled={!canEdit || !isLoaded || isSaving || !hasSelectionChange}
                  isLoading={isSaving}
                  aria-label={isSaving ? "Saving time zone" : "Save time zone"}
                  onClick={() => void save()}
                >
                  {isSaving ? "Saving..." : "Save time zone"}
                </Button>
                <Button
                  variant="tertiary"
                  className="px-3 py-1.5"
                  disabled={isSaving}
                  onClick={cancelEditing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : canEdit && isLoaded ? (
          <Button
            ref={actionButtonRef}
            variant="textLink"
            className="self-start text-sm text-cyan-300 hover:text-cyan-200 sm:self-auto"
            onClick={startEditing}
          >
            {savedTimeZoneLabel ? "Change" : "Select time zone"}
          </Button>
        ) : null}
      </div>
    </section>
  );
};

export default ChurchServiceTimeZoneSettings;
