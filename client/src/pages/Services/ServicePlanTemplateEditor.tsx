import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  LayoutTemplate,
  MoreHorizontal,
  Pencil,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import TimePicker from "../../components/TimePicker/TimePicker";
import DeleteModal from "../../components/Modal/DeleteModal";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { cn } from "@/utils/cnHelper";
import { useToast } from "../../context/toastContext";
import {
  deleteServicePlanTemplate,
  getServicePlanMicrophones,
  saveServicePlanTemplate,
  AuthApiError,
} from "../../api/auth";
import { showApiErrorToast } from "../../utils/apiErrorToast";
import ServicePlanSectionList from "./ServicePlanSectionList";
import {
  formatPlanStartTimeDisplay,
  type ServicePlanRoleNoteOption,
  type ServicePlanTeamNoteOption,
} from "./ServicePlanElementRow";
import {
  addElement,
  addSection,
  createEmptyServicePlanSections,
} from "./servicePlanDraftUtils";
import {
  collectServicePlanRoleNoteOptions,
  collectServicePlanTeamNoteOptions,
} from "./servicePlanNoteOptions";
import { applyPlanAnchorStartTime } from "./servicePlanTimingUtils";
import { isActive } from "../Teams/teamsUtils";
import { useServicePlanAutosave } from "./useServicePlanAutosave";
import {
  useServicePlanDraftHistory,
  type ServicePlanDraftSnapshot,
} from "./useServicePlanDraftHistory";
import type {
  TeamPosition,
  TeamRecord,
  TeamService,
} from "../../api/authTypes";
import type {
  ServicePlanMicrophone,
  ServicePlanMicrophoneAudience,
  ServicePlanSection,
  ServicePlanTemplate,
  ServicePlanTemplatePayload,
} from "../../types/servicePlan";

/** Sentinel for "offer this template for every service" in the scope picker. */
export const ANY_SERVICE_SCOPE_VALUE = "__any__";

/**
 * A template as this editor holds it: either one loaded from the server, or a
 * brand-new one that has never been saved (empty `templateId`).
 */
export type ServicePlanTemplateDraft = {
  templateId: string;
  name: string;
  serviceId?: string;
  sections: ServicePlanSection[];
  /** The revision autosave writes against; absent on an unsaved template. */
  revision?: number;
};

export const createServicePlanTemplateDraft = (
  serviceId?: string,
): ServicePlanTemplateDraft => ({
  templateId: "",
  name: "",
  ...(serviceId ? { serviceId } : {}),
  sections: createEmptyServicePlanSections(),
});

/** Counts for the header summary and the list rows. */
export const countServicePlanTemplateItems = (
  sections: ServicePlanSection[],
): number =>
  sections.reduce((total, section) => total + section.elements.length, 0);

/** Autosave's reset key for a template that has no server id yet. */
const NEW_TEMPLATE_RESET_KEY = "new-template";

type ServicePlanTemplateEditorProps = {
  churchId: string;
  /** The template being edited. A change of `templateId` reloads the draft. */
  template: ServicePlanTemplateDraft;
  /**
   * The church's services. Only the active ones are offered as a scope, but
   * the full list is needed so a template already pointing at an archived
   * service can still show what it points at.
   */
  services: TeamService[];
  /** Roles available for role-specific operational notes. */
  positions?: TeamPosition[];
  teams?: TeamRecord[];
  canEdit: boolean;
  onBack: () => void;
  backLabel?: string;
  /**
   * Called with the saved server record after every autosave. The caller must
   * not feed the result back in as a new `template` prop — this editor adopts
   * a newly created template's id itself, and a changed prop identity would
   * reset the draft out from under the operator.
   */
  onSaved: (template: ServicePlanTemplate) => void;
  onDeleted?: (templateId: string) => void;
};

/**
 * Build and edit a reusable order-of-service template, using the same section
 * and item surface as the dated-plan editor (ServicePlanSectionList).
 *
 * Templates carry structure — section and item names, timings, notes and the
 * microphone plan, all of which repeat week to week. Songs, scripture and
 * assignments belong to one dated service and are stripped in both directions
 * (see cloneSectionsForTemplate), so this editor does not offer them at all
 * rather than letting an operator enter work that gets silently dropped.
 *
 * Edits autosave, the same way the dated-plan editor's do and through the same
 * hook: complete-document writes serialized behind a server-side revision
 * check, so a second editor's concurrent save surfaces as a conflict to
 * reload rather than silently overwriting one side.
 *
 * A template with no name yet is the one state autosave holds back on — there
 * is no id until the first write, and creating a row the moment someone types
 * a character would litter the list with unnamed strays.
 */
const ServicePlanTemplateEditor = ({
  churchId,
  template,
  services,
  positions = [],
  teams = [],
  canEdit,
  onBack,
  backLabel = "Back to Templates",
  onSaved,
  onDeleted,
}: ServicePlanTemplateEditorProps) => {
  const { showToast } = useToast();
  const isNew = !template.templateId;

  const [name, setName] = useState(template.name);
  const [serviceId, setServiceId] = useState(template.serviceId || "");
  const [sections, setSections] = useState<ServicePlanSection[]>(
    template.sections,
  );
  // A new template opens ready to build; an existing one opens as a readable
  // outline, matching how the plan editor behaves.
  const [isEditing, setIsEditing] = useState(isNew && canEdit);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hideNotes, setHideNotes] = useState(false);
  const [microphones, setMicrophones] = useState<ServicePlanMicrophone[]>([]);
  const [microphoneAudiences, setMicrophoneAudiences] = useState<
    ServicePlanMicrophoneAudience[] | undefined
  >();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [draftChangeVersion, setDraftChangeVersion] = useState(0);
  const [conflictTemplate, setConflictTemplate] =
    useState<ServicePlanTemplate | null>(null);
  /**
   * The server id and revision this editor is writing against. A brand-new
   * template has neither until autosave's first write returns, so both are
   * held in refs the save closure reads rather than in the incoming prop.
   */
  const templateIdRef = useRef(template.templateId);
  // Render mirrors of what the server holds. The ref above is what the save
  // closure reads (a snapshot captured for the unmount flush must not see a
  // stale id); these drive the header and the delete action.
  const [savedTemplateId, setSavedTemplateId] = useState(template.templateId);
  const [savedName, setSavedName] = useState(template.name);

  const markDraftChanged = useCallback(() => {
    setDraftChangeVersion((version) => version + 1);
  }, []);

  const {
    canUndo,
    canRedo,
    record: recordDraftHistory,
    undo: undoDraft,
    redo: redoDraft,
    reset: resetDraftHistory,
  } = useServicePlanDraftHistory({
    // The snapshot shape is shared with the plan editor; a template's name
    // takes the `planName` slot and it carries no import provenance.
    draft: { sections, planName: name },
    onRestore: useCallback((snapshot: ServicePlanDraftSnapshot) => {
      setSections(snapshot.sections);
      setName(snapshot.planName);
    }, []),
  });

  // Switching to a different template replaces the whole draft, so history and
  // the autosave baseline have to go with it.
  useEffect(() => {
    setName(template.name);
    setSavedName(template.name);
    setServiceId(template.serviceId || "");
    setSections(template.sections);
    setIsEditing(!template.templateId && canEdit);
    setConflictTemplate(null);
    setDraftChangeVersion(0);
    templateIdRef.current = template.templateId;
    setSavedTemplateId(template.templateId);
    resetDraftHistory();
    // Only a change of identity should reset the draft — re-running on every
    // new `template` object would discard the operator's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.templateId]);

  // The church's microphones, so a template can carry its own mic plan. Same
  // best-effort load as the plan editor's: without them the Microphone option
  // simply doesn't appear, and the rest of the template still works.
  useEffect(() => {
    if (!churchId) return;
    let cancelled = false;
    getServicePlanMicrophones(churchId)
      .then((res) => {
        if (!cancelled) {
          setMicrophones(res.microphones);
          setMicrophoneAudiences(res.audiences);
        }
      })
      .catch(() => {
        // Optional operational metadata — see above.
      });
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  const updateDraft = useCallback(
    (
      changes: { sections?: ServicePlanSection[]; name?: string },
      coalesceKey?: string,
    ) => {
      recordDraftHistory(coalesceKey);
      if (changes.sections) setSections(changes.sections);
      if (changes.name !== undefined) setName(changes.name);
      markDraftChanged();
    },
    [markDraftChanged, recordDraftHistory],
  );

  const updateDraftSections = useCallback(
    (next: ServicePlanSection[], coalesceKey?: string) => {
      updateDraft({ sections: next }, coalesceKey);
    },
    [updateDraft],
  );

  const trimmedName = name.trim();

  const buildAutosavePayload = useCallback((): ServicePlanTemplatePayload | null => {
    const readyName = name.trim();
    if (!readyName) return null;
    return {
      name: readyName,
      ...(serviceId ? { serviceId } : {}),
      sections,
    };
  }, [name, sections, serviceId]);

  const saveAutosavePayload = useCallback(
    (payload: ServicePlanTemplatePayload, baseRevision: number) =>
      saveServicePlanTemplate(churchId, {
        ...payload,
        // Empty on the very first write; the id the server mints then becomes
        // the target for every later save of this same draft.
        ...(templateIdRef.current ? { templateId: templateIdRef.current } : {}),
        baseRevision,
      }).then((res) => res.template),
    [churchId],
  );

  const getConflictTemplate = useCallback((error: unknown) => {
    if (!(error instanceof AuthApiError) || error.status !== 409) return null;
    const details = error.details;
    if (!details || typeof details !== "object" || !("template" in details)) {
      return null;
    }
    const latest = details.template;
    return latest && typeof latest === "object"
      ? (latest as ServicePlanTemplate)
      : null;
  }, []);

  const autosave = useServicePlanAutosave<
    ServicePlanTemplate,
    ServicePlanTemplatePayload
  >({
    // A nameless template has nothing to create yet — see the component docs.
    enabled: Boolean(canEdit && churchId && trimmedName),
    resetKey: template.templateId || NEW_TEMPLATE_RESET_KEY,
    changeVersion: draftChangeVersion,
    baseRevision: template.revision || 0,
    buildPayload: buildAutosavePayload,
    save: saveAutosavePayload,
    getConflictPlan: getConflictTemplate,
    onSaved: (savedTemplate) => {
      templateIdRef.current = savedTemplate.templateId;
      setSavedTemplateId(savedTemplate.templateId);
      setSavedName(savedTemplate.name);
      onSaved(savedTemplate);
    },
    onConflict: setConflictTemplate,
  });

  useEffect(() => {
    if (autosave.state === "saved") return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [autosave.state]);

  /** Take the other editor's version as the new base and drop our draft. */
  const reloadConflictTemplate = () => {
    if (!conflictTemplate) return;
    setName(conflictTemplate.name);
    setSavedName(conflictTemplate.name);
    setServiceId(conflictTemplate.serviceId || "");
    setSections(conflictTemplate.sections);
    templateIdRef.current = conflictTemplate.templateId;
    setSavedTemplateId(conflictTemplate.templateId);
    setConflictTemplate(null);
    resetDraftHistory();
    autosave.acceptRemoteRevision(conflictTemplate);
  };

  // Undo/redo shortcuts, edit mode only — same contract as the plan editor:
  // fields that own their own undo (rich text, plain inputs) keep it.
  useEffect(() => {
    if (!canEdit || !isEditing) return;
    const handleUndoRedoKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.getAttribute?.("data-ignore-undo") === "true") return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) {
        redoDraft();
        return;
      }
      undoDraft();
    };
    document.addEventListener("keydown", handleUndoRedoKey);
    return () => document.removeEventListener("keydown", handleUndoRedoKey);
  }, [canEdit, isEditing, redoDraft, undoDraft]);

  /**
   * What this template actually points at, which is not always something the
   * church still runs. An archived (or deleted) service must keep its place in
   * the picker: drop it and the select falls back to its placeholder while the
   * saved `serviceId` quietly stays put, so the template goes on sorting first
   * for a service the operator has been told it no longer targets.
   */
  const scopedService = services.find(
    (service) => service.serviceId === serviceId,
  );
  const scopeIsRetired =
    Boolean(serviceId) && (!scopedService || !isActive(scopedService));
  const scopeLabel = scopedService
    ? isActive(scopedService)
      ? scopedService.name
      : `${scopedService.name} (archived)`
    : "Service no longer available";

  const serviceOptions = useMemo(
    () => [
      { label: "Any service", value: ANY_SERVICE_SCOPE_VALUE },
      // Only services the church still runs are offered as new choices.
      ...services.filter(isActive).map((service) => ({
        label: service.name,
        value: service.serviceId,
      })),
      ...(scopeIsRetired ? [{ label: scopeLabel, value: serviceId }] : []),
    ],
    [scopeIsRetired, scopeLabel, serviceId, services],
  );

  const roleNoteOptions = useMemo<ServicePlanRoleNoteOption[]>(
    () => collectServicePlanRoleNoteOptions(
      sections,
      positions,
      teams,
      microphoneAudiences,
    ),
    [microphoneAudiences, positions, sections, teams],
  );
  const teamNoteOptions = useMemo<ServicePlanTeamNoteOption[]>(
    () => collectServicePlanTeamNoteOptions(teams),
    [teams],
  );

  const anchorStartTime = sections[0]?.elements?.[0]?.startTime || "";
  const itemCount = countServicePlanTemplateItems(sections);

  const handleAddElement = (sectionId: string) => {
    updateDraftSections(addElement(sections, sectionId));
  };

  /** Scope is part of the saved document, so changing it is a draft edit. */
  const updateDraftServiceId = (next: string) => {
    setServiceId(next);
    markDraftChanged();
  };

  const handleDelete = async () => {
    const targetId = templateIdRef.current;
    if (!targetId) return;
    setDeleting(true);
    try {
      // Settle autosave first: a queued write flushed after the delete would
      // recreate the template the operator just removed.
      await autosave.flush();
      await deleteServicePlanTemplate(churchId, targetId);
      showToast(`Deleted "${savedName || template.name}".`, "success");
      setConfirmDelete(false);
      onDeleted?.(targetId);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not delete this template.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700/80 bg-gray-950/70">
      <header className="shrink-0 space-y-2 border-b border-gray-800 px-3 py-2">
        <Button
          type="button"
          variant="tertiary"
          svg={ArrowLeft}
          iconSize="sm"
          className="max-md:min-h-0"
          onClick={onBack}
        >
          {backLabel}
        </Button>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-gray-50 sm:text-lg">
              <LayoutTemplate
                className="size-5 shrink-0 text-cyan-400"
                aria-hidden
              />
              <span className="truncate">
                {trimmedName || (isNew ? "New template" : "Untitled template")}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-gray-400">
              {serviceId
                ? `Preferred for ${scopeLabel}`
                : "Available for any service"}
              {" · "}
              {sections.length === 1 ? "1 section" : `${sections.length} sections`}
              {" · "}
              {itemCount === 1 ? "1 item" : `${itemCount} items`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {canEdit && isEditing ? (
              <div
                className="flex shrink-0 items-center"
                role="group"
                aria-label="Undo and redo"
              >
                <Button
                  type="button"
                  variant="tertiary"
                  svg={Undo2}
                  iconSize="sm"
                  className="max-md:min-h-0"
                  aria-label="Undo"
                  disabled={!canUndo}
                  onClick={undoDraft}
                />
                <Button
                  type="button"
                  variant="tertiary"
                  svg={Redo2}
                  iconSize="sm"
                  className="max-md:min-h-0"
                  aria-label="Redo"
                  disabled={!canRedo}
                  onClick={redoDraft}
                />
              </div>
            ) : null}
            {canEdit ? (
              <Button
                type="button"
                variant={isEditing ? "secondary" : "primary"}
                svg={isEditing ? undefined : Pencil}
                iconSize="sm"
                className="max-md:min-h-0"
                onClick={() => setIsEditing((editing) => !editing)}
              >
                {isEditing ? "Done" : "Edit"}
              </Button>
            ) : null}
            <DropdownMenu open={actionsOpen} onOpenChange={setActionsOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  svg={MoreHorizontal}
                  iconSize="sm"
                  className="max-md:min-h-0"
                  aria-label="Template actions"
                  aria-haspopup="menu"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-gray-400">
                  Notes
                </DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={hideNotes}
                  onCheckedChange={(checked) => setHideNotes(Boolean(checked))}
                >
                  Hide notes
                </DropdownMenuCheckboxItem>
                {canEdit && savedTemplateId ? (
                  <>
                    <DropdownMenuSeparator className="my-1 bg-gray-600" />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setConfirmDelete(true)}
                    >
                      <Trash2 aria-hidden />
                      Delete template
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:gap-3 sm:p-3">
        <ServicePlanSectionList
          sections={sections}
          canEdit={canEdit}
          isEditing={isEditing}
          onSectionsChange={updateDraftSections}
          onAddElement={handleAddElement}
          ariaLabel="Service plan template"
          structureOnly
          hideNotes={hideNotes}
          microphones={microphones}
          microphoneAudiences={microphoneAudiences}
          roleNoteOptions={roleNoteOptions}
          teamNoteOptions={teamNoteOptions}
          header={
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
              {canEdit && isEditing ? (
                <>
                  <Input
                    label="Template name"
                    placeholder="e.g. Standard Sabbath"
                    className="min-w-0 w-full sm:max-w-xs sm:flex-1"
                    value={name}
                    onChange={(value) =>
                      updateDraft({ name: String(value) }, "templateName")
                    }
                  />
                  <Select
                    label="Preferred for"
                    className="w-full shrink-0 sm:w-52"
                    value={serviceId || ANY_SERVICE_SCOPE_VALUE}
                    options={serviceOptions}
                    onChange={(value) =>
                      updateDraftServiceId(
                        value === ANY_SERVICE_SCOPE_VALUE ? "" : value,
                      )
                    }
                  />
                  <TimePicker
                    label="Start time"
                    labelLayout="stacked"
                    className="w-full shrink-0 sm:w-40"
                    value={anchorStartTime}
                    disabled={sections.every((s) => s.elements.length === 0)}
                    onChange={(value) =>
                      value && updateDraftSections(
                        applyPlanAnchorStartTime(sections, String(value)),
                        "anchorStartTime",
                      )
                    }
                  />
                </>
              ) : (
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-100">
                    {trimmedName || "Untitled template"}
                  </p>
                  {anchorStartTime ? (
                    <p className="mt-0.5 text-xs text-gray-400">
                      Starts {formatPlanStartTimeDisplay(anchorStartTime)}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          }
        />

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canEdit && isEditing ? (
            <Button
              type="button"
              variant="tertiary"
              svg={Plus}
              iconSize="sm"
              className="max-md:min-h-0"
              onClick={() => updateDraftSections(addSection(sections))}
            >
              Add section
            </Button>
          ) : null}
          {canEdit ? (
            <div
              className={cn(
                "ml-auto flex min-h-9 items-center gap-2 rounded-md px-2.5 text-xs font-medium",
                autosave.state === "conflict"
                  ? "bg-amber-950/50 text-amber-100"
                  : autosave.state === "error"
                    ? "bg-red-950/50 text-red-100"
                    : "text-gray-400",
              )}
              role={
                autosave.state === "error" || autosave.state === "conflict"
                  ? "alert"
                  : "status"
              }
              aria-live="polite"
            >
              {autosave.state === "saved" ? "Synced" : null}
              {autosave.state === "dirty" ? "Saving soon" : null}
              {autosave.state === "saving" ? "Saving…" : null}
              {autosave.state === "retrying" ? "Retrying save…" : null}
              {autosave.state === "error" ? "Could not save" : null}
              {autosave.state === "conflict" ? "Template changed elsewhere" : null}
              {autosave.state === "error" ? (
                <Button
                  variant="tertiary"
                  className="h-auto min-h-0 px-0 py-0 text-xs"
                  onClick={autosave.retry}
                >
                  Retry
                </Button>
              ) : null}
              {autosave.state === "conflict" ? (
                <Button
                  variant="tertiary"
                  className="h-auto min-h-0 px-0 py-0 text-xs"
                  onClick={reloadConflictTemplate}
                >
                  Reload latest
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {canEdit && !trimmedName ? (
          <p className="shrink-0 text-xs text-amber-200">
            Give this template a name to start saving it.
          </p>
        ) : null}
      </div>

      <DeleteModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        itemName={savedName || template.name}
        isConfirming={deleting}
        message="Permanently delete the template"
        warningMessage="Plans already built from it keep their items. This cannot be undone."
      />
    </div>
  );
};

export default ServicePlanTemplateEditor;
