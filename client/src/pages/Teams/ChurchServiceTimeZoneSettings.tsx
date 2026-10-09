import { useMemo, useState } from "react";
import { updateChurchServiceTimeZone } from "../../api/auth";
import { useChat } from "../../chat/ChatContext";
import { useChurchServiceTimeZone } from "../../context/churchServiceTimeZone";
import { useToast } from "../../context/toastContext";
import { showApiErrorToast } from "../../utils/apiErrorToast";

type Props = {
  churchId: string;
  canEdit: boolean;
};

const getTimeZoneOptions = () => {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  const supported = intl.supportedValuesOf?.("timeZone") || [];
  return [...new Set(["UTC", ...supported])].sort((left, right) =>
    left === "UTC" ? -1 : right === "UTC" ? 1 : left.localeCompare(right),
  );
};

const ChurchServiceTimeZoneSettings = ({ churchId, canEdit }: Props) => {
  const churchTimeZone = useChurchServiceTimeZone();
  const chat = useChat();
  const { showToast } = useToast();
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const timeZoneOptions = useMemo(getTimeZoneOptions, []);
  const isLoaded = churchTimeZone.status === "ready";
  const savedTimeZone = churchTimeZone.timeZone || "UTC";
  const selectedTimeZone = timeZone ?? savedTimeZone;

  const save = async () => {
    setIsSaving(true);
    try {
      const result = await updateChurchServiceTimeZone(churchId, selectedTimeZone);
      setTimeZone(result.serviceTimeZone);
      await churchTimeZone.refresh();
      await chat?.refreshContext();
      showToast("Church time zone saved.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save the church time zone.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-64">
          <label
            className="mb-1 block text-sm font-semibold text-gray-900 dark:text-gray-100"
            htmlFor="church-service-time-zone"
          >
            Church time zone
          </label>
          <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
            Used for service dates, schedules, availability, and Service Plans.
          </p>
          {!churchTimeZone.isConfigured && (
            <p className="mb-2 text-sm text-amber-700 dark:text-amber-300">
              No church time zone is set yet. Scheduling uses UTC until one is saved.
            </p>
          )}
          {!churchTimeZone.isConfigured && churchTimeZone.legacyTimeZoneSuggestion && (
            <p className="mb-2 text-sm text-blue-700 dark:text-blue-300">
              Historical Chat setting: {churchTimeZone.legacyTimeZoneSuggestion}. Confirm it before applying.
              {canEdit && (
                <button
                  type="button"
                  className="ml-2 underline"
                  disabled={!isLoaded || isSaving}
                  onClick={() => setTimeZone(churchTimeZone.legacyTimeZoneSuggestion)}
                >
                  Use suggestion
                </button>
              )}
            </p>
          )}
          <select
            id="church-service-time-zone"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            value={selectedTimeZone}
            disabled={!canEdit || !isLoaded || isSaving || !churchTimeZone.timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
          >
            {!timeZoneOptions.includes(selectedTimeZone) && (
              <option value={selectedTimeZone}>{selectedTimeZone}</option>
            )}
            {timeZoneOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        {canEdit && (
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!isLoaded || isSaving || selectedTimeZone === savedTimeZone}
            onClick={() => void save()}
          >
            {isSaving ? "Saving…" : "Save time zone"}
          </button>
        )}
      </div>
    </section>
  );
};

export default ChurchServiceTimeZoneSettings;
