import { useEffect, useRef, useState } from "react";
import Button from "../components/Button/Button";
import Select from "../components/Select/Select";
import { useToast } from "../context/toastContext";
import { showApiErrorToast } from "../utils/apiErrorToast";
import type { MyScheduleOperations, VolunteerAvailabilityRequest } from "./myScheduleOperations";

const AvailabilityRequest = ({ request, operations, onSaved }: {
  request: VolunteerAvailabilityRequest; operations: MyScheduleOperations; onSaved: () => void;
}) => {
  const { showToast } = useToast();
  const [draft, setDraft] = useState(request.availability);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const save = async () => {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try {
      await operations.submitAvailability(request.recipientId, draft);
      if (active.current) { showToast("Availability saved.", "success"); onSaved(); }
    } catch (error) {
      if (active.current) showApiErrorToast(showToast, error, "Could not save your availability.");
    } finally { busy.current = false; if (active.current) setSaving(false); }
  };
  return <div className="flex flex-col gap-3 border-t border-gray-700 py-3">
    <h3 className="font-medium">{request.name}</h3>
    {request.availabilityMessage ? <p className="text-sm text-gray-300">{request.availabilityMessage}</p> : null}
    {request.occurrences.map((item) => <Select key={item.occurrenceId}
      label={`${item.name} · ${item.startsAt.slice(0, 10)}`}
      value={draft[item.occurrenceId] || ""}
      options={[{ value: "", label: "Not answered" }, { value: "available", label: "Available" }, { value: "unavailable", label: "Unavailable" }]}
      onChange={(value) => setDraft((current) => {
        const next = { ...current };
        if (value === "available" || value === "unavailable") next[item.occurrenceId] = value;
        else delete next[item.occurrenceId];
        return next;
      })} />)}
    <Button variant="secondary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save availability"}</Button>
  </div>;
};

const MyScheduleAvailability = ({ operations }: { operations: MyScheduleOperations }) => {
  const [requests, setRequests] = useState<VolunteerAvailabilityRequest[]>([]);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    void operations.availability().then((result) => {
      if (active) setRequests(result.requests);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [operations, refresh]);
  if (error) return <div className="flex items-center gap-3 text-sm text-gray-300">
    Could not load your availability requests.
    <Button variant="secondary" onClick={() => setRefresh((value) => value + 1)}>Retry</Button>
  </div>;
  if (!requests.length) return null;
  return <details className="rounded-lg border border-gray-700 p-3">
    <summary className="cursor-pointer font-medium">Availability requests ({requests.length})</summary>
    {requests.map((request) => <AvailabilityRequest key={`${request.recipientId}:${request.respondedAt}`}
      request={request} operations={operations} onSaved={() => setRefresh((value) => value + 1)} />)}
  </details>;
};
export default MyScheduleAvailability;
