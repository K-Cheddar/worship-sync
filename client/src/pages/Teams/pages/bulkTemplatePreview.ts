import type { TeamService } from "../../../api/authTypes";

export type BulkTemplatePreviewEntry = {
  planKey: string;
  serviceId: string;
};

export const calculateBulkTemplatePreview = ({
  entries,
  existingPlanKeys,
  services,
  useServiceDefaults,
  availableTemplateIds,
  templatesLoaded,
}: {
  entries: BulkTemplatePreviewEntry[];
  existingPlanKeys: ReadonlySet<string>;
  services: TeamService[];
  useServiceDefaults: boolean;
  availableTemplateIds: ReadonlySet<string>;
  templatesLoaded: boolean;
}) => {
  const servicesById = new Map(services.map((service) => [service.serviceId, service]));
  let existing = 0;
  let noDefault = 0;
  let unavailableDefault = 0;
  let awaitingTemplateList = 0;
  for (const entry of entries) {
    if (existingPlanKeys.has(entry.planKey)) {
      existing += 1;
      continue;
    }
    if (!useServiceDefaults) continue;
    const templateId = servicesById.get(entry.serviceId)?.defaultPlanTemplateId?.trim();
    if (!templateId) {
      noDefault += 1;
    } else if (!templatesLoaded) {
      awaitingTemplateList += 1;
    } else if (!availableTemplateIds.has(templateId)) {
      unavailableDefault += 1;
    }
  }
  const available = entries.length - existing - noDefault - unavailableDefault;
  const willCreate = useServiceDefaults && !templatesLoaded
    ? Math.max(0, available - awaitingTemplateList)
    : available;
  return {
    total: entries.length,
    existing,
    noDefault,
    unavailableDefault,
    awaitingTemplateList,
    willCreate,
  };
};
