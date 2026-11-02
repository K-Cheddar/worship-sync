import ExpandCollapseChevronButton from "../ExpandCollapseChevronButton/ExpandCollapseChevronButton";
import type {
  NativeServicePlanOverlaySummary,
  OverlaySyncPlanItem,
} from "../../types/servicePlanningImport";
import cn from "classnames";

const OverlayPlanActionBadge = ({
  action,
  placementOnly,
}: {
  action: OverlaySyncPlanItem["action"];
  placementOnly?: boolean;
}) => {
  const tone =
    placementOnly
      ? "bg-zinc-800 text-zinc-300"
      : action === "update"
        ? "bg-green-900/50 text-green-300"
        : action === "clone"
          ? "bg-cyan-900/50 text-cyan-300"
          : action === "create"
            ? "bg-blue-900/40 text-blue-300"
            : "bg-red-900/40 text-red-300";
  const label =
    placementOnly
      ? "Found existing"
      : action === "update"
        ? "Update existing"
        : action === "clone"
          ? "Copy participant"
          : action === "create"
            ? "Create new"
            : "Skip";

  return (
    <span className={cn("rounded px-1 py-0.5 text-xs font-medium", tone)}>
      {label}
    </span>
  );
};

const OverlayFieldSummary = ({
  label,
  value,
}: {
  label: string;
  value?: string;
}) => (
  <span className="text-xs text-gray-300">
    <span className="text-gray-500">{label}:</span>{" "}
    {value?.trim() ? value : "—"}
  </span>
);

const getEmptyMessage = (summary?: NativeServicePlanOverlaySummary) => {
  if (summary?.status === "restricted") {
    return "Participant details are not available in this Controller session.";
  }
  if (summary?.status === "failed") {
    return "Participant details could not be loaded. Refresh the plan before syncing.";
  }
  if (summary?.selectedItemCount === 0 || summary?.assignedParticipantCount === 0) {
    return "No participants are assigned to this plan. Add people in Led by in Services to prepare participant overlays.";
  }
  return "No overlay changes are planned for this preview.";
};

const ServicePlanningOverlayPreview = ({
  items,
  expanded,
  onExpandedChange,
  nativeSummary,
}: {
  items: OverlaySyncPlanItem[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  nativeSummary?: NativeServicePlanOverlaySummary;
}) => {
  const updateCount = items.filter((item) => item.action === "update").length;
  const foundCount = items.filter((item) => item.placementOnly).length;
  const fieldUpdateCount = updateCount - foundCount;
  const cloneCount = items.filter((item) => item.action === "clone").length;
  const createCount = items.filter((item) => item.action === "create").length;
  const skipCount = items.filter((item) => item.action === "skip").length;

  return (
    <section className="rounded border border-gray-700 bg-gray-900/40" aria-label="Overlay preview">
      <div className="flex items-start gap-2 border-b border-gray-700 px-2 py-1.5">
        <ExpandCollapseChevronButton
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          expandLabel="Expand overlay preview"
          collapseLabel="Collapse overlay preview"
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div>
            <h3 className="text-xs font-semibold text-white">Overlay preview</h3>
            <p className="text-xs text-gray-400">
              Review names, titles, and overlay changes before syncing.
            </p>
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            <span className="rounded-full bg-green-900/40 px-1.5 py-0.5 text-green-300">
              {fieldUpdateCount} update{fieldUpdateCount === 1 ? "" : "s"}
            </span>
            {foundCount > 0 ? (
              <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                {foundCount} found
              </span>
            ) : null}
            {cloneCount > 0 ? (
              <span className="rounded-full bg-cyan-900/40 px-1.5 py-0.5 text-cyan-300">
                {cloneCount} clone{cloneCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {createCount > 0 ? (
              <span className="rounded-full bg-blue-900/30 px-1.5 py-0.5 text-blue-300">
                {createCount} create{createCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {skipCount > 0 ? (
              <span className="rounded-full bg-red-900/30 px-1.5 py-0.5 text-red-300">
                {skipCount} skip{skipCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {expanded ? (
        items.length === 0 ? (
          <div className="px-2 py-2 text-xs text-gray-400">
            {getEmptyMessage(nativeSummary)}
          </div>
        ) : (
          <ul className="divide-y divide-gray-800">
            {items.map((item, index) => (
              <li
                key={`${item.sectionName}-${item.sourceRowIndex}-${item.personIndex}-${index}`}
                className="space-y-0.5 px-2 py-1.5"
              >
                <div className="text-xs text-gray-400">
                  {item.sectionName ? `${item.sectionName} · ` : ""}
                  {item.title || "Untitled item"}
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <OverlayPlanActionBadge
                      action={item.action}
                      placementOnly={item.placementOnly}
                    />
                    <OverlayFieldSummary label="Name" value={item.patch.name} />
                    <OverlayFieldSummary label="Title" value={item.patch.title} />
                    <OverlayFieldSummary label="Event" value={item.patch.event} />
                  </div>
                  {item.action !== "skip" ? (
                    <div className="text-xs text-gray-400">
                      {item.placementOnly
                        ? "Matched overlay"
                        : item.action === "clone"
                        ? "Copy from"
                        : item.action === "create"
                          ? "Create"
                          : "Update"}{": "}
                      <span className="text-gray-200">
                        {item.targetOverlayName?.trim() ||
                          item.targetOverlayEvent?.trim() ||
                          (item.action === "create"
                            ? item.patch.event?.trim() || "Participant overlay"
                            : "Unnamed overlay")}
                      </span>
                    </div>
                  ) : null}
                </div>
                {item.resolutionNotice ? (
                  <p className="text-xs text-amber-200">{item.resolutionNotice}</p>
                ) : null}
                {item.action === "skip" && item.reason ? (
                  <p className="text-xs text-amber-200">{item.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
};

export default ServicePlanningOverlayPreview;
