import { useState } from "react";
import FloatingWindow from "../../components/FloatingWindow/FloatingWindow";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import { parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";
import generateRandomId from "../../utils/generateRandomId";
import { multilineTextToRichText, plainTextToRichText, richTextToPlainText } from "../../types/richText";
import type { ServicePlanElement, ServicePlanSection } from "../../types/servicePlan";
import { getServicePlanElementScriptureRefs } from "../../types/servicePlan";
import { createServicePlanLinkResource, createServicePlanTextResource, getServicePlanResourceText } from "./servicePlanResources";

type Props = {
  sections: ServicePlanSection[];
  elementIds: string[];
  prompt: boolean;
  onLater: () => void;
  onResolve: (elementId: string, changes: Partial<ServicePlanElement>) => void;
};

const destinations = [
  { value: "assignee", label: "Assignee" },
  { value: "content", label: "Content attachment" },
  { value: "notes", label: "Shared notes" },
  { value: "scripture", label: "Scripture" },
  { value: "resource", label: "Resource link" },
  { value: "unassigned", label: "Keep with source only" },
];

const destinationsForPart = (kind: string) => {
  const allowed = kind === "url"
    ? new Set(["resource", "content", "notes", "unassigned"])
    : kind === "person"
      ? new Set(["assignee", "content", "notes", "unassigned"])
      : kind === "scripture"
        ? new Set(["scripture", "content", "notes", "unassigned"])
        : new Set(["content", "notes", "unassigned"]);
  return destinations.filter((destination) => allowed.has(destination.value));
};

const normalizedUrl = (value: string) => {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return value;
  }
};

const ServicePlanAmbiguityReview = ({ sections, elementIds, prompt, onLater, onResolve }: Props) => {
  const [showPrompt, setShowPrompt] = useState(prompt);
  const [destinationsByPart, setDestinationsByPart] = useState<Record<string, string>>({});
  const elements = sections.flatMap((section) => section.elements.map((element) => ({ section, element })));
  const selected = elementIds.flatMap((id) => {
    const found = elements.find(({ element }) => element.id === id);
    return found ? [found] : [];
  });
  const active = selected[0];
  const ambiguity = active?.element.importAmbiguity;

  if (showPrompt) {
    return (
      <FloatingWindow title="Review imported items" onClose={onLater} defaultWidth={420} autoHeight>
        <div className="space-y-4 p-4">
          <p className="text-sm text-gray-200">{elementIds.length} imported {elementIds.length === 1 ? "item needs" : "items need"} a quick interpretation review.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onLater}>Review later</Button>
            <Button variant="cta" onClick={() => setShowPrompt(false)}>Review items</Button>
          </div>
        </div>
      </FloatingWindow>
    );
  }

  if (!active || !ambiguity) return null;
  const applyInterpretation = (acknowledge = false) => {
    if (acknowledge) {
      onResolve(active.element.id, {
        importAmbiguity: { ...ambiguity, status: "acknowledged" },
      });
      return;
    }
    const next: Partial<ServicePlanElement> = {};
    const resolvedParts = ambiguity.parts.map((part, index) => ({
      ...part,
      destination: (destinationsByPart[`${active.element.id}:${index}`] || part.destination) as typeof part.destination,
    }));
    const names = new Set((active.element.assignees || []).map((assignee) => assignee.name?.toLocaleLowerCase()));
    const newNames = resolvedParts.filter((part) => part.destination === "assignee" && !names.has(part.value.toLocaleLowerCase())).map((part) => part.value);
    if (newNames.length) next.assignees = [
      ...(active.element.assignees || []),
      ...newNames.map((name) => ({ id: generateRandomId(), name })),
    ];

    const scriptures = getServicePlanElementScriptureRefs(active.element);
    const scriptureKeys = new Set(scriptures.map((ref) => `${ref.book}|${ref.chapter}|${ref.verseRange}|${ref.version}`.toLowerCase()));
    const newScriptures = resolvedParts.flatMap((part) => {
      if (part.destination !== "scripture") return [];
      const ref = parseBibleReference(part.value);
      const key = ref ? `${ref.book}|${ref.chapter}|${ref.verseRange}|${ref.version}`.toLowerCase() : "";
      if (!ref || scriptureKeys.has(key)) return [];
      scriptureKeys.add(key);
      return [{
        id: generateRandomId(),
        label: getBibleImportDisplayName(ref, ref.version),
        book: ref.book,
        chapter: ref.chapter,
        verseRange: ref.verseRange,
        version: ref.version,
      }];
    });
    if (newScriptures.length) {
      next.scriptureRefs = [...scriptures, ...newScriptures];
      delete next.scriptureRef;
    }

    const links = resolvedParts.filter((part) => part.destination === "resource");
    if (links.length) {
      const existingUrls = new Set((active.element.resources || []).map((resource) => normalizedUrl(resource.url || "")));
      next.resources = [
        ...(active.element.resources || []),
        ...links.filter((part) => !existingUrls.has(normalizedUrl(part.value))).map((part) => {
          existingUrls.add(normalizedUrl(part.value));
          return createServicePlanLinkResource({ title: part.value, url: part.value });
        }),
      ];
    }

    const contentParts = resolvedParts.filter((part) => part.destination === "content");
    if (contentParts.length) {
      const resources = next.resources || active.element.resources || [];
      next.resources = [
        ...resources,
        ...contentParts
          .filter((part) => !resources.some((resource) =>
            resource.type === "text" &&
            resource.title === "Imported description" &&
            richTextToPlainText(getServicePlanResourceText(resource)) === part.value,
          ))
          .map((part) => createServicePlanTextResource({
            title: "Imported description",
            text: plainTextToRichText(part.value),
          })),
      ];
    }
    const descriptions = resolvedParts.filter((part) => part.destination === "notes").map((part) => part.value);
    if (descriptions.length) {
      const existing = richTextToPlainText(active.element.notes || plainTextToRichText(""));
      next.notes = multilineTextToRichText([existing, ...descriptions].filter(Boolean).join("\n"));
    }
    next.importAmbiguity = {
      ...ambiguity,
      parts: resolvedParts,
      reasons: [],
      status: "confirmed",
    };
    onResolve(active.element.id, next);
  };

  return (
    <FloatingWindow title="Review imported item" onClose={onLater} defaultWidth={520} autoHeight>
      <div className="flex max-h-[80vh] min-h-0 flex-col">
        <div className="scrollbar-variable space-y-3 overflow-y-auto p-4">
          <div>
            <h3 className="truncate text-sm font-semibold text-gray-100">{(active.element.title && richTextToPlainText(active.element.title)) || "Untitled"}</h3>
            <p className="text-xs text-gray-400">{active.section.name}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-gray-500">Element type</dt><dd className="break-words text-gray-200">{ambiguity.sourceElementType || "—"}</dd>
            <dt className="text-gray-500">Title</dt><dd className="break-words text-gray-200">{ambiguity.sourceTitle || "—"}</dd>
            <dt className="text-gray-500">Led By</dt><dd className="break-words text-gray-200">{ambiguity.sourceLedBy || "—"}</dd>
            <dt className="text-gray-500">Note</dt><dd className="break-words text-gray-200">{ambiguity.sourceNote || "—"}</dd>
          </dl>
          {ambiguity.reasons.map((reason) => <p key={reason} className="rounded-md bg-amber-950/40 px-3 py-2 text-xs text-amber-100">{reason}</p>)}
          <div className="space-y-2">
            {ambiguity.parts.map((part, index) => (
              <div key={`${part.kind}:${index}`} className="grid grid-cols-1 gap-2 rounded-md border border-gray-700 p-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase text-gray-500">{part.kind}</p>
                  <p className="break-words text-xs text-gray-100">{part.value}</p>
                </div>
                <Select
                  label={`Destination for ${part.kind} ${index + 1}`}
                  hideLabel
                  options={destinationsForPart(part.kind)}
                  value={destinationsByPart[`${active.element.id}:${index}`] || part.destination}
                  onChange={(value) => setDestinationsByPart((current) => ({ ...current, [`${active.element.id}:${index}`]: String(value) }))}
                />
              </div>
            ))}
            {!ambiguity.parts.length ? <p className="text-xs text-gray-400">The original text is preserved with this item.</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-700 px-4 py-3">
          <Button
            variant="secondary"
            onClick={() => onResolve(active.element.id, {
              importAmbiguity: { ...ambiguity, status: "deferred" },
            })}
          >Leave for later</Button>
          <Button variant="secondary" onClick={() => applyInterpretation(true)}>Acknowledge as-is</Button>
          <Button variant="cta" onClick={() => applyInterpretation(false)}>Confirm interpretation</Button>
        </div>
      </div>
    </FloatingWindow>
  );
};

export default ServicePlanAmbiguityReview;
