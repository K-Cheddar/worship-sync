import { useSelector, useDispatch } from "../../hooks";
import { DisplayType, LinkType, Option, QuickLinkType } from "../../types";
import { Plus } from "lucide-react";
import generateRandomId from "../../utils/generateRandomId";
import Select from "../../components/Select/Select";
import Button from "../../components/Button/Button";
import { useCallback, useContext, useMemo, useState } from "react";
import {
  setQuickLinks,
  setSelectedQuickLink,
} from "../../store/preferencesSlice";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSensors } from "../../utils/dndUtils";
import { applyQuickLinkReorder } from "../../utils/quickLinksReorder";
import SortableQuickLink from "./SortableQuickLink";
import { ControllerInfoContext } from "../../context/controllerInfo";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { isPushOutputType } from "../../utils/displayOutputs";
import { isQuickLinkForOutput } from "../../utils/quickLinksForOutput";

const maxQuickLinks = 12;

type QuickLinksProps = {
  /** Overlay controller: manage stream quick links only. */
  streamOnly?: boolean;
};

const QuickLinks = ({ streamOnly = false }: QuickLinksProps) => {
  const dispatch = useDispatch();
  const { quickLinks, selectedQuickLink } = useSelector(
    (state) => state.undoable.present.preferences,
  );

  const { timers } = useSelector((state) => state.timers);

  const { isMobile } = useContext(ControllerInfoContext) || {};

  // Quick links belong to a display, so authoring targets one by name. The
  // overlay drawer still scopes itself to stream-type displays.
  const displayOutputs = useSelector(selectDisplayOutputs);
  const authorableOutputs = useMemo(
    () =>
      displayOutputs.filter(
        (output) =>
          output.enabled &&
          isPushOutputType(output.type) &&
          (!streamOnly || output.type === "stream"),
      ),
    [displayOutputs, streamOnly],
  );
  const [newQuickLinkOutputId, setNewQuickLinkOutputId] = useState("");
  const activeOutputId =
    newQuickLinkOutputId || authorableOutputs[0]?.id || "projector";

  const linksForOutput = useCallback(
    (outputId: string) => {
      const output = displayOutputs.find((item) => item.id === outputId);
      return output
        ? quickLinks.filter((link) => isQuickLinkForOutput(link, output))
        : [];
    },
    [displayOutputs, quickLinks],
  );
  const visibleQuickLinks = useMemo(
    () =>
      authorableOutputs.flatMap((output) =>
        quickLinks.filter((link) => isQuickLinkForOutput(link, output)),
      ),
    [authorableOutputs, quickLinks],
  );

  const newQuickLinkOptions: Option[] = useMemo(
    () =>
      authorableOutputs
        .filter((output) => linksForOutput(output.id).length < maxQuickLinks)
        .map((output) => ({ label: output.name, value: output.id })),
    [authorableOutputs, linksForOutput],
  );

  const updateQuickLink = (
    id: string,
    keyOrPatch: keyof QuickLinkType | Partial<QuickLinkType>,
    value?: any,
  ) => {
    const patch =
      typeof keyOrPatch === "string" ? { [keyOrPatch]: value } : keyOrPatch;
    dispatch(
      setQuickLinks(
        quickLinks.map((ql) => (ql.id === id ? { ...ql, ...patch } : ql)),
      ),
    );
  };

  /** Move authoring to a display that still has room, after an add or remove. */
  const updateNewQuickLinkOutput = (updatedQuickLinks: QuickLinkType[]) => {
    const stillHasRoom = (outputId: string) => {
      const output = displayOutputs.find((item) => item.id === outputId);
      if (!output) return false;
      return (
        updatedQuickLinks.filter((link) => isQuickLinkForOutput(link, output))
          .length < maxQuickLinks
      );
    };
    if (stillHasRoom(activeOutputId)) return;
    const next = authorableOutputs.find((output) => stillHasRoom(output.id));
    setNewQuickLinkOutputId(next?.id ?? "");
  };

  const sensors = useSensors();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const next = applyQuickLinkReorder(
        quickLinks,
        streamOnly,
        String(active.id),
        String(over.id),
      );
      if (next) {
        dispatch(setQuickLinks(next));
      }
    },
    [dispatch, quickLinks, streamOnly],
  );

  return (
    <ErrorBoundary>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <ul className="flex flex-col gap-6 items-center max-lg:gap-12">
          <SortableContext
            items={visibleQuickLinks.map((q) => q.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleQuickLinks.map((quickLinkInfo, index) => {
              const { id } = quickLinkInfo;
              return (
                <SortableQuickLink
                  timers={timers}
                  key={id}
                  index={index}
                  isSelected={selectedQuickLink?.id === id}
                  setSelectedQuickLink={() =>
                    dispatch(setSelectedQuickLink(id))
                  }
                  isMobile={isMobile}
                  hideDisplayTypeSelect={streamOnly}
                  updateQuickLink={(keyOrPatch, value) =>
                    updateQuickLink(id, keyOrPatch, value)
                  }
                  removeQuickLink={() => {
                    const updatedQuickLinks = quickLinks.filter(
                      (ql) => ql.id !== id,
                    );
                    dispatch(setQuickLinks(updatedQuickLinks));
                    updateNewQuickLinkOutput(updatedQuickLinks);
                  }}
                  {...quickLinkInfo}
                />
              );
            })}
          </SortableContext>
        </ul>
      </DndContext>
      {newQuickLinkOptions.length > 0 ? (
        <section className="flex items-center justify-center gap-4 my-8">
          {!streamOnly && (
            <Select
              className="flex gap-2"
              selectClassName="bg-gray-900"
              textColor="text-white"
              label="New Quick Link Display"
              options={newQuickLinkOptions}
              value={activeOutputId}
              onChange={setNewQuickLinkOutputId}
            />
          )}
          <Button
            variant="primary"
            padding="px-4 py-1"
            svg={Plus}
            onClick={() => {
              const targetOutput =
                authorableOutputs.find(
                  (output) => output.id === activeOutputId,
                ) ?? authorableOutputs[0];
              if (!targetOutput) return;
              const displayType = targetOutput.type as DisplayType;
              let linkType: LinkType = "media";
              if (displayType === "monitor") {
                linkType = "slide";
              }
              if (displayType === "stream") {
                linkType = "overlay";
              }
              const updatedQuickLinks = [
                ...quickLinks,
                {
                  id: generateRandomId(),
                  label: "",
                  canDelete: true,
                  displayType,
                  outputId: targetOutput.id,
                  linkType,
                },
              ];
              dispatch(setQuickLinks(updatedQuickLinks));
              updateNewQuickLinkOutput(updatedQuickLinks);
            }}
          >
            Add Quick Link
          </Button>
        </section>
      ) : (
        <p className="text-center">Max Quick Links Reached</p>
      )}
    </ErrorBoundary>
  );
};

export default QuickLinks;
