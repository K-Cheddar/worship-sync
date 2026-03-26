import { useSelector, useDispatch } from "../../hooks";
import { DisplayType, LinkType, Option, QuickLinkType } from "../../types";
import { Plus } from "lucide-react";
import generateRandomId from "../../utils/generateRandomId";
import Select from "../../components/Select/Select";
import Button from "../../components/Button/Button";
import { useMemo, useContext } from "react";
import {
  setQuickLinks,
  setSelectedQuickLink,
} from "../../store/preferencesSlice";
import { useState } from "react";
import QuickLink from "./QuickLink";
import { ControllerInfoContext } from "../../context/controllerInfo";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";

const maxQuickLinks = 12;

type QuickLinksProps = {
  /** Overlay controller: manage stream quick links only. */
  streamOnly?: boolean;
};

const QuickLinks = ({ streamOnly = false }: QuickLinksProps) => {
  const dispatch = useDispatch();
  const { quickLinks, selectedQuickLink } = useSelector(
    (state) => state.undoable.present.preferences
  );

  const { timers } = useSelector((state) => state.timers);

  const { isMobile } = useContext(ControllerInfoContext) || {};

  const [newQuickLinkDisplayType, setNewQuickLinkDisplayType] =
    useState<DisplayType>(streamOnly ? "stream" : "projector");

  const projectorQuickLinks = quickLinks.filter(
    (ql) => ql.displayType === "projector"
  );
  const monitorQuickLinks = quickLinks.filter(
    (ql) => ql.displayType === "monitor"
  );
  const streamQuickLinks = quickLinks.filter(
    (ql) => ql.displayType === "stream"
  );
  const visibleQuickLinks = streamOnly
    ? streamQuickLinks
    : [...projectorQuickLinks, ...monitorQuickLinks, ...streamQuickLinks];

  const newQuickLinkOptions = useMemo(() => {
    const options: Option[] = [];
    if (streamOnly) {
      if (streamQuickLinks.length < maxQuickLinks) {
        options.push({ label: "Stream", value: "stream" });
      }
      return options;
    }
    if (projectorQuickLinks.length < maxQuickLinks) {
      options.push({ label: "Projector", value: "projector" });
    }
    if (monitorQuickLinks.length < maxQuickLinks) {
      options.push({ label: "Monitor", value: "monitor" });
    }
    if (streamQuickLinks.length < maxQuickLinks) {
      options.push({ label: "Stream", value: "stream" });
    }
    return options;
  }, [
    streamOnly,
    projectorQuickLinks.length,
    monitorQuickLinks.length,
    streamQuickLinks.length,
  ]);

  const updateQuickLink = (
    id: string,
    key: keyof QuickLinkType,
    value: any
  ) => {
    dispatch(
      setQuickLinks(
        quickLinks.map((ql) => (ql.id === id ? { ...ql, [key]: value } : ql))
      )
    );
  };

  const updateNewQuickLinkDisplayType = (
    updatedQuickLinks: QuickLinkType[]
  ) => {
    if (streamOnly) {
      setNewQuickLinkDisplayType("stream");
      return;
    }

    let newDisplayType = newQuickLinkDisplayType;

    const nextProjector = updatedQuickLinks.filter(
      (ql) => ql.displayType === "projector"
    );
    const nextMonitor = updatedQuickLinks.filter(
      (ql) => ql.displayType === "monitor"
    );
    const nextStream = updatedQuickLinks.filter(
      (ql) => ql.displayType === "stream"
    );

    if (
      nextProjector.length < maxQuickLinks &&
      nextMonitor.length === maxQuickLinks &&
      nextStream.length === maxQuickLinks
    ) {
      newDisplayType = "projector";
    }
    if (
      nextProjector.length === maxQuickLinks &&
      nextMonitor.length < maxQuickLinks &&
      nextStream.length === maxQuickLinks
    ) {
      newDisplayType = "monitor";
    }
    if (
      nextProjector.length === maxQuickLinks &&
      nextMonitor.length === maxQuickLinks &&
      nextStream.length < maxQuickLinks
    ) {
      newDisplayType = "stream";
    }

    setNewQuickLinkDisplayType(newDisplayType);
  };

  return (
    <ErrorBoundary>
      <ul className="flex flex-col gap-6 items-center max-lg:gap-12">
        {visibleQuickLinks.map((quickLinkInfo, index) => {
          const { id } = quickLinkInfo;
          return (
            <QuickLink
              timers={timers}
              key={id}
              index={index}
              isSelected={selectedQuickLink?.id === id}
              setSelectedQuickLink={() => dispatch(setSelectedQuickLink(id))}
              isMobile={isMobile}
              hideDisplayTypeSelect={streamOnly}
              updateQuickLink={(key, value) => updateQuickLink(id, key, value)}
              removeQuickLink={() => {
                const updatedQuickLinks = quickLinks.filter(
                  (ql) => ql.id !== id
                );
                dispatch(setQuickLinks(updatedQuickLinks));
                updateNewQuickLinkDisplayType(updatedQuickLinks);
              }}
              {...quickLinkInfo}
            />
          );
        })}
      </ul>
      {newQuickLinkOptions.length > 0 ? (
        <section className="flex items-center justify-center gap-4 my-8">
          {!streamOnly && (
            <Select
              className="flex gap-2"
              selectClassName="bg-gray-900"
              textColor="text-white"
              label="New Quick Link Display Type"
              options={newQuickLinkOptions}
              value={newQuickLinkDisplayType}
              onChange={(val) => setNewQuickLinkDisplayType(val as DisplayType)}
            />
          )}
          <Button
            variant="primary"
            padding="px-4 py-1"
            svg={Plus}
            onClick={() => {
              const displayType = streamOnly ? "stream" : newQuickLinkDisplayType;
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
                  linkType,
                },
              ];
              dispatch(setQuickLinks(updatedQuickLinks));
              updateNewQuickLinkDisplayType(updatedQuickLinks);
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
