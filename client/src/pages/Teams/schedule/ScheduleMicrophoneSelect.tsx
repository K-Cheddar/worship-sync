import { TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { ServicePlanMicrophoneChip } from "../../../components/ServicePlanMicrophoneChip";
import { ServicePlanMicrophoneIcon } from "../../../components/ServicePlanMicrophoneIcon";
import {
  Select as RadixSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";

/** Radix reserves an empty string for clearing the current selection. */
const NONE_MICROPHONE_VALUE = "__none__";

export type ScheduleMicrophoneHolder = {
  slotKey: string;
  label: string;
};

type ScheduleMicrophoneSelectProps = {
  microphoneIds?: string[];
  microphones: ServicePlanMicrophone[];
  holdersByMicrophone: ReadonlyMap<string, ScheduleMicrophoneHolder[]>;
  slotKey: string;
  ariaLabel: string;
  canEdit: boolean;
  loading?: boolean;
  unavailable?: boolean;
  saving?: boolean;
  onChange: (microphoneIds: string[]) => void;
};

/**
 * Inline microphone control shared by the schedule's card and grid layouts.
 * The schedule remains the source of truth, so operators can assign a person
 * and their microphone in the same role row.
 */
const ScheduleMicrophoneSelect = ({
  microphoneIds = [],
  microphones,
  holdersByMicrophone,
  slotKey,
  ariaLabel,
  canEdit,
  loading = false,
  unavailable = false,
  saving = false,
  onChange,
}: ScheduleMicrophoneSelectProps) => {
  const microphoneById = new Map(
    microphones.map((microphone) => [microphone.id, microphone]),
  );
  // Schedule allocation is one microphone per role. Preserve the first value
  // when displaying legacy rows that contain more than one.
  const selectedId = microphoneIds[0] || "";
  const selectedMicrophone = selectedId
    ? microphoneById.get(selectedId)
    : undefined;
  const sharedWith = selectedId
    ? (holdersByMicrophone.get(selectedId) || [])
      .filter((holder) => holder.slotKey !== slotKey)
      .map((holder) => holder.label)
    : [];

  if (loading) {
    return <p className="text-[11px] text-gray-500">Loading microphones…</p>;
  }
  if (unavailable) {
    return <p className="text-[11px] text-amber-300">Microphones unavailable.</p>;
  }
  if (microphones.length === 0) {
    return (
      <p className="text-[11px] text-gray-500">
        No microphones configured.{" "}
        <Link
          to={TEAMS_SECTION_PATHS.microphones}
          className="cursor-pointer font-medium text-cyan-300 hover:text-cyan-200"
        >
          Open Microphones
        </Link>
      </p>
    );
  }

  return (
    <div>
      {canEdit ? (
        <RadixSelect
          value={selectedId || NONE_MICROPHONE_VALUE}
          disabled={saving}
          onValueChange={(next) => {
            onChange(next === NONE_MICROPHONE_VALUE ? [] : [next]);
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={ariaLabel}
            className="h-8 w-full justify-between border-gray-700 bg-gray-950/60 px-2 text-left text-[11px] text-gray-100"
          >
            <SelectValue placeholder="No microphone">
              {selectedMicrophone ? (
                <span className="inline-flex min-w-0 items-center gap-2">
                  <ServicePlanMicrophoneIcon
                    microphone={selectedMicrophone}
                    color={selectedMicrophone.color}
                    className="size-4 shrink-0"
                  />
                  <span className="truncate">{selectedMicrophone.name}</span>
                </span>
              ) : (
                "No microphone"
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-[14rem]">
            <SelectItem value={NONE_MICROPHONE_VALUE}>No microphone</SelectItem>
            {microphones.map((microphone) => {
              const assignedElsewhere = (holdersByMicrophone.get(microphone.id) || [])
                .filter((holder) => holder.slotKey !== slotKey)
                .map((holder) => holder.label);
              return (
                <SelectItem
                  key={microphone.id}
                  value={microphone.id}
                  textValue={microphone.name}
                >
                  <span className="inline-flex min-w-0 flex-1 items-center gap-2">
                    <ServicePlanMicrophoneIcon
                      microphone={microphone}
                      color={microphone.color}
                      className="size-4 shrink-0"
                    />
                    <span className="truncate">{microphone.name}</span>
                    {assignedElsewhere.length ? (
                      <span className="ml-auto shrink-0 text-[10px] font-normal text-amber-300">
                        Assigned: {assignedElsewhere.join(", ")}
                      </span>
                    ) : null}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </RadixSelect>
      ) : selectedMicrophone ? (
        <ServicePlanMicrophoneChip microphone={selectedMicrophone} />
      ) : (
        <p className="text-[11px] text-gray-500">No microphone assigned</p>
      )}
      {sharedWith.length ? (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-300">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
          Shared with {sharedWith.join(", ")}
        </p>
      ) : null}
    </div>
  );
};

export default ScheduleMicrophoneSelect;
