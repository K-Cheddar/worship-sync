import { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, FileText, Music } from "lucide-react";
import { getServicePlanMicrophones } from "../../api/auth";
import { ServicePlanMicrophoneChip } from "../../components/ServicePlanMicrophoneChip";
import ServiceFlowRichText from "../../components/ServiceFlowRichText/ServiceFlowRichText";
import { formatServicePlanDuration } from "../Services/servicePlanDuration";
import { getServicePlanResourceTypeLabel } from "../Services/servicePlanResources";
import {
  getServicePlanResourceRichNotes,
  getServicePlanResourceText,
} from "../Services/servicePlanResources";
import { isRichTextEmpty } from "../../types/richText";
import {
  getServicePlanElementAssignees,
  getServicePlanElementContentResources,
  getServicePlanRoleNotePositionIds,
  type ServicePlan,
  type ServicePlanMicrophone,
  type ServicePlanMicrophoneAudience,
  type ServicePlanTeamNote,
} from "../../types/servicePlan";
import {
  getServicePlanRoleNoteRoleName,
  getServicePlanRoleNoteTeamNames,
  roleNoteMatchesServicePlanTeam,
} from "../Services/servicePlanRoleNoteTeam";
import { richTextToPlainText } from "../../types/richText";

type RoleOption = { positionId: string; label: string; teamName: string };
type Preference = { teamName: string; positionIds: string[] };

const readPreference = (key: string): Preference => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "null");
    if (value && typeof value === "object") {
      const candidate = value as Partial<Preference>;
      return {
        teamName: typeof candidate.teamName === "string" ? candidate.teamName : "",
        positionIds: Array.isArray(candidate.positionIds)
          ? candidate.positionIds.filter((id): id is string => typeof id === "string")
          : [],
      };
    }
  } catch {
    // An unavailable or stale local preference falls back to an unfiltered view.
  }
  return { teamName: "", positionIds: [] };
};

const roleOptionsFor = (plan: ServicePlan, audiences: ServicePlanMicrophoneAudience[]): RoleOption[] => {
  const options = new Map<string, RoleOption>();
  audiences.forEach((audience) => {
    const positionId = String(audience.positionId || "").trim();
    if (positionId) options.set(positionId, {
      positionId,
      label: audience.roleName,
      teamName: audience.teamName || "Other roles",
    });
  });
  plan.sections.forEach((section) => section.elements.forEach((element) => {
    (element.teamNotes || []).filter((note) => note.scope === "role").forEach((note) => {
      getServicePlanRoleNotePositionIds(note).forEach((positionId) => {
        if (!options.has(positionId)) options.set(positionId, {
          positionId,
          label: getServicePlanRoleNoteRoleName(note.label),
          teamName: getServicePlanRoleNoteTeamNames(note)[0] || "Other roles",
        });
      });
    });
  }));
  return [...options.values()].sort((a, b) => a.teamName.localeCompare(b.teamName) || a.label.localeCompare(b.label));
};

const visibleNotes = (notes: ServicePlanTeamNote[], preference: Preference, roles: RoleOption[]) => {
  const selectedRoleTeamNames = roles
    .filter((role) => preference.positionIds.includes(role.positionId))
    .map((role) => role.teamName);
  const audienceTeams = preference.teamName ? [preference.teamName] : selectedRoleTeamNames;
  return notes.filter((note) => note.scope === "role"
    ? roleNoteMatchesServicePlanTeam(note, preference.teamName)
      && (!preference.positionIds.length || getServicePlanRoleNotePositionIds(note).some((id) => preference.positionIds.includes(id)))
    : !audienceTeams.length || audienceTeams.includes(note.label));
};

const ControllerServicePlanView = ({
  plan,
  churchId,
  controllerProfileId,
  activeItemId,
}: {
  plan: ServicePlan;
  churchId: string;
  controllerProfileId: string;
  activeItemId?: string;
}) => {
  const preferenceKey = `worship-sync:service-plan-operator:${churchId}:${controllerProfileId}`;
  const [preference, setPreference] = useState(() => readPreference(preferenceKey));
  const [microphones, setMicrophones] = useState<ServicePlanMicrophone[]>([]);
  const [audiences, setAudiences] = useState<ServicePlanMicrophoneAudience[]>([]);
  useEffect(() => {
    let active = true;
    void getServicePlanMicrophones(churchId)
      .then((result) => {
        if (!active) return;
        setMicrophones(result.microphones || []);
        setAudiences(result.audiences || []);
      })
      .catch(() => {
        if (active) {
          setMicrophones([]);
          setAudiences([]);
        }
      });
    return () => { active = false; };
  }, [churchId]);

  const roles = useMemo(() => roleOptionsFor(plan, audiences), [audiences, plan]);
  const teams = useMemo(() => [...new Set([
    ...plan.sections.flatMap((section) => section.elements.flatMap((element) =>
      (element.teamNotes || []).filter((note) => note.scope !== "role").map((note) => note.label),
    )),
    ...roles.map((role) => role.teamName),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b)), [plan, roles]);
  const effectivePreference = {
    teamName: teams.includes(preference.teamName) ? preference.teamName : "",
    positionIds: preference.positionIds.filter((id) => roles.some((role) =>
      role.positionId === id && (!preference.teamName || role.teamName === preference.teamName),
    )),
  };
  const visibleRoles = roles.filter((role) => !effectivePreference.teamName || role.teamName === effectivePreference.teamName);
  const microphoneById = useMemo(() => new Map(microphones.map((microphone) => [microphone.id, microphone])), [microphones]);

  const updatePreference = (next: Preference) => {
    setPreference(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch { /* local preference is optional */ }
  };

  const getVisibleMicrophones = (microphoneIds: string[], element: ServicePlan["sections"][number]["elements"][number]) => microphoneIds.flatMap((id) => {
    const microphone = microphoneById.get(id);
    if (!microphone) return [];
    const legacyAssignment = element.microphoneAssignments?.find((assignment) => assignment.microphoneId === id);
    if (legacyAssignment) {
      const assignmentAudiences = legacyAssignment.audiences || [];
      if (assignmentAudiences.length) {
        const isVisible = assignmentAudiences.some((audience) =>
          (!effectivePreference.teamName || audience.teamName === effectivePreference.teamName)
          && (!effectivePreference.positionIds.length || effectivePreference.positionIds.includes(audience.positionId)),
        );
        if (!isVisible) return [];
      }
    }
    // Modern assignee-held microphones have no role association in the saved
    // plan shape. Keep the cue visible with an explicit label instead of
    // silently hiding every assignment under a team/role filter.
    return [microphone];
  });
  const hasUnscopedMicrophoneAssignment = (
    microphoneIds: string[],
    element: ServicePlan["sections"][number]["elements"][number],
  ) => microphoneIds.some((id) => {
    const legacyAssignment = element.microphoneAssignments?.find((assignment) => assignment.microphoneId === id);
    return !legacyAssignment?.audiences?.length;
  });

  return (
    <div className="flex flex-col gap-2 pr-1" aria-label="Selected service plan running order">
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-700 bg-zinc-950/50 p-2">
        <label className="flex min-w-36 flex-1 flex-col gap-1 text-[11px] text-zinc-400">
          Notes for team
          <select
            aria-label="Filter service plan notes by team"
            value={effectivePreference.teamName}
            onChange={(event) => updatePreference({ ...effectivePreference, teamName: event.target.value })}
            className="h-8 rounded border border-zinc-600 bg-zinc-900 px-2 text-xs text-white"
          >
            <option value="">All teams</option>
            {teams.map((team) => <option key={team} value={team}>{team}</option>)}
          </select>
        </label>
        <fieldset className="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-1 text-[11px] text-zinc-300">
          <legend className="mb-1 w-full text-zinc-400">Roles</legend>
          {visibleRoles.map((role) => (
            <label key={role.positionId} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={effectivePreference.positionIds.includes(role.positionId)}
                onChange={(event) => updatePreference({
                  ...effectivePreference,
                  positionIds: event.target.checked
                    ? [...effectivePreference.positionIds, role.positionId]
                    : effectivePreference.positionIds.filter((id) => id !== role.positionId),
                })}
              />
              {role.label}
            </label>
          ))}
          {visibleRoles.length === 0 ? <span>No roles available</span> : null}
        </fieldset>
      </div>

      {plan.sections.map((section) => (
        <section key={section.id} className="overflow-hidden rounded-lg border border-zinc-700/80 border-l-2 bg-zinc-950/40">
          {section.name ? <h3 className="border-b border-zinc-700/80 bg-zinc-950/80 px-2.5 py-1.5 text-xs font-semibold text-orange-300">{section.name}</h3> : null}
          <ol className="divide-y divide-zinc-700">
            {section.elements.map((element) => {
              const title = richTextToPlainText(element.title).trim() || "Untitled item";
              const assignees = getServicePlanElementAssignees(element).filter((assignee) => assignee.name?.trim());
              const notes = visibleNotes(element.teamNotes || [], effectivePreference, roles);
              const isLive = activeItemId === element.id;
              return (
                <li key={element.id} className={`flex flex-col gap-1.5 px-2.5 py-2 ${isLive ? "border-l-2 border-emerald-400 bg-emerald-500/10" : ""}`}>
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-zinc-400">
                    {element.startTime ? <time>{element.startTime}</time> : null}
                    {(element.durationSeconds ?? 0) > 0 || (element.durationMinutes ?? 0) > 0
                      ? <span>{formatServicePlanDuration({ durationSeconds: element.durationSeconds, durationMinutes: element.durationMinutes })}</span>
                      : null}
                    {isLive ? <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 font-semibold uppercase text-emerald-200">Live</span> : null}
                  </div>
                  <h4 className="text-xs font-semibold text-zinc-100">{title}</h4>
                  {assignees.length ? <p className="text-xs text-cyan-200">{assignees.map((assignee) => assignee.name).join(", ")}</p> : null}
                  {element.notes ? <ServiceFlowRichText document={element.notes} className="text-xs text-zinc-200" /> : null}
                  {notes.map((note) => (
                    <div key={note.id} className="border-l border-amber-500/50 pl-2 text-xs text-amber-100">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase text-amber-300">{note.label}{note.scope === "role" ? " role" : ""} notes</p>
                      <ServiceFlowRichText document={note.note} />
                    </div>
                  ))}
                  {assignees.map((assignee) => {
                    const assignedMicrophones = getVisibleMicrophones(assignee.microphoneIds || [], element);
                    return assignedMicrophones.length ? (
                      <div key={`${element.id}:${assignee.id}`} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-semibold uppercase text-zinc-500">Microphones</span>
                        {assignedMicrophones.map((microphone) => <ServicePlanMicrophoneChip key={microphone.id} microphone={microphone} details={[assignee.name || ""]} className="gap-1 rounded-full px-2 py-0.5 text-[11px]" />)}
                        {(effectivePreference.teamName || effectivePreference.positionIds.length) && hasUnscopedMicrophoneAssignment(assignee.microphoneIds || [], element) ? <span className="text-[10px] text-zinc-500">Role not specified</span> : null}
                      </div>
                    ) : null;
                  })}
                  {getServicePlanElementContentResources(element).length ? (
                    <ul className="flex flex-col gap-1 border-l border-indigo-500/40 pl-2 text-xs text-indigo-100">
                      {getServicePlanElementContentResources(element).map((resource) => {
                        const isWebLink = /^https?:\/\//i.test(resource.url || "");
                        const resourceNotes = resource.type === "text"
                          ? getServicePlanResourceText(resource)
                          : resource.type === "generic"
                            ? getServicePlanResourceRichNotes(resource)
                            : null;
                        const icon = resource.type === "song" ? <Music size={12} aria-hidden /> : resource.type === "scripture" ? <BookOpen size={12} aria-hidden /> : <FileText size={12} aria-hidden />;
                        return <li key={resource.id} className="flex min-w-0 flex-col gap-1"><div className="flex min-w-0 items-center gap-1.5">{icon}<span className="text-zinc-500">{getServicePlanResourceTypeLabel(resource.type)}:</span>{isWebLink ? <a className="min-w-0 truncate underline" href={resource.url} target="_blank" rel="noreferrer">{resource.title}<ExternalLink className="ml-1 inline size-3" aria-hidden /></a> : <span className="min-w-0 truncate">{resource.title}</span>}</div>{resourceNotes && !isRichTextEmpty(resourceNotes) ? <ServiceFlowRichText document={resourceNotes} className="pl-5 text-xs" /> : null}</li>;
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {plan.sections.every((section) => section.elements.length === 0) ? <p className="text-xs text-zinc-400">This service plan has no items.</p> : null}
    </div>
  );
};

export default ControllerServicePlanView;
