import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import ContentPreviewDialog from "../../components/ContentPreview/ContentPreviewDialog";
import type { ContentPreviewResource } from "../../components/ContentPreview/contentPreview";
import Select from "../../components/Select/Select";
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
import {
  getServicePlanElementAssigneeNames,
  type ServicePlan,
} from "../../types/servicePlan";
import { formatServicePlanDuration } from "../Services/servicePlanDuration";
import { getServicePlanLiveProgress } from "../Services/servicePlanLive";
import {
  getServicePlanResourceDefinition,
} from "../Services/servicePlanResources";
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

const ControllerResources = ({ resources }: { resources: PublicServiceFlowResource[] }) => {
  const [previewResource, setPreviewResource] = useState<ContentPreviewResource | null>(null);
  if (!resources.length) return null;

  return (
    <>
      <div className="flex min-w-0 flex-wrap gap-1" aria-label="Resources">
        {resources.map((resource, index) => {
          const definition = getServicePlanResourceDefinition(resource.type);
          const ResourceIcon = definition.icon;
          const canPreview = Boolean(resource.url || resource.detail || resource.richTextContent);
          const label = resource.title?.trim() || definition.label;
          const content = (
            <>
              <ResourceIcon className={`size-3.5 shrink-0 ${definition.toneClassName}`} aria-hidden />
              <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">{label}</span>
              {canPreview ? <Eye className="size-3 shrink-0 opacity-70" aria-hidden /> : null}
            </>
          );
          const chipClassName = "inline-flex min-w-0 max-w-full items-center gap-1 whitespace-normal rounded-full border border-neutral-700 bg-neutral-900/80 px-2 py-0.5 text-left text-xs leading-5 text-neutral-300 hover:border-cyan-500/70 hover:bg-neutral-800";
          return canPreview ? (
            <div key={`${resource.type}:${label}:${index}`} className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <button
                type="button"
                title={label}
                aria-label={`View ${definition.label}: ${label}`}
                className={`${chipClassName} cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400`}
                onClick={() => setPreviewResource({
                  id: `${resource.type}:${label}:${index}`,
                  type: resource.type,
                  title: label,
                  ...(resource.url ? { url: resource.url } : {}),
                  ...(resource.detail ? { textContent: resource.detail } : {}),
                  ...(resource.richTextContent ? { richTextContent: resource.richTextContent } : {}),
                })}
              >
                {content}
              </button>
            </div>
          ) : (
            <span
              key={`${resource.type}:${label}:${index}`}
              title={`${definition.label}: ${label}`}
              className={chipClassName}
            >
              {content}
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
  sectionLabelColor,
  sectionBorderColor,
}: {
  plan: ServicePlan;
  snapshot?: PublicServiceFlowSnapshot | null;
  churchId: string;
  controllerProfileId: string;
  sectionLabelColor: string;
  sectionBorderColor: string;
}) => {
  const preferenceKey = `worship-sync:service-plan-operator:${churchId}:${controllerProfileId}`;
  const [preference, setPreference] = useState(() => readPreference(preferenceKey));
  const [clientNow, setClientNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setClientNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const fallbackSnapshot = useMemo(
    () => buildServicePlanFlowSnapshot({
      plan,
      startsAt: plan.startsAt || `${plan.date}T00:00:00.000Z`,
    }),
    [plan],
  );
  const serviceSnapshot = snapshot || fallbackSnapshot;
  const serverOffsetMs = useMemo(
    () => snapshot ? snapshot.serverNowMs - Date.now() : 0,
    [snapshot],
  );
  const currentItemId = getServicePlanLiveProgress({
    ...plan,
    startsAt: plan.startsAt || `${plan.date}T00:00:00.000Z`,
  }, clientNow + serverOffsetMs)?.current?.item.id ?? null;
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
    <div className="flex flex-col gap-2 pr-1" aria-label="Selected service plan running order">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950/50 p-1.5" aria-label="Service plan filters">
        <Select
          label="Team"
          labelLayout="inline"
          labelFontSize="text-[10px]"
          labelClassName="!p-0 !font-normal text-zinc-400"
          options={[
            { value: "", label: "All teams" },
            ...teams.map((team) => ({ value: team, label: team })),
          ]}
          value={effectivePreference.teamName}
          onChange={(teamName) => updatePreference({
            ...effectivePreference,
            teamName,
          })}
          className="min-w-0 gap-1"
          selectClassName="h-7 min-h-7 w-40 max-w-40 rounded border-zinc-700 bg-zinc-900 px-1.5 text-[11px] text-zinc-100 focus-visible:ring-1 focus-visible:ring-cyan-300"
          backgroundColor="bg-zinc-900"
          textColor="text-zinc-100"
          contentBackgroundColor="bg-zinc-900"
          contentTextColor="text-zinc-100"
        />
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
          className="!h-7 !min-h-0 !max-w-full !rounded !border !border-zinc-700 !bg-zinc-900 !px-1.5 !py-0 !text-[11px] !text-zinc-100 hover:!border-zinc-600 hover:!bg-zinc-800 focus-visible:!ring-1 focus-visible:!ring-cyan-300"
        />
      </div>

      {serviceSnapshot.service.sections.map((section) => (
        <section
          key={section.id}
          aria-label={`Service plan section: ${section.title || "Untitled"}`}
          className="min-w-0 overflow-hidden rounded-lg border border-zinc-700/80 border-l-2 bg-zinc-950/40"
          style={{ borderLeftColor: sectionBorderColor }}
        >
          {section.title ? (
            <h3
              className="border-b border-zinc-700/80 bg-zinc-950/80 px-2.5 py-1.5 text-xs font-semibold"
              style={{ color: sectionLabelColor }}
            >
              {section.title}
            </h3>
          ) : null}
          <ol className="divide-y divide-zinc-700">
            {section.items.map((item) => {
              const planItem = planItemsById.get(item.id);
              const isLive = currentItemId === item.id;
              const leadName = item.creditName?.trim() || (
                planItem ? getServicePlanElementAssigneeNames(planItem).join(", ") : ""
              );
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
                  className={`flex min-w-0 flex-col gap-1.5 border-l-2 px-2.5 py-2 ${isLive ? "border-emerald-400 bg-emerald-500/[0.07]" : "border-transparent"}`}
                  aria-current={isLive ? "true" : undefined}
                >
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] text-zinc-400">
                    {planItem?.startTime ? <time className="shrink-0">{planItem.startTime}</time> : null}
                    {duration ? <span className="shrink-0">{duration}</span> : null}
                    <h4 className="min-w-0 flex-1 break-words whitespace-normal text-xs font-semibold text-zinc-100">{item.title}</h4>
                    {isLive ? <span className="shrink-0 rounded bg-emerald-400/15 px-1.5 py-0.5 font-semibold uppercase text-emerald-200">Live</span> : null}
                  </div>
                  {leadName ? <p className="break-words whitespace-normal text-xs font-normal text-white"><span className="text-zinc-400">Led by:</span> {leadName}</p> : null}

                  {item.resources?.length ? (
                    <ControllerResources resources={item.resources} />
                  ) : null}

                  {item.notes.blocks.length || notes.length ? (
                    <details className="min-w-0 text-xs leading-4 text-zinc-300">
                      <summary className="w-fit cursor-pointer select-none text-amber-300/90 hover:text-amber-200">
                        View notes{notes.length ? ` (${notes.length + (item.notes.blocks.length ? 1 : 0)})` : ""}
                      </summary>
                      <div className="mt-1 min-w-0 break-words space-y-1 overflow-hidden border-l border-amber-500/40 pl-2 [&_*]:break-words">
                        {item.notes.blocks.length ? <ServiceFlowRichText document={item.notes} /> : null}
                        {notes.map((note, index) => (
                          <div key={`${note.label}:${index}`} className="min-w-0">
                            <span className="font-medium text-amber-200">{note.label}{note.scope === "role" ? " role" : ""} notes: </span>
                            <ServiceFlowRichText document={note.notes} />
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}

                  {microphones.length || equipment.length ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {microphones.length ? (
                        <span className="text-[10px] font-semibold uppercase text-zinc-500">Microphones</span>
                      ) : null}
                      {microphones.map((assignment) => (
                        <ServicePlanMicrophoneChip
                          key={`${assignment.microphone.id}:${assignment.holderName || ""}`}
                          microphone={assignment.microphone}
                          details={assignment.holderName ? [assignment.holderName] : []}
                          className="gap-1 rounded-full px-2 py-0.5 text-[11px]"
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
