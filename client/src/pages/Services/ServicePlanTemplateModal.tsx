import { useEffect, useState } from "react";
import { LayoutTemplate, Trash2 } from "lucide-react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Modal from "../../components/Modal/Modal";
import Checkbox from "../../components/Checkbox/Checkbox";
import Spinner from "../../components/Spinner/Spinner";
import { useToast } from "../../context/toastContext";
import {
  deleteServicePlanTemplate,
  listServicePlanTemplates,
  saveServicePlanTemplate,
} from "../../api/auth";
import { showApiErrorToast } from "../../utils/apiErrorToast";
import { cloneSectionsForTemplate } from "./servicePlanDraftUtils";
import type {
  ServicePlanSection,
  ServicePlanTemplate,
} from "../../types/servicePlan";

export type ServicePlanTemplateModalMode = "apply" | "save";

type ServicePlanTemplateModalProps = {
  mode: ServicePlanTemplateModalMode;
  churchId: string;
  /** Scopes/labels templates for the service being planned. */
  serviceId: string;
  serviceName: string;
  /** The plan's current sections — the source when saving a template. */
  sections: ServicePlanSection[];
  onClose: () => void;
  onApply: (sections: ServicePlanSection[]) => void;
};

/**
 * Applies a saved order-of-service skeleton to this plan, or saves this plan's
 * structure as a new/updated one. Templates carry structure only — the
 * per-week song, scripture and assignment picks are stripped on the way in and
 * on the way out (see cloneSectionsForTemplate).
 */
const ServicePlanTemplateModal = ({
  mode,
  churchId,
  serviceId,
  serviceName,
  sections,
  onClose,
  onApply,
}: ServicePlanTemplateModalProps) => {
  const { showToast } = useToast();
  const [templates, setTemplates] = useState<ServicePlanTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [scopeToService, setScopeToService] = useState(true);
  const [overwriteId, setOverwriteId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listServicePlanTemplates(churchId)
      .then((res) => {
        if (!cancelled) setTemplates(res.templates);
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

  // Templates tied to this service are the likely pick, so they lead.
  const forThisService = templates.filter((t) => t.serviceId === serviceId);
  const general = templates.filter((t) => t.serviceId !== serviceId);
  const ordered = [...forThisService, ...general];

  const handleApply = (template: ServicePlanTemplate) => {
    onApply(cloneSectionsForTemplate(template.sections));
    showToast(`Applied "${template.name}".`, "success");
    onClose();
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await saveServicePlanTemplate(churchId, {
        name: trimmed,
        ...(scopeToService ? { serviceId } : {}),
        sections: cloneSectionsForTemplate(sections),
        ...(overwriteId ? { templateId: overwriteId } : {}),
      });
      showToast(
        overwriteId ? `Updated "${trimmed}".` : `Saved "${trimmed}" as a template.`,
        "success",
      );
      onClose();
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this template.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template: ServicePlanTemplate) => {
    try {
      await deleteServicePlanTemplate(churchId, template.templateId);
      setTemplates((current) =>
        current.filter((item) => item.templateId !== template.templateId),
      );
      if (overwriteId === template.templateId) setOverwriteId("");
      showToast(`Deleted "${template.name}".`, "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not delete this template.");
    }
  };

  const countItems = (template: ServicePlanTemplate) =>
    template.sections.reduce((total, section) => total + section.elements.length, 0);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={mode === "apply" ? "Apply a template" : "Save as template"}
      size="md"
    >
      <div className="space-y-3">
        {mode === "save" ? (
          <div className="space-y-3">
            <Input
              label="Template name"
              labelClassName="text-gray-100"
              placeholder="e.g. Standard Sabbath"
              value={name}
              disabled={saving}
              onChange={(value) => setName(String(value))}
            />
            <Checkbox
              label={`Prefer for ${serviceName}`}
              checked={scopeToService}
              disabled={saving}
              onCheckedChange={setScopeToService}
            />
            <p className="text-xs text-gray-400">
              Checked templates sort first for this service. Uncheck to use with
              any service. Saves structure, timings and notes — not songs,
              scripture or assignments.
            </p>
            {ordered.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-100">
                  Or replace an existing one
                </p>
                <ul className="scrollbar-variable max-h-40 space-y-1 overflow-y-auto rounded-md border border-gray-700 bg-gray-950/60 p-1">
                  {ordered.map((template) => (
                    <li key={template.templateId}>
                      <Button
                        type="button"
                        variant="tertiary"
                        className="w-full justify-start"
                        aria-pressed={overwriteId === template.templateId}
                        onClick={() => {
                          const isSelected = overwriteId === template.templateId;
                          setOverwriteId(isSelected ? "" : template.templateId);
                          if (!isSelected) setName(template.name);
                        }}
                      >
                        {overwriteId === template.templateId ? "Replacing: " : ""}
                        {template.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Button
              type="button"
              disabled={saving || !name.trim()}
              onClick={handleSave}
            >
              {saving ? "Saving…" : overwriteId ? "Replace template" : "Save template"}
            </Button>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <Spinner /> Loading templates…
          </div>
        ) : ordered.length === 0 ? (
          <p className="text-sm text-gray-400">
            No templates yet. Build a plan you like, then use &ldquo;Save as
            template&rdquo; to reuse its structure.
          </p>
        ) : (
          <div className="space-y-2">
            {sections.length > 0 ? (
              <p className="text-sm text-amber-200" role="status">
                Applying a template replaces this plan&apos;s current outline.
              </p>
            ) : null}
            <ul className="scrollbar-variable max-h-80 space-y-1 overflow-y-auto rounded-md border border-gray-700 bg-gray-950/60 p-1">
              {ordered.map((template) => (
                <li key={template.templateId} className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="tertiary"
                    svg={LayoutTemplate}
                    iconSize="sm"
                    className="min-w-0 flex-1 justify-start"
                    aria-label={`Apply template ${template.name}`}
                    onClick={() => handleApply(template)}
                  >
                    <span className="truncate">{template.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-gray-400">
                      {template.sections.length} sections · {countItems(template)} items
                      {template.serviceId === serviceId ? ` · ${serviceName}` : ""}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="tertiary"
                    iconSize="sm"
                    svg={Trash2}
                    aria-label={`Delete template ${template.name}`}
                    onClick={() => handleDelete(template)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ServicePlanTemplateModal;
