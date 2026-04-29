import { ChevronDown, ChevronUp, Plus, RotateCcw } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../../context/toastContext";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import Toggle from "../../components/Toggle/Toggle";
import Spinner from "../../components/Spinner/Spinner";
import {
  updateChurchIntegrations,
  AuthApiError,
} from "../../api/auth";
import {
  DEFAULT_SERVICE_PLANNING_NAME_SOURCES,
  type ChurchIntegrations,
  type ServicePlanningElementRule,
  type ServicePlanningPerson,
  type ServicePlanningSectionRule,
  type NameColumnKey,
} from "../../types/integrations";
import generateRandomId from "../../utils/generateRandomId";
import { CommaSeparatedPillsInput } from "../../components/CommaSeparatedPillsInput/CommaSeparatedPillsInput";
import ExpandCollapseAllToolbar from "../../components/ExpandCollapseAllToolbar/ExpandCollapseAllToolbar";
import IntegrationsCollapsibleCardHeader from "../../components/IntegrationsCollapsibleCardHeader/IntegrationsCollapsibleCardHeader";
import cn from "classnames";

type IntegrationsSettingsPanelProps = {
  churchId: string;
  integrations: ChurchIntegrations;
  integrationsStatus: "loading" | "ready";
};

const NAME_COLUMNS: { value: NameColumnKey; label: string }[] = [
  { value: "elementType", label: "Element type" },
  { value: "title", label: "Title" },
  { value: "ledBy", label: "Led by" },
];

const MATCH_MODES = [
  { value: "contains", label: "Contains" },
  { value: "exact", label: "Exact" },
  { value: "normalize", label: "Normalize / fuzzy" },
];

const MULTI_MODES = [
  { value: "single", label: "Single overlay (combine names)" },
  { value: "split", label: "Split — one overlay per person token" },
];

const OUTLINE_ITEM_TYPES = [
  { value: "song", label: "Song" },
  { value: "bible", label: "Bible passage" },
  { value: "none", label: "None (skip outline)" },
];

/** Match first-row Input / Select trigger heights in rule cards. */
const RULE_TOP_ROW_INPUT_CLASS =
  "h-9 min-h-9 box-border py-1 leading-none md:text-sm";
const RULE_TOP_ROW_SELECT_TRIGGER_CLASS =
  "flex h-9 min-h-9 box-border items-center py-0";

const labelForNameColumn = (key: NameColumnKey) =>
  NAME_COLUMNS.find((c) => c.value === key)?.label ?? key;

function cloneIntegrations(src: ChurchIntegrations): ChurchIntegrations {
  return JSON.parse(JSON.stringify(src)) as ChurchIntegrations;
}

type IntegrationsElementRuleCardProps = {
  rule: ServicePlanningElementRule;
  ruleIndex: number;
  updateRule: (id: string, patch: Partial<ServicePlanningElementRule>) => void;
  toggleNameSource: (
    ruleId: string,
    key: NameColumnKey,
    enabled: boolean,
  ) => void;
  moveNameSource: (
    ruleId: string,
    fromIndex: number,
    delta: -1 | 1,
  ) => void;
  removeRule: (id: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

const IntegrationsElementRuleCard = memo(function IntegrationsElementRuleCard({
  rule,
  ruleIndex,
  updateRule,
  toggleNameSource,
  moveNameSource,
  removeRule,
  expanded,
  onExpandedChange,
}: IntegrationsElementRuleCardProps) {
  const hasSavedFieldTemplates = Boolean(
    (rule.fieldTemplates?.name || "").trim() ||
    (rule.fieldTemplates?.title || "").trim() ||
    (rule.fieldTemplates?.event || "").trim(),
  );

  const [fieldTemplatesOpen, setFieldTemplatesOpen] =
    useState(hasSavedFieldTemplates);

  const elementTypePreview = rule.matchElementType.trim() || "—";
  const overlaySyncEnabled = rule.overlaySyncEnabled !== false;

  return (
    <div className="@container rounded-lg border border-gray-600 bg-gray-900/40 p-3 space-y-3">
      <IntegrationsCollapsibleCardHeader
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        expandLabel="Expand rule"
        collapseLabel="Collapse rule"
        title={`Rule ${ruleIndex + 1}`}
        collapsedPreview={elementTypePreview}
        removeAriaLabel={`Remove rule ${ruleIndex + 1}`}
        onRemove={() => removeRule(rule.id)}
      />
      {expanded ? (
        <>
          <div
            className={cn(
              "grid grid-cols-1 gap-3 @[480px]:items-end",
              overlaySyncEnabled ? "@[480px]:grid-cols-3" : "@[480px]:grid-cols-2",
            )}
          >
            <Input
              label="Match element type"
              value={rule.matchElementType}
              onChange={(v) =>
                updateRule(rule.id, { matchElementType: String(v || "") })
              }
              className="min-w-0"
              inputClassName={RULE_TOP_ROW_INPUT_CLASS}
            />
            <Select
              label="Match mode"
              options={MATCH_MODES}
              value={rule.matchMode}
              onChange={(v) =>
                updateRule(rule.id, {
                  matchMode: v as ServicePlanningElementRule["matchMode"],
                })
              }
              className="min-w-0"
              selectClassName={RULE_TOP_ROW_SELECT_TRIGGER_CLASS}
            />
            {overlaySyncEnabled ? (
              <Input
                label="Display / default event name (optional)"
                value={rule.displayName}
                onChange={(v) =>
                  updateRule(rule.id, { displayName: String(v || "") })
                }
                className="min-w-0"
                inputClassName={RULE_TOP_ROW_INPUT_CLASS}
              />
            ) : null}
          </div>
          <Toggle
            label="Use for overlay sync"
            value={overlaySyncEnabled}
            onChange={(v) =>
              updateRule(rule.id, {
                overlaySyncEnabled: v,
              })
            }
          />
          <p className="text-xs text-gray-400">
            Turn this off to make the rule outline-only. Leave it on to let the
            rule update or clone overlays during preview and sync.
          </p>
          {overlaySyncEnabled ? (
            <>
              <p className="mt-1 text-xs text-gray-400">
                Display / default event name defaults to match element type when empty.
              </p>
              <div>
                <p className="mb-2 text-sm font-medium text-gray-300">Name columns</p>
                <p className="mb-3 text-xs text-gray-400">
                  Enabled columns are merged with a space in the order below (top
                  first). Turn columns on or off, then reorder with the arrows.
                </p>
                <div className="flex flex-wrap gap-3">
                  {NAME_COLUMNS.map((col) => (
                    <Toggle
                      key={col.value}
                      label={col.label}
                      value={rule.nameSources.includes(col.value)}
                      onChange={(on) => toggleNameSource(rule.id, col.value, on)}
                    />
                  ))}
                </div>
                {rule.nameSources.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-gray-600 bg-gray-950/60 p-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                      Merge order
                    </p>
                    <ol className="space-y-2">
                      {rule.nameSources.map((key, idx) => (
                        <li
                          key={key}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span className="w-6 shrink-0 text-center text-xs text-gray-500">
                            {idx + 1}.
                          </span>
                          <span className="min-w-0 flex-1 text-sm text-gray-200">
                            {labelForNameColumn(key)}
                          </span>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              type="button"
                              variant="tertiary"
                              svg={ChevronUp}
                              iconSize="sm"
                              padding="px-2 py-1"
                              aria-label={`Move ${labelForNameColumn(key)} earlier in merge order`}
                              disabled={idx === 0}
                              onClick={() => moveNameSource(rule.id, idx, -1)}
                            />
                            <Button
                              type="button"
                              variant="tertiary"
                              svg={ChevronDown}
                              iconSize="sm"
                              padding="px-2 py-1"
                              aria-label={`Move ${labelForNameColumn(key)} later in merge order`}
                              disabled={idx === rule.nameSources.length - 1}
                              onClick={() => moveNameSource(rule.id, idx, 1)}
                            />
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
              <Select
                label="Overlay mode"
                options={MULTI_MODES}
                value={rule.multiOverlay.mode}
                onChange={(v) =>
                  updateRule(rule.id, {
                    multiOverlay: {
                      ...rule.multiOverlay,
                      mode: v as "single" | "split",
                    },
                  })
                }
              />
              {rule.multiOverlay.mode === "split" ? (
                <div className="space-y-3">
                  <CommaSeparatedPillsInput
                    label="Event suffixes (per person in split order)"
                    helperText={
                      "First person → first pill, second → second pill, and so on. Use the toggle below if extra names should reuse the last pill instead of the plain event name."
                    }
                    value={rule.multiOverlay.eventSuffixByPersonIndex || []}
                    onChange={(segments) =>
                      updateRule(rule.id, {
                        multiOverlay: {
                          ...rule.multiOverlay,
                          eventSuffixByPersonIndex: segments,
                        },
                      })
                    }
                  />
                  <Toggle
                    label="Repeat last suffix for extra names"
                    value={Boolean(rule.multiOverlay.repeatLastEventSuffix)}
                    onChange={(v) =>
                      updateRule(rule.id, {
                        multiOverlay: {
                          ...rule.multiOverlay,
                          repeatLastEventSuffix: v,
                        },
                      })
                    }
                  />
                  <p className="text-xs text-gray-400">
                    When off, names past your suffix list use only the rule’s display
                    / default event (no suffix). When on, those extras get the{" "}
                    <span className="font-medium text-gray-300">last</span> suffix
                    pill again.
                  </p>
                </div>
              ) : null}
              <Toggle
                label="Custom name, title, and event templates"
                value={fieldTemplatesOpen}
                onChange={setFieldTemplatesOpen}
              />
              {fieldTemplatesOpen ? (
                <div className="space-y-3 rounded-lg border border-gray-600 bg-gray-950/40 p-3">
                  <p className="text-xs text-gray-400">
                    Optional overrides for synced participant overlay fields.
                    Placeholders:{" "}
                    <span className="font-mono text-gray-300">
                      {"{{name}}"}, {"{{names}}"}, {"{{title}}"},{" "}
                      {"{{displayName}}"}, {"{{rawTitle}}"}, {"{{rawLedBy}}"}
                    </span>
                    . In split overlay mode,{" "}
                    <span className="font-mono text-gray-300">{"{{event}}"}</span>{" "}
                    is also available per person.
                  </p>
                  <Input
                    label="Name template (optional)"
                    value={rule.fieldTemplates?.name || ""}
                    onChange={(v) =>
                      updateRule(rule.id, {
                        fieldTemplates: {
                          ...rule.fieldTemplates,
                          name: String(v || ""),
                        },
                      })
                    }
                  />
                  <Input
                    label="Title template (optional)"
                    value={rule.fieldTemplates?.title || ""}
                    onChange={(v) =>
                      updateRule(rule.id, {
                        fieldTemplates: {
                          ...rule.fieldTemplates,
                          title: String(v || ""),
                        },
                      })
                    }
                  />
                  <Input
                    label="Event template (optional)"
                    value={rule.fieldTemplates?.event || ""}
                    onChange={(v) =>
                      updateRule(rule.id, {
                        fieldTemplates: {
                          ...rule.fieldTemplates,
                          event: String(v || ""),
                        },
                      })
                    }
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-lg border border-gray-600 bg-gray-950/40 p-3 text-xs text-gray-400">
              This rule is outline-only right now. Overlay mapping settings are
              hidden, but any values you already entered will be kept if you turn
              overlay sync back on.
            </div>
          )}
          <Toggle
            label="Add to outline on sync"
            value={rule.outlineSync?.enabled ?? false}
            onChange={(v) =>
              updateRule(rule.id, {
                outlineSync: {
                  itemType: rule.outlineSync?.itemType ?? "none",
                  enabled: v,
                },
              })
            }
          />
          {rule.outlineSync?.enabled && (
            <Select
              label="Outline item type"
              options={OUTLINE_ITEM_TYPES}
              value={rule.outlineSync.itemType}
              onChange={(v) =>
                updateRule(rule.id, {
                  outlineSync: {
                    ...rule.outlineSync!,
                    itemType: v as "song" | "bible" | "none",
                  },
                })
              }
            />
          )}
        </>
      ) : null}
    </div>
  );
});

type IntegrationsPersonCardProps = {
  person: ServicePlanningPerson;
  personIndex: number;
  updatePerson: (id: string, patch: Partial<ServicePlanningPerson>) => void;
  removePerson: (id: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

const IntegrationsPersonCard = memo(function IntegrationsPersonCard({
  person,
  personIndex,
  updatePerson,
  removePerson,
  expanded,
  onExpandedChange,
}: IntegrationsPersonCardProps) {
  const alternateNamesPreview = person.names
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  const collapsedPreview =
    person.displayName.trim() ||
    alternateNamesPreview ||
    "—";

  return (
    <div className="@container rounded-lg border border-gray-600 bg-gray-900/40 p-3 space-y-3">
      <IntegrationsCollapsibleCardHeader
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        expandLabel="Expand person"
        collapseLabel="Collapse person"
        title={`Person ${personIndex + 1}`}
        collapsedPreview={collapsedPreview}
        removeAriaLabel={`Remove person ${personIndex + 1}`}
        onRemove={() => removePerson(person.id)}
      />
      {expanded ? (
        <>
          <CommaSeparatedPillsInput
            label="Names"
            helperText="Separate names with commas."
            value={person.names}
            onChange={(names) => updatePerson(person.id, { names })}
          />
          <Input
            label="Display name (optional)"
            value={person.displayName}
            placeholder={person.names.find(Boolean) || undefined}
            onChange={(v) =>
              updatePerson(person.id, { displayName: String(v || "") })
            }
          />
          <Input
            label="Title / role label"
            value={person.title || ""}
            onChange={(v) =>
              updatePerson(person.id, { title: String(v || "") })
            }
          />
        </>
      ) : null}
    </div>
  );
});

type IntegrationsSectionRuleCardProps = {
  rule: ServicePlanningSectionRule;
  ruleIndex: number;
  updateSectionRule: (id: string, patch: Partial<ServicePlanningSectionRule>) => void;
  removeSectionRule: (id: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

const IntegrationsSectionRuleCard = memo(function IntegrationsSectionRuleCard({
  rule,
  ruleIndex,
  updateSectionRule,
  removeSectionRule,
  expanded,
  onExpandedChange,
}: IntegrationsSectionRuleCardProps) {
  const sectionNamePreview = rule.matchSectionName.trim() || "—";

  return (
    <div className="@container rounded-lg border border-gray-600 bg-gray-900/40 p-3 space-y-3">
      <IntegrationsCollapsibleCardHeader
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        expandLabel="Expand section rule"
        collapseLabel="Collapse section rule"
        title={`Section rule ${ruleIndex + 1}`}
        collapsedPreview={sectionNamePreview}
        removeAriaLabel={`Remove section rule ${ruleIndex + 1}`}
        onRemove={() => removeSectionRule(rule.id)}
      />
      {expanded ? (
        <>
          <div className="grid grid-cols-1 gap-3 @[480px]:grid-cols-3 @[480px]:items-end">
            <Input
              label="Match section name"
              value={rule.matchSectionName}
              onChange={(v) =>
                updateSectionRule(rule.id, {
                  matchSectionName: String(v || ""),
                })
              }
              className="min-w-0"
              inputClassName={RULE_TOP_ROW_INPUT_CLASS}
            />
            <Select
              label="Match mode"
              options={MATCH_MODES}
              value={rule.matchMode}
              onChange={(v) =>
                updateSectionRule(rule.id, {
                  matchMode: v as ServicePlanningSectionRule["matchMode"],
                })
              }
              className="min-w-0"
              selectClassName={RULE_TOP_ROW_SELECT_TRIGGER_CLASS}
            />
            <Input
              label="Outline heading name"
              value={rule.headingName}
              onChange={(v) =>
                updateSectionRule(rule.id, { headingName: String(v || "") })
              }
              className="min-w-0"
              inputClassName={RULE_TOP_ROW_INPUT_CLASS}
            />
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Outline heading name is where matched items are inserted in your service outline.
          </p>
        </>
      ) : null}
    </div>
  );
});

export const IntegrationsSettingsPanel = ({
  churchId,
  integrations,
  integrationsStatus,
}: IntegrationsSettingsPanelProps) => {
  const { showToast } = useToast();
  const draftRef = useRef<ChurchIntegrations>(cloneIntegrations(integrations));
  const [draft, setDraft] = useState<ChurchIntegrations>(() =>
    cloneIntegrations(integrations),
  );
  /** Remount people / rule rows so comma-pill draft clears when reverting draft from server/default. */
  const [integrationsFormRemountTick, setIntegrationsFormRemountTick] =
    useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Avoid JSON.stringify(draft) per keystroke — that dominated input latency. */
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  /** `true` = row expanded. Omitted / false = collapsed (default for loaded rules). */
  const [expandedElementRuleIds, setExpandedElementRuleIds] = useState<
    Record<string, boolean>
  >({});
  const [expandedSectionRuleIds, setExpandedSectionRuleIds] = useState<
    Record<string, boolean>
  >({});
  const [expandedPeopleIds, setExpandedPeopleIds] = useState<
    Record<string, boolean>
  >({});

  const applyDraftUpdate = useCallback(
    (updater: (prev: ChurchIntegrations) => ChurchIntegrations) => {
      setDraft((prev) => {
        const next = updater(prev);
        draftRef.current = next;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const nextDraft = cloneIntegrations(integrations);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setError(null);
    setIsDraftDirty(false);
    setExpandedElementRuleIds({});
    setExpandedSectionRuleIds({});
    setExpandedPeopleIds({});
  }, [integrations]);

  const handleSave = useCallback(async () => {
    if (!churchId) return;
    const draftToSave = cloneIntegrations(draftRef.current);
    const emptySourceRule = draftToSave.servicePlanning.elementRules.findIndex(
      (r) => r.nameSources.length === 0,
    );
    if (emptySourceRule !== -1) {
      setError(
        `Rule ${emptySourceRule + 1} has no name columns selected. Select at least one before saving.`,
      );
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const response = await updateChurchIntegrations(churchId, draftToSave);
      const savedDraft = cloneIntegrations(response.integrations);
      draftRef.current = savedDraft;
      setDraft(savedDraft);
      setIsDraftDirty(false);
      showToast("Integrations saved.", "success");
    } catch (e) {
      const msg =
        e instanceof AuthApiError
          ? e.message
          : "Could not save integrations. Try again.";
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  }, [churchId, showToast]);

  const resetDraft = useCallback(() => {
    const nextDraft = cloneIntegrations(integrations);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setIntegrationsFormRemountTick((t) => t + 1);
    setIsDraftDirty(false);
    setError(null);
    setExpandedElementRuleIds({});
    setExpandedSectionRuleIds({});
    setExpandedPeopleIds({});
  }, [integrations]);

  const sp = draft.servicePlanning;

  const setServicePlanningEnabled = useCallback((enabled: boolean) => {
    setIsDraftDirty(true);
    applyDraftUpdate((prev) => ({
      ...prev,
      servicePlanning: { ...prev.servicePlanning, enabled },
    }));
  }, [applyDraftUpdate]);

  const updateRule = useCallback(
    (id: string, patch: Partial<ServicePlanningElementRule>) => {
      setIsDraftDirty(true);
      applyDraftUpdate((prev) => ({
        ...prev,
        servicePlanning: {
          ...prev.servicePlanning,
          elementRules: prev.servicePlanning.elementRules.map((r) =>
            r.id === id ? { ...r, ...patch } : r,
          ),
        },
      }));
    },
    [applyDraftUpdate],
  );

  const toggleNameSource = useCallback(
    (ruleId: string, key: NameColumnKey, enabled: boolean) => {
      setIsDraftDirty(true);
      applyDraftUpdate((prev) => ({
        ...prev,
        servicePlanning: {
          ...prev.servicePlanning,
          elementRules: prev.servicePlanning.elementRules.map((r) => {
            if (r.id !== ruleId) return r;
            if (enabled) {
              if (r.nameSources.includes(key)) return r;
              return { ...r, nameSources: [...r.nameSources, key] };
            }
            return {
              ...r,
              nameSources: r.nameSources.filter((k) => k !== key),
            };
          }),
        },
      }));
    },
    [applyDraftUpdate],
  );

  const moveNameSource = useCallback(
    (ruleId: string, fromIndex: number, delta: -1 | 1) => {
      setIsDraftDirty(true);
      applyDraftUpdate((prev) => ({
        ...prev,
        servicePlanning: {
          ...prev.servicePlanning,
          elementRules: prev.servicePlanning.elementRules.map((r) => {
            if (r.id !== ruleId) return r;
            const arr = [...r.nameSources];
            const toIndex = fromIndex + delta;
            if (toIndex < 0 || toIndex >= arr.length) return r;
            const tmp = arr[fromIndex];
            arr[fromIndex] = arr[toIndex];
            arr[toIndex] = tmp;
            return { ...r, nameSources: arr };
          }),
        },
      }));
    },
    [applyDraftUpdate],
  );

  const removeRule = useCallback((id: string) => {
    setIsDraftDirty(true);
    applyDraftUpdate((prev) => ({
      ...prev,
      servicePlanning: {
        ...prev.servicePlanning,
        elementRules: prev.servicePlanning.elementRules.filter((r) => r.id !== id),
      },
    }));
  }, [applyDraftUpdate]);

  const addRule = useCallback(() => {
    setIsDraftDirty(true);
    const id = generateRandomId();
    const next: ServicePlanningElementRule = {
      id,
      matchElementType: "",
      matchMode: "contains",
      overlaySyncEnabled: true,
      displayName: "",
      nameSources: [...DEFAULT_SERVICE_PLANNING_NAME_SOURCES],
      multiOverlay: { mode: "single" },
    };
    applyDraftUpdate((prev) => ({
      ...prev,
      servicePlanning: {
        ...prev.servicePlanning,
        elementRules: [...prev.servicePlanning.elementRules, next],
      },
    }));
    setExpandedElementRuleIds((prev) => ({ ...prev, [id]: true }));
  }, [applyDraftUpdate]);

  const expandAllElementRules = useCallback(() => {
    setExpandedElementRuleIds((prev) => {
      const next = { ...prev };
      for (const r of sp.elementRules) {
        next[r.id] = true;
      }
      return next;
    });
  }, [sp.elementRules]);

  const collapseAllElementRules = useCallback(() => {
    setExpandedElementRuleIds({});
  }, []);

  const expandAllSectionRules = useCallback(() => {
    setExpandedSectionRuleIds((prev) => {
      const next = { ...prev };
      for (const r of sp.sectionRules) {
        next[r.id] = true;
      }
      return next;
    });
  }, [sp.sectionRules]);

  const collapseAllSectionRules = useCallback(() => {
    setExpandedSectionRuleIds({});
  }, []);

  const expandAllPeople = useCallback(() => {
    setExpandedPeopleIds((prev) => {
      const next = { ...prev };
      for (const p of sp.people) {
        next[p.id] = true;
      }
      return next;
    });
  }, [sp.people]);

  const collapseAllPeople = useCallback(() => {
    setExpandedPeopleIds({});
  }, []);

  const updatePerson = useCallback(
    (id: string, patch: Partial<ServicePlanningPerson>) => {
      setIsDraftDirty(true);
      applyDraftUpdate((prev) => ({
        ...prev,
        servicePlanning: {
          ...prev.servicePlanning,
          people: prev.servicePlanning.people.map((p) =>
            p.id === id ? { ...p, ...patch } : p,
          ),
        },
      }));
    },
    [applyDraftUpdate],
  );

  const removePerson = useCallback((id: string) => {
    setIsDraftDirty(true);
    applyDraftUpdate((prev) => ({
      ...prev,
      servicePlanning: {
        ...prev.servicePlanning,
        people: prev.servicePlanning.people.filter((p) => p.id !== id),
      },
    }));
  }, [applyDraftUpdate]);

  const addPerson = useCallback(() => {
    setIsDraftDirty(true);
    const id = generateRandomId();
    applyDraftUpdate((prev) => ({
      ...prev,
      servicePlanning: {
        ...prev.servicePlanning,
        people: [
          ...prev.servicePlanning.people,
          { id, names: [], displayName: "" },
        ],
      },
    }));
    setExpandedPeopleIds((prev) => ({ ...prev, [id]: true }));
  }, [applyDraftUpdate]);

  const addSectionRule = useCallback(() => {
    setIsDraftDirty(true);
    const id = generateRandomId();
    const next: ServicePlanningSectionRule = {
      id,
      matchSectionName: "",
      matchMode: "contains",
      headingName: "",
    };
    applyDraftUpdate((prev) => ({
      ...prev,
      servicePlanning: {
        ...prev.servicePlanning,
        sectionRules: [...prev.servicePlanning.sectionRules, next],
      },
    }));
    setExpandedSectionRuleIds((prev) => ({ ...prev, [id]: true }));
  }, [applyDraftUpdate]);

  const updateSectionRule = useCallback(
    (id: string, patch: Partial<ServicePlanningSectionRule>) => {
      setIsDraftDirty(true);
      applyDraftUpdate((prev) => ({
        ...prev,
        servicePlanning: {
          ...prev.servicePlanning,
          sectionRules: prev.servicePlanning.sectionRules.map((r) =>
            r.id === id ? { ...r, ...patch } : r,
          ),
        },
      }));
    },
    [applyDraftUpdate],
  );

  const removeSectionRule = useCallback((id: string) => {
    setIsDraftDirty(true);
    applyDraftUpdate((prev) => ({
      ...prev,
      servicePlanning: {
        ...prev.servicePlanning,
        sectionRules: prev.servicePlanning.sectionRules.filter((r) => r.id !== id),
      },
    }));
  }, [applyDraftUpdate]);

  if (integrationsStatus === "loading") {
    return (
      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
        <div className="flex items-center gap-2 text-sm text-gray-200" role="status">
          <Spinner
            width="16px"
            borderWidth="2px"
            className="shrink-0 border-cyan-400/90 border-b-transparent"
          />
          <span>Loading integrations…</span>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
        <h3 className="text-lg font-semibold">Integration catalog</h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-400">
          Connect WorshipSync with external planning tools. More integrations will appear here over time.
        </p>
        <ul className="mt-4 grid gap-3 md:grid-cols-3">
          <li
            className={cn(
              "rounded-lg border border-gray-600 bg-gray-900/60 p-3",
              !sp.enabled && "opacity-90",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{draft.catalog.servicePlanning.label}</span>
              <span className="rounded-full bg-cyan-900/40 px-2 py-0.5 text-xs text-cyan-200">
                Available
              </span>
            </div>
          </li>
          <li className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 opacity-70">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{draft.catalog.songSelect.label}</span>
              <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
                Coming soon
              </span>
            </div>
          </li>
          <li className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 opacity-70">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{draft.catalog.planningCenter.label}</span>
              <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
                Coming soon
              </span>
            </div>
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Service Planning</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-400">
              Map Worship Planning printout rows to overlay name, title, and event fields. Operators run sync from the controller when this is enabled.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="tertiary"
              svg={RotateCcw}
              iconSize="sm"
              disabled={!isDraftDirty || isSaving}
              onClick={resetDraft}
            >
              Reset changes
            </Button>
            <Button
              type="button"
              variant="cta"
              iconSize="sm"
              isLoading={isSaving}
              disabled={isSaving || !isDraftDirty}
              onClick={() => void handleSave()}
            >
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-6 space-y-4">
          <Toggle
            label="Enable Service Planning sync for operators"
            value={sp.enabled}
            onChange={setServicePlanningEnabled}
          />
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-base font-semibold">Element rules</h4>
            <Button type="button" variant="primary" svg={Plus} iconSize="sm" color="#22d3ee" onClick={addRule}>
              Add rule
            </Button>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            First matching rule wins. Match against the planning &quot;Element type&quot; column.
          </p>
          <ExpandCollapseAllToolbar
            visible={sp.elementRules.length > 0}
            onExpandAll={expandAllElementRules}
            onCollapseAll={collapseAllElementRules}
          />
          <div className="mt-4 space-y-4">
            {sp.elementRules.map((rule, idx) => (
              <IntegrationsElementRuleCard
                key={`${rule.id}-${integrationsFormRemountTick}`}
                rule={rule}
                ruleIndex={idx}
                expanded={Boolean(expandedElementRuleIds[rule.id])}
                onExpandedChange={(next) =>
                  setExpandedElementRuleIds((prev) => ({
                    ...prev,
                    [rule.id]: next,
                  }))
                }
                updateRule={updateRule}
                toggleNameSource={toggleNameSource}
                moveNameSource={moveNameSource}
                removeRule={removeRule}
              />
            ))}
          </div>
        </div>

        <div className="mt-10">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-base font-semibold">Section rules</h4>
            <Button type="button" variant="primary" svg={Plus} iconSize="sm" color="#22d3ee" onClick={addSectionRule}>
              Add section rule
            </Button>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Map planning section dividers to outline headings. First matching rule wins.
          </p>
          <ExpandCollapseAllToolbar
            visible={sp.sectionRules.length > 0}
            onExpandAll={expandAllSectionRules}
            onCollapseAll={collapseAllSectionRules}
          />
          <div className="mt-4 space-y-4">
            {sp.sectionRules.map((rule, idx) => (
              <IntegrationsSectionRuleCard
                key={`${rule.id}-${integrationsFormRemountTick}`}
                rule={rule}
                ruleIndex={idx}
                expanded={Boolean(expandedSectionRuleIds[rule.id])}
                onExpandedChange={(next) =>
                  setExpandedSectionRuleIds((prev) => ({
                    ...prev,
                    [rule.id]: next,
                  }))
                }
                updateSectionRule={updateSectionRule}
                removeSectionRule={removeSectionRule}
              />
            ))}
          </div>
        </div>

        <div className="mt-10">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-base font-semibold">People directory</h4>
            <Button type="button" variant="primary" svg={Plus} iconSize="sm" color="#22d3ee" onClick={addPerson}>
              Add person
            </Button>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Alternate names help match planning text to display names and titles.
          </p>
          <ExpandCollapseAllToolbar
            visible={sp.people.length > 0}
            onExpandAll={expandAllPeople}
            onCollapseAll={collapseAllPeople}
          />
          <div className="mt-4 space-y-4">
            {sp.people.map((person, idx) => (
              <IntegrationsPersonCard
                key={`${person.id}-${integrationsFormRemountTick}`}
                person={person}
                personIndex={idx}
                expanded={Boolean(expandedPeopleIds[person.id])}
                onExpandedChange={(next) =>
                  setExpandedPeopleIds((prev) => ({
                    ...prev,
                    [person.id]: next,
                  }))
                }
                updatePerson={updatePerson}
                removePerson={removePerson}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
