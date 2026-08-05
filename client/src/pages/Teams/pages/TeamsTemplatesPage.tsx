import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Copy, LayoutTemplate, Plus } from "lucide-react";
import Button from "../../../components/Button/Button";
import Icon from "../../../components/Icon/Icon";
import Input from "../../../components/Input/Input";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  listServicePlanTemplates,
  saveServicePlanTemplate,
} from "../../../api/auth";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { cloneSectionsForTemplate } from "../../Services/servicePlanDraftUtils";
import ServicePlanTemplateEditor, {
  countServicePlanTemplateItems,
  createServicePlanTemplateDraft,
  type ServicePlanTemplateDraft,
} from "../../Services/ServicePlanTemplateEditor";
import {
  isServicePlanTemplateRemovedEvent,
  isServicePlanTemplateUpdatedEvent,
  useTeamsLiveSync,
} from "../hooks/useTeamsLiveSync";
import { useTeamsPage } from "../TeamsPageContext";
import { TeamsTemplatesListSkeleton } from "../teamsPageSkeletons";
import {
  panelHeaderPaddingClassName,
  panelScrollPaddingClassName,
  panelShellClassName,
  teamsManagerPageRootClassName,
  teamsPanelMaxHeightClassName,
} from "../teamsStyles";
import { cn } from "@/utils/cnHelper";
import type { ServicePlanTemplate } from "../../../types/servicePlan";

const sortTemplatesByName = (templates: ServicePlanTemplate[]) =>
  [...templates].sort((left, right) =>
    (left.name || "").localeCompare(right.name || ""),
  );

/** "Copy of X", "Copy of X 2", … — never silently collides with a sibling. */
export const nextTemplateCopyName = (
  name: string,
  existingNames: string[],
) => {
  const taken = new Set(existingNames.map((value) => value.trim().toLowerCase()));
  const base = `Copy of ${name.trim() || "template"}`;
  if (!taken.has(base.toLowerCase())) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
};

/**
 * Manage the church's reusable order-of-service templates: build one from
 * scratch, edit or rename an existing one, duplicate it as a starting point,
 * or delete it.
 *
 * Templates are also created and applied from inside a dated plan (see
 * ServicePlanTemplateModal); this page is the home for the templates
 * themselves, and edits them with the same surface the plan editor uses.
 */
const TeamsTemplatesPage = () => {
  const { churchId, canEditServices, canEditTeams: canEditTeamsFromContext } =
    useContext(GlobalInfoContext) || {};
  const { pageData, canEditTeams } = useTeamsPage();
  const { showToast } = useToast();
  const canEdit = Boolean(
    canEditServices ?? canEditTeamsFromContext ?? canEditTeams,
  );

  const [templates, setTemplates] = useState<ServicePlanTemplate[]>([]);
  const [loading, setLoading] = useState(Boolean(churchId));
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ServicePlanTemplateDraft | null>(null);
  const [duplicatingId, setDuplicatingId] = useState("");

  const serviceNamesById = useMemo(
    () => new Map(pageData.services.map((service) => [service.serviceId, service.name])),
    [pageData.services],
  );

  useEffect(() => {
    if (!churchId) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listServicePlanTemplates(churchId)
      .then((res) => {
        if (!cancelled) setTemplates(sortTemplatesByName(res.templates));
      })
      .catch((error) => {
        if (!cancelled) {
          showApiErrorToast(showToast, error, "Could not load templates.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [churchId]);

  const upsertTemplate = useCallback((template: ServicePlanTemplate) => {
    setTemplates((current) =>
      sortTemplatesByName([
        ...current.filter((item) => item.templateId !== template.templateId),
        template,
      ]),
    );
  }, []);

  const removeTemplate = useCallback((templateId: string) => {
    setTemplates((current) =>
      current.filter((item) => item.templateId !== templateId),
    );
  }, []);

  // Keep the list current when another admin saves or deletes a template. The
  // open editor is deliberately left alone — replacing a draft mid-edit would
  // throw away the operator's own work.
  useTeamsLiveSync(churchId, (event) => {
    if (isServicePlanTemplateUpdatedEvent(event)) {
      upsertTemplate(event.template);
      return;
    }
    if (isServicePlanTemplateRemovedEvent(event)) {
      removeTemplate(event.templateId);
    }
  });

  const visibleTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter((template) => {
      const serviceName = template.serviceId
        ? serviceNamesById.get(template.serviceId) || ""
        : "";
      return (
        template.name.toLowerCase().includes(query)
        || serviceName.toLowerCase().includes(query)
      );
    });
  }, [search, serviceNamesById, templates]);

  const handleDuplicate = async (template: ServicePlanTemplate) => {
    if (!churchId || duplicatingId) return;
    setDuplicatingId(template.templateId);
    try {
      const res = await saveServicePlanTemplate(churchId, {
        name: nextTemplateCopyName(
          template.name,
          templates.map((item) => item.name),
        ),
        ...(template.serviceId ? { serviceId: template.serviceId } : {}),
        // Fresh ids, so editing the copy can never touch the original's rows.
        sections: cloneSectionsForTemplate(template.sections),
      });
      upsertTemplate(res.template);
      showToast(`Duplicated as "${res.template.name}".`, "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not duplicate this template.");
    } finally {
      setDuplicatingId("");
    }
  };

  if (editing && churchId) {
    return (
      <div className={teamsManagerPageRootClassName}>
        <ServicePlanTemplateEditor
          churchId={churchId}
          template={editing}
          // All of them, not just the active ones: the editor offers active
          // services as choices but still has to show a scope pointing at an
          // archived service rather than silently reading as "any service".
          services={pageData.services}
          positions={pageData.positions}
          teams={pageData.teams}
          canEdit={canEdit}
          onBack={() => setEditing(null)}
          // List only. The editor tracks the id and revision of what it is
          // writing against itself — handing the saved record back as a new
          // `template` prop would reset the draft mid-edit.
          onSaved={upsertTemplate}
          onDeleted={(templateId) => {
            removeTemplate(templateId);
            setEditing(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className={teamsManagerPageRootClassName}>
      <section
        className={cn(
          panelShellClassName,
          "flex flex-col",
          teamsPanelMaxHeightClassName,
        )}
      >
        <div className={cn("shrink-0", panelHeaderPaddingClassName)}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Icon svg={LayoutTemplate} size="md" className="text-orange-300" />
                Templates
              </h2>
              <p className="mt-1 text-sm text-gray-400">
                Reusable orders of service. Templates hold structure, timings,
                notes and microphones — songs, scripture and assignments stay
                with each dated plan.
              </p>
            </div>
            {canEdit ? (
              <Button
                type="button"
                svg={Plus}
                iconSize="sm"
                className="shrink-0"
                onClick={() => setEditing(createServicePlanTemplateDraft())}
              >
                New template
              </Button>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            "scrollbar-variable mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto",
            panelScrollPaddingClassName,
          )}
        >
          {templates.length > 0 ? (
            <Input
              label="Search templates"
              hideLabel
              placeholder="Search templates"
              className="w-full max-w-sm"
              value={search}
              onChange={(value) => setSearch(String(value))}
            />
          ) : null}

          {loading ? <TeamsTemplatesListSkeleton /> : null}

          {!loading && templates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-700 bg-black/20 px-4 py-8 text-center">
              <p className="text-sm font-medium text-gray-200">
                No templates yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-gray-400">
                {canEdit
                  ? "Build one here, or open a plan you like and use “Save as template”."
                  : "An editor can add templates for your team to reuse."}
              </p>
            </div>
          ) : null}

          {!loading && templates.length > 0 && visibleTemplates.length === 0 ? (
            <p className="text-sm text-gray-400">
              No templates match that search. Try another term.
            </p>
          ) : null}

          {visibleTemplates.map((template) => {
            const displayName = template.name || "Untitled template";
            const serviceName = template.serviceId
              ? serviceNamesById.get(template.serviceId)
              : undefined;
            const itemCount = countServicePlanTemplateItems(template.sections);
            const openTemplate = () =>
              setEditing({
                templateId: template.templateId,
                name: template.name,
                serviceId: template.serviceId,
                sections: template.sections,
                revision: template.revision,
              });
            return (
              <div
                key={template.templateId}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3 transition-colors sm:flex-row sm:items-start sm:justify-between",
                  "cursor-pointer hover:border-gray-600/80 hover:bg-gray-900/60",
                )}
              >
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 cursor-pointer rounded-md text-left",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400",
                  )}
                  aria-label={canEdit ? `Edit ${displayName}` : `View ${displayName}`}
                  onClick={openTemplate}
                >
                  <p className="truncate text-sm font-semibold text-gray-100">
                    {displayName}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md border border-gray-700 bg-gray-900/70 px-1.5 py-0.5 text-[11px] font-medium text-gray-300">
                      {template.sections.length === 1
                        ? "1 section"
                        : `${template.sections.length} sections`}
                      {" · "}
                      {itemCount === 1 ? "1 item" : `${itemCount} items`}
                    </span>
                    <span
                      className={cn(
                        "rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                        serviceName
                          ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-100"
                          : "border-gray-700 bg-gray-900/70 text-gray-400",
                      )}
                    >
                      {serviceName ? `Preferred for ${serviceName}` : "Any service"}
                    </span>
                  </div>
                </button>
                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-1 self-start">
                    <Button
                      type="button"
                      variant="secondary"
                      svg={Copy}
                      iconSize="sm"
                      className="max-md:min-h-0"
                      aria-label={`Duplicate ${template.name}`}
                      disabled={Boolean(duplicatingId)}
                      isLoading={duplicatingId === template.templateId}
                      onClick={() => void handleDuplicate(template)}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default TeamsTemplatesPage;
