import { useContext, useState } from "react";
import { ChevronDown } from "lucide-react";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useSelector } from "../../hooks";
import type { ServiceItem } from "../../types";
import type { ServicePlan } from "../../types/servicePlan";
import { useServicePlanSongLibrary } from "../Services/useServicePlanSongLibrary";
import { planServicePlanOutlineItems } from "../Services/servicePlanOutlineBridge";

const EMPTY_OUTLINE: ServiceItem[] = [];

const ServicePlanOutlinePreview = ({ plan }: { plan: ServicePlan }) => {
  const [expanded, setExpanded] = useState(false);
  const { churchIntegrations } = useContext(GlobalInfoContext) || {};
  const { songs } = useServicePlanSongLibrary();
  const currentList = useSelector((state) => state.undoable?.present?.itemList?.list ?? EMPTY_OUTLINE);
  const customDocuments = useSelector((state) => state.allDocs.allFreeFormDocs);
  const { previewEntries } = planServicePlanOutlineItems({
    plan, currentList, songs, customDocuments,
    sectionRules: churchIntegrations?.servicePlanning?.sectionRules,
  });
  return (
    <section className="rounded border border-zinc-700 text-xs" aria-label="Outline preview">
      <button type="button" aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-zinc-200 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-cyan-400"
        onClick={() => setExpanded((value) => !value)}>
        <ChevronDown aria-hidden className={`size-3.5 ${expanded ? "rotate-180" : ""}`} />
        <span>Outline preview</span>
        <span className="ml-auto text-zinc-400">
          {previewEntries.filter((entry) => entry.status === "ready").length} ready to add
        </span>
      </button>
      {expanded ? <div className="space-y-2 px-2 pb-2">
        {!previewEntries.length ? <p className="text-zinc-400">No outline attachments in this plan.</p> : null}
        {plan.sections.map((section) => {
          const entries = previewEntries.filter((entry) => entry.sectionId === section.id);
          if (!entries.length) return null;
          return <div key={section.id}>
            <h3 className="font-semibold text-zinc-300">{section.name}</h3>
            <ul className="space-y-1 text-zinc-400">{entries.map((entry, index) => (
              <li key={`${entry.listId}:${index}`}>
                <span className="text-zinc-200">{entry.title}</span>{": "}
                {entry.status === "already-present" ? "Already in outline"
                  : entry.status === "unresolved" ? "Unresolved attachment. Review in Services."
                    : `Ready to add: ${entry.destination?.kind === "heading" ? entry.destination.name : "End of outline"}`}
                {entry.status === "ready" && entry.placementFallback
                  ? <span className="text-amber-300">{`. Mapped heading "${entry.placementFallback.headingName}" is missing`}</span>
                  : null}
              </li>
            ))}</ul>
          </div>;
        })}
      </div> : null}
    </section>
  );
};

export default ServicePlanOutlinePreview;
