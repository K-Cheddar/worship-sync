import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, FileText, Music } from "lucide-react";
import ContentPreviewDialog from "../../components/ContentPreview/ContentPreviewDialog";
import type { ContentPreviewResource } from "../../components/ContentPreview/contentPreview";
import { ServicePlanMicrophoneChip } from "../../components/ServicePlanMicrophoneChip";
import ServicePlanRolePicker from "../../components/ServicePlanRolePicker";
import ServiceFlowRichText from "../../components/ServiceFlowRichText/ServiceFlowRichText";
import {
  buildServiceFlowRoleOptions,
  buildServiceFlowTeamLabels,
  filterServiceFlowRoleOptions,
  selectedServiceFlowRoleTeamNames,
  visibleServiceFlowMicrophoneAssignmentsForItem,
  visibleServiceFlowNotesForItem,
  type ServiceFlowFilterPreference,
} from "../../services/serviceFlowAudience";
import type { PublicServiceFlowResource, PublicServiceFlowSnapshot } from "../../services/serviceFlowTypes";
import type { ServicePlan } from "../../types/servicePlan";
import { formatServicePlanDuration } from "../Services/servicePlanDuration";
import { getServicePlanResourceDefinition } from "../Services/servicePlanResources";
import { buildServicePlanFlowSnapshot } from "../buildServicePlanFlowSnapshot";

type ControllerServicePlanPreference = ServiceFlowFilterPreference;

const readPreference = (key: string): ControllerServicePlanPreference => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "null");
    if (value && typeof value === "object") {
      const candidate = value as Partial<ControllerServicePlanPreference>;
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

const writePreference = (key: string, preference: ControllerServicePlanPreference) => {
  try {
    localStorage.setItem(key, JSON.stringify(preference));
  } catch {
    // Local preference storage is optional; the controller remains usable.
  }
};

const resourceIcon = (type: string) => {
  if (type === "song") return Music;
  if (type === "scripture") return BookOpen;
  return FileText;
};

const ControllerResources = ({ resources }: { resources: PublicServiceFlowResource[] }) => {
  const [previewResource, setPreviewResource] = useState<ContentPreviewResource | null>(null);
  if (!resources.length) return null;

  return (
    <>
      <div className="flex min-w-0 flex-wrap gap-1" aria-label="Resources">
        {resources.map((resource, index) => {
          const Icon = resourceIcon(resource.type);
          const canPreview = Boolean(resource.url || resource.detail || resource.richTextContent);
          const label = resource.title || getServicePlanResourceDefinition(resource.type).label;
          return canPreview ? (
            <button
              key={`${resource.type}:${label}:${index}`}
              type="button"
              title={label}
              aria-label={`View resource: ${label}`}
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-indigo-400/25 bg-indigo-950/30 px-1.5 py-0.5 text-[10px] leading-4 text-indigo-100 hover:border-indigo-300/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-300"
              onClick={() => setPreviewResource({
                id: `${resource.type}:${label}:${index}`,
                type: resource.type,
                title: label,
                ...(resource.url ? { url: resource.url } : {}),
                ...(resource.detail ? { textContent: resource.detail } : {}),
                ...(resource.richTextContent ? { richTextContent: resource.richTextContent } : {}),
              })}
            >
              <Icon className="size-3 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{label}</span>
              <ExternalLink className="size-2.5 shrink-0 opacity-60" aria-hidden />
            </button>
          ) : (
            <span
              key={`${resource.type}:${label}:${index}`}
              title={label}
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-indigo-400/25 bg-indigo-950/30 px-1.5 py-0.5 text-[10px] leading-4 text-indigo-100"
            >
              <Icon className="size-3 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{label}</span>
            </span>
          );
        })}
      </div>
      <ContentPreviewDialog resource={previewResource} onClose={() => setPreviewResource(null)} />
    </>
  );
};

const ControllerServicePlanView = ({
  plan,
  snapshot,
  churchId,
  controllerProfileId,
  activeItemId,
}: {
  plan: ServicePlan;
  snapshot?: PublicServiceFlowSnapshot | null;
  churchId: string;
  controllerProfileId: string;
  activeItemId?: string;
}) => {
  const preferenceKey = `worship-sync:service-plan-operator:${churchId}:${controllerProfileId}`;
  const [preference, setPreference] = useState(() => readPreference(preferenceKey));
  const fallbackSnapshot = useMemo(
    () => buildServicePlanFlowSnapshot({
      plan,
      startsAt: plan.startsAt || `${plan.date}T00:00:00.000Z`,
    }),
    [plan],
  );
  const serviceSnapshot = snapshot || fallbackSnapshot;
  const currentItemId = activeItemId ?? (
    serviceSnapshot.service.live.mode === "schedule"
      ? undefined
      : serviceSnapshot.service.live.currentItemId
  );
  const teams = useMemo(() => buildServiceFlowTeamLabels(serviceSnapshot), [serviceSnapshot]);
  const allRoles = useMemo(() => buildServiceFlowRoleOptions(serviceSnapshot), [serviceSnapshot]);
  const effectivePreference = useMemo(() => {
    const teamName = teams.includes(preference.teamName) ? preference.teamName : "";
    const rolesForTeam = filterServiceFlowRoleOptions(allRoles, teamName);
    return {
      teamName,
      positionIds: preference.positionIds.filter((id) =>
        rolesForTeam.some((role) => role.positionId === id),
      ),
    };
  }, [allRoles, preference, teams]);
  const roleOptions = useMemo(
    () => filterServiceFlowRoleOptions(allRoles, effectivePreference.teamName),
    [allRoles, effectivePreference.teamName],
  );
  const selectedRoleTeamNames = useMemo(
    () => selectedServiceFlowRoleTeamNames(roleOptions, effectivePreference.positionIds),
    [effectivePreference.positionIds, roleOptions],
  );
  const updatePreference = useCallback((next: ControllerServicePlanPreference) => {
    setPreference(next);
    writePreference(preferenceKey, next);
  }, [preferenceKey]);
  useEffect(() => {
    if (
      preference.teamName !== effectivePreference.teamName ||
      preference.positionIds.length !== effectivePreference.positionIds.length
    ) updatePreference(effectivePreference);
  }, [effectivePreference, preference, updatePreference]);
  const planItemsById = useMemo(() => new Map(
    plan.sections.flatMap((section) => section.elements.map((item) => [item.id, item] as const)),
  ), [plan]);

  return (
    <div className="flex min-w-0 flex-col gap-1.5 pr-1" aria-label="Selected service plan running order">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Service plan filters">
        <label className="flex min-w-0 max-w-full items-center gap-1 text-[10px] text-zinc-400">
          <span className="shrink-0">Team</span>
          <select
            aria-label="Filter service plan by team"
            value={effectivePreference.teamName}
            onChange={(event) => updatePreference({
              ...effectivePreference,
              teamName: event.target.value,
            })}
            className="h-7 min-w-0 max-w-40 rounded border border-zinc-700 bg-zinc-900 px-1.5 text-[11px] text-zinc-100"
          >
            <option value="">All teams</option>
            {teams.map((team) => <option key={team} value={team}>{team}</option>)}
          </select>
        </label>
        <ServicePlanRolePicker
          multi
          value={effectivePreference.positionIds}
          onValueChange={(positionIds) => updatePreference({
            ...effectivePreference,
            positionIds,
          })}
          options={roleOptions}
          teamFilterStorageKey={`${preferenceKey}:role-team-filter`}
          lockedTeamName={effectivePreference.teamName || undefined}
          ariaLabel="Filter roles"
          label="Roles"
          placeholder="All roles"
          className="!h-7 !min-h-0 !px-1.5 !py-0 text-[11px]"
        />
      </div>

      {serviceSnapshot.service.sections.map((section) => (
        <section
          key={section.id}
          className="min-w-0 overflow-hidden rounded border border-zinc-700/80 border-l-2 bg-zinc-950/30"
        >
          {section.title ? (
            <h3 className="border-b border-zinc-700/70 bg-zinc-950/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-orange-300">
              {section.title}
            </h3>
          ) : null}
          <ol className="divide-y divide-zinc-800/90">
            {section.items.map((item) => {
              const planItem = planItemsById.get(item.id);
              const isLive = currentItemId === item.id;
              const notes = visibleServiceFlowNotesForItem(
                item,
                effectivePreference.teamName,
                effectivePreference.positionIds,
                selectedRoleTeamNames,
              );
              const microphones = visibleServiceFlowMicrophoneAssignmentsForItem(
                item,
                effectivePreference.teamName,
                effectivePreference.positionIds,
              );
              const hasAudienceSelection = Boolean(
                effectivePreference.teamName || effectivePreference.positionIds.length,
              );
              // The public snapshot carries IEM holder names, but no role or
              // team audience for them. Treat those cues like unscoped legacy
              // microphones and keep them out of a narrowed audience view.
              const equipment = hasAudienceSelection ? [] : item.equipmentAssignments || [];
              const duration = item.durationSeconds > 0
                ? formatServicePlanDuration({ durationSeconds: item.durationSeconds })
                : "";
              return (
                <li
                  key={item.id}
                  className={`min-w-0 border-l-2 px-2 py-1.5 ${isLive ? "border-emerald-400 bg-emerald-500/[0.07]" : "border-transparent"}`}
                  aria-current={isLive ? "true" : undefined}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[10px] leading-4 text-zinc-500">
                        {planItem?.startTime ? <time>{planItem.startTime}</time> : null}
                        {duration ? <span>{duration}</span> : null}
                        {isLive ? <span className="rounded bg-emerald-400/15 px-1 py-px font-semibold uppercase tracking-wide text-emerald-200">Live</span> : null}
                      </div>
                      <h4 className="break-words text-xs font-semibold leading-4 text-zinc-100">{item.title}</h4>
                      {item.creditName ? <p className="truncate text-[10px] leading-4 text-zinc-400">Led by {item.creditName}</p> : null}
                    </div>
                  </div>

                  {item.resources?.length ? <div className="mt-1"><ControllerResources resources={item.resources} /></div> : null}

                  {item.notes.blocks.length || notes.length ? (
                    <details className="mt-1 min-w-0 text-[10px] leading-4 text-zinc-300">
                      <summary className="w-fit cursor-pointer select-none text-amber-300/90 hover:text-amber-200">
                        View notes{notes.length ? ` (${notes.length + (item.notes.blocks.length ? 1 : 0)})` : ""}
                      </summary>
                      <div className="mt-1 space-y-1 border-l border-amber-500/40 pl-2">
                        {item.notes.blocks.length ? <ServiceFlowRichText document={item.notes} /> : null}
                        {notes.map((note, index) => (
                          <div key={`${note.label}:${index}`}>
                            <span className="font-medium text-amber-200">{note.label}{note.scope === "role" ? " role" : ""}: </span>
                            <ServiceFlowRichText document={note.notes} />
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}

                  {microphones.length || equipment.length ? (
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                      {microphones.map((assignment) => (
                        <ServicePlanMicrophoneChip
                          key={`${assignment.microphone.id}:${assignment.holderName || ""}`}
                          microphone={assignment.microphone}
                          details={assignment.holderName ? [assignment.holderName] : []}
                          className="gap-1 rounded-full px-1.5 py-0.5 text-[10px]"
                        />
                      ))}
                      {equipment.map((assignment) => (
                        <span
                          key={`${assignment.equipment.id}:${assignment.holderName || ""}`}
                          className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-cyan-800/70 bg-cyan-950/30 px-1.5 py-0.5 text-[10px] text-cyan-100"
                          title={`${assignment.equipment.name}${assignment.holderName ? ` · ${assignment.holderName}` : ""}`}
                        >
                          {assignment.equipment.name}{assignment.holderName ? ` · ${assignment.holderName}` : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {serviceSnapshot.service.sections.every((section) => section.items.length === 0) ? (
        <p className="text-xs text-zinc-400">This service plan has no items.</p>
      ) : null}
    </div>
  );
};

export default ControllerServicePlanView;
