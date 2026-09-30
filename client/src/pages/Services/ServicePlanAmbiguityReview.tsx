import { useState } from "react";
import FloatingWindow from "../../components/FloatingWindow/FloatingWindow";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import { richTextToPlainText } from "../../types/richText";
import type { ServicePlanElement, ServicePlanImportAmbiguity, ServicePlanSection } from "../../types/servicePlan";
import { applyReviewedServicePlanParts } from "./servicePlanImportOwnership";

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

const destinationsForPart = (kind: string, allowAssignee = false) => {
  const allowed = kind === "url"
    ? new Set(["resource", "content", "notes", "unassigned"])
    : kind === "person"
      ? new Set(["assignee", "content", "notes", "unassigned"])
      : kind === "scripture"
        ? new Set(["scripture", "content", "notes", "unassigned"])
        : new Set(["content", "notes", "unassigned"]);
  if (kind === "description" && allowAssignee) allowed.add("assignee");
  return destinations.filter((destination) => allowed.has(destination.value));
};

type ReviewWindowProps = Props & {
  batchTotal?: number;
  completedCount?: number;
};

const ServicePlanAmbiguityReview = ({
  sections,
  elementIds,
  prompt,
  onLater,
  onResolve,
  batchTotal,
  completedCount = 0,
}: ReviewWindowProps) => {
  const [showPrompt, setShowPrompt] = useState(prompt);
  const [destinationsByPart, setDestinationsByPart] = useState<Record<string, string>>({});
  const [songChoicesByMapping, setSongChoicesByMapping] = useState<Record<string, string>>({});
  const elements = sections.flatMap((section) => section.elements.map((element) => ({ section, element })));
  const selected = elementIds.flatMap((id) => {
    const found = elements.find(({ element }) => element.id === id);
    return found ? [found] : [];
  });
  const active = selected[0];
  const ambiguity = active?.element.importAmbiguity;
  const totalItems = Math.max(batchTotal || elementIds.length, 1);
  const currentItemNumber = Math.min(completedCount + 1, totalItems);
  const remainingCount = Math.max(elementIds.length - 1, 0);
  const hasMoreItems = remainingCount > 0;
  const floatingWindowProps = {
    title: "Review imported items",
    onClose: onLater,
    defaultWidth: 700,
    defaultHeight: 620,
    contentClassName: "p-0 !overflow-hidden",
  };

  if (showPrompt) {
    return (
      <FloatingWindow {...floatingWindowProps}>
        <div className="flex h-full flex-col justify-center gap-4 p-6">
          <div className="max-w-xl">
            <p className="text-base font-medium text-gray-100">{elementIds.length} imported {elementIds.length === 1 ? "item needs" : "items need"} a quick interpretation review.</p>
            <p className="mt-1 text-sm text-gray-400">Review each item in order. You can leave any item for later.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onLater}>Review later</Button>
            <Button variant="cta" onClick={() => setShowPrompt(false)}>Review items</Button>
          </div>
        </div>
      </FloatingWindow>
    );
  }

  if (!active || !ambiguity) return null;
  const titleMayBeAssignee = ambiguity.reasons.some((reason) =>
    reason.toLocaleLowerCase().includes("descriptive content or an assignee"),
  );
  const hasReviewChoices = ambiguity.parts.length > 0 || Boolean(ambiguity.songMappings?.length);
  const primaryActionLabel = hasReviewChoices
    ? hasMoreItems ? "Confirm & next" : "Confirm & finish"
    : hasMoreItems ? "Keep as imported & next" : "Keep as imported";

  const applyInterpretation = (acknowledge = false) => {
    if (acknowledge) {
      onResolve(active.element.id, {
        importAmbiguity: {
          ...ambiguity,
          songMappings: ambiguity.songMappings?.map((mapping) => ({ ...mapping, resolution: { kind: "keep" } })),
          status: "acknowledged",
        },
      });
      return;
    }
    const resolvedParts = ambiguity.parts.map((part, index) => ({
      ...part,
      destination: (destinationsByPart[`${active.element.id}:${index}`] || part.destination) as typeof part.destination,
    }));
    const reconciled = applyReviewedServicePlanParts(active.element, resolvedParts);
    const currentSongs = active.element.songRefs || (active.element.songRef ? [active.element.songRef] : []);
    const mappingKeys = new Map((ambiguity.songMappings || []).map((mapping, index) => [
      mapping,
      `${active.element.id}:${mapping.mappingId || JSON.stringify([mapping.sourceFingerprint, mapping.candidateOccurrenceIds, index])}`,
    ]));
    const nextSongs = currentSongs.map((song) => {
      const mapping = (ambiguity.songMappings || []).find((candidate) =>
        candidate.candidateOccurrenceIds.includes(song.id || "") &&
        songChoicesByMapping[mappingKeys.get(candidate)!] === song.id,
      );
      return mapping ? { ...mapping.incoming, ...(song.id ? { id: song.id } : {}) } : song;
    });
    const nextAmbiguity: ServicePlanImportAmbiguity = {
      ...ambiguity,
      parts: reconciled.parts,
      songMappings: ambiguity.songMappings?.map((mapping) => {
        const occurrenceId = songChoicesByMapping[mappingKeys.get(mapping)!];
        return {
          ...mapping,
          resolution: occurrenceId
            ? { kind: "replace", occurrenceId }
            : { kind: "keep" },
        };
      }),
      reasons: [],
      status: "confirmed",
      authorizationPending: false,
    };
    onResolve(active.element.id, {
      ...reconciled.element,
      ...(JSON.stringify(nextSongs) !== JSON.stringify(currentSongs) ? { songRefs: nextSongs } : {}),
      importAmbiguity: nextAmbiguity,
    });
  };

  return (
    <FloatingWindow {...floatingWindowProps}>
      <div className="flex h-full min-h-0 flex-col text-gray-100">
        <div className="shrink-0 border-b border-gray-700 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Item {currentItemNumber} of {totalItems}</p>
              <h3 className="mt-1 truncate text-base font-semibold text-gray-100">{(active.element.title && richTextToPlainText(active.element.title)) || "Untitled"}</h3>
              <p className="text-xs text-gray-400">{active.section.name}</p>
            </div>
            <p className="shrink-0 text-right text-xs text-gray-400">
              {remainingCount ? `${remainingCount} remaining` : "Final item"}
            </p>
          </div>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-700"
            role="progressbar"
            aria-label="Review progress"
            aria-valuemin={0}
            aria-valuemax={totalItems}
            aria-valuenow={currentItemNumber}
          >
            <div className="h-full rounded-full bg-cyan-400 transition-[width]" style={{ width: `${(currentItemNumber / totalItems) * 100}%` }} />
          </div>
        </div>

        <div className="scrollbar-variable min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-gray-500">Element type</dt><dd className="break-words text-gray-200">{ambiguity.sourceElementType || "—"}</dd>
            <dt className="text-gray-500">Title</dt><dd className="break-words text-gray-200">{ambiguity.sourceTitle || "—"}</dd>
            <dt className="text-gray-500">Led By</dt><dd className="break-words text-gray-200">{ambiguity.sourceLedBy || "—"}</dd>
            <dt className="text-gray-500">Note</dt><dd className="break-words text-gray-200">{ambiguity.sourceNote || "—"}</dd>
          </dl>
          {ambiguity.reasons.map((reason) => <p key={reason} className="rounded-md bg-amber-950/40 px-3 py-2 text-xs text-amber-100">{reason}</p>)}
          {hasReviewChoices ? (
            <div className="space-y-2">
              {ambiguity.parts.map((part, index) => (
                <div key={`${part.kind}:${index}`} className="grid grid-cols-1 gap-2 rounded-md border border-gray-700 p-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase text-gray-500">{part.kind === "description" && titleMayBeAssignee ? "Ambiguous title" : part.kind}</p>
                    <p className="break-words text-xs text-gray-100">{part.value}</p>
                  </div>
                  <Select
                    label={`Destination for ${part.kind === "description" && titleMayBeAssignee ? "ambiguous title" : part.kind} ${index + 1}`}
                    hideLabel
                    options={destinationsForPart(part.kind, titleMayBeAssignee)}
                    value={destinationsByPart[`${active.element.id}:${index}`] || part.destination}
                    onChange={(value) => setDestinationsByPart((current) => ({ ...current, [`${active.element.id}:${index}`]: String(value) }))}
                  />
                </div>
              ))}
              {(ambiguity.songMappings || []).map((mapping, index) => {
                const mappingKey = `${active.element.id}:${mapping.mappingId || JSON.stringify([mapping.sourceFingerprint, mapping.candidateOccurrenceIds, index])}`;
                const currentSongs = active.element.songRefs || (active.element.songRef ? [active.element.songRef] : []);
                const choices = currentSongs.filter((song) => mapping.candidateOccurrenceIds.includes(song.id || ""));
                return (
                  <div key={mappingKey} className="space-y-2 rounded-md border border-amber-700/60 bg-amber-950/20 p-3">
                    <p className="text-xs text-amber-100">
                      “{mapping.incoming.title}” could match several linked songs. Keep the current links, or choose one occurrence to replace with the incoming song.
                    </p>
                    <Select
                      label={`Song mapping for ${mapping.incoming.title}`}
                      options={[
                        { value: "", label: "Keep existing linked songs" },
                        ...choices.map((song) => ({
                          value: song.id || "",
                          label: `${song.kind === "library" ? song.songName : song.title}${song.kind === "library" && song.key ? ` · ${song.key}` : ""}`,
                        })),
                      ]}
                      value={songChoicesByMapping[mappingKey] || ""}
                      onChange={(value) => setSongChoicesByMapping((current) => ({ ...current, [mappingKey]: String(value) }))}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-gray-700 bg-gray-900/50 p-3">
              <p className="text-sm text-gray-200">No mapping is needed for this item.</p>
              <p className="mt-1 text-xs text-gray-400">The source information and text will stay as imported.</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-gray-700 px-4 py-3">
          <Button
            variant="secondary"
            onClick={() => onResolve(active.element.id, {
              importAmbiguity: { ...ambiguity, status: "deferred" },
            })}
          >Leave for later</Button>
          {hasReviewChoices ? <Button variant="secondary" onClick={() => applyInterpretation(true)}>Acknowledge as-is</Button> : null}
          <Button variant="cta" onClick={() => applyInterpretation(!hasReviewChoices)}>{primaryActionLabel}</Button>
        </div>
      </div>
    </FloatingWindow>
  );
};

export default ServicePlanAmbiguityReview;
