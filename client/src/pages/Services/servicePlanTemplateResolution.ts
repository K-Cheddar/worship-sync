import type { ServicePlanTemplate } from "../../types/servicePlan";

export const getApplicableServicePlanTemplates = (
  templates: ServicePlanTemplate[],
  serviceId: string,
): ServicePlanTemplate[] =>
  templates.filter(
    (template) => !template.serviceId || template.serviceId === serviceId,
  );

export const resolvePrimaryServicePlanTemplate = ({
  templates,
  serviceId,
  defaultTemplateId,
  lastUsedTemplateId,
}: {
  templates: ServicePlanTemplate[];
  serviceId: string;
  defaultTemplateId?: string;
  lastUsedTemplateId?: string;
}): ServicePlanTemplate | null => {
  const applicableTemplates = getApplicableServicePlanTemplates(
    templates,
    serviceId,
  );
  const defaultId = defaultTemplateId?.trim();
  const lastUsedId = lastUsedTemplateId?.trim();

  return (
    (defaultId
      ? applicableTemplates.find((template) => template.templateId === defaultId)
      : undefined) ||
    (lastUsedId
      ? applicableTemplates.find((template) => template.templateId === lastUsedId)
      : undefined) ||
    (applicableTemplates.length === 1 ? applicableTemplates[0] : null)
  );
};
