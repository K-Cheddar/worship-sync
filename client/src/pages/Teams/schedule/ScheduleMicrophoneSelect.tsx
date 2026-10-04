import { TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { ServicePlanMicrophoneChip } from "../../../components/ServicePlanMicrophoneChip";
import { ServicePlanMicrophoneIcon } from "../../../components/ServicePlanMicrophoneIcon";
import { ServiceEquipmentChip } from "../../../components/ServiceEquipmentChip";
import { ServiceEquipmentIcon, getServiceEquipmentSubtypeLabel } from "../../../components/ServiceEquipmentIcon";
import {
  Select as RadixSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import type { ServiceEquipment, ServicePlanMicrophone } from "../../../types/servicePlan";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";

/** Radix reserves an empty string for clearing the current selection. */
const NONE_MICROPHONE_VALUE = "__none__";
const NO_IEM_VALUE = "__none_iem__";

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
  iemIds?: string[];
  iems?: ServiceEquipment[];
  iemHoldersByIem?: ReadonlyMap<string, ScheduleMicrophoneHolder[]>;
  savingIem?: boolean;
  onIemChange?: (iemIds: string[]) => void;
  iemLoading?: boolean;
  iemUnavailable?: boolean;
  showMicrophones?: boolean;
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
  iemIds = [],
  iems = [],
  iemHoldersByIem = new Map(),
  savingIem = false,
  onIemChange,
  iemLoading = false,
  iemUnavailable = false,
  showMicrophones = true,
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
  const selectedIem = iems.find((iem) => iem.id === iemIds[0]);
  const sharedIemWith = selectedIem
    ? (iemHoldersByIem.get(selectedIem.id) || []).filter((holder) => holder.slotKey !== slotKey).map((holder) => holder.label)
    : [];
  const sharedWith = selectedId
    ? (holdersByMicrophone.get(selectedId) || [])
      .filter((holder) => holder.slotKey !== slotKey)
      .map((holder) => holder.label)
    : [];

  if (showMicrophones && loading && !iems.length) {
    return <p className="text-[11px] text-gray-500">Loading microphones…</p>;
  }
  if (showMicrophones && unavailable && !iems.length) {
    return <p className="text-[11px] text-amber-300">Microphones unavailable.</p>;
  }
  if (showMicrophones && microphones.length === 0 && !iems.length && !onIemChange) {
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
    <div className="space-y-1.5">
      {showMicrophones ? <div>
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
            className="h-8 w-full justify-between border-gray-700 bg-gray-950/60 px-2 text-left text-[11px] text-gray-100 max-md:text-sm"
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
      </div> : null}
      {onIemChange ? (
        <div>
          {iemLoading ? <p className="text-[11px] text-gray-500">Loading IEMs…</p> : iemUnavailable ? <p className="text-[11px] text-amber-300">IEMs unavailable.</p> : iems.length === 0 ? <p className="text-[11px] text-gray-500">No IEMs configured.</p> : canEdit ? (
            <RadixSelect
              value={selectedIem?.id || NO_IEM_VALUE}
              disabled={savingIem}
              onValueChange={(next) => onIemChange(next === NO_IEM_VALUE ? [] : [next])}
            >
              <SelectTrigger size="sm" aria-label={`${ariaLabel} IEM`} className="h-8 w-full justify-between border-cyan-900/70 bg-gray-950/60 px-2 text-left text-[11px] text-gray-100 max-md:text-sm">
                <SelectValue placeholder="No IEM">{selectedIem ? <span className="inline-flex min-w-0 items-center gap-2"><ServiceEquipmentIcon equipment={selectedIem} color={selectedIem.color} className="size-4 shrink-0" /><span className="truncate">{selectedIem.name}</span></span> : "No IEM"}</SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-[14rem]">
                <SelectItem value={NO_IEM_VALUE}>No IEM</SelectItem>
                {iems.map((iem) => (
                  <SelectItem key={iem.id} value={iem.id} textValue={iem.name}>
                    <span className="inline-flex min-w-0 flex-1 items-center gap-2">
                      <ServiceEquipmentIcon equipment={iem} color={iem.color} className="size-4 shrink-0" />
                      <span className="truncate">{iem.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-gray-400">{getServiceEquipmentSubtypeLabel(iem.subtype)}</span>
                      {iemHoldersByIem.get(iem.id)?.filter((holder) => holder.slotKey !== slotKey).length ? (
                        <span className="ml-auto shrink-0 text-[10px] text-amber-300">Assigned elsewhere</span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </RadixSelect>
          ) : selectedIem ? <ServiceEquipmentChip equipment={selectedIem} className="text-[11px]" /> : <p className="text-[11px] text-gray-300">IEM: None</p>}
          {sharedIemWith.length ? <p className="mt-1 text-[11px] text-amber-300">IEM conflict: shared with {sharedIemWith.join(", ")}</p> : null}
        </div>
      ) : null}
    </div>
  );
};

export default ScheduleMicrophoneSelect;
