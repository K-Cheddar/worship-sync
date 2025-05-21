import { useSelector, useDispatch } from "../../hooks";
import { DisplayType, LinkType, Option, QuickLinkType } from "../../types";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
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

const QuickLinks = () => {
  const dispatch = useDispatch();
  const { quickLinks, selectedQuickLink } = useSelector(
    (state) => state.undoable.present.preferences
  );

  const { timers } = useSelector((state) => state.timers);

  const { isMobile } = useContext(ControllerInfoContext) || {};

  const [newQuickLinkDisplayType, setNewQuickLinkDisplayType] =
    useState<DisplayType>("projector");

  const projectorQuickLinks = quickLinks.filter(
    (ql) => ql.displayType === "projector"
  );
  const monitorQuickLinks = quickLinks.filter(
    (ql) => ql.displayType === "monitor"
  );
  const streamQuickLinks = quickLinks.filter(
    (ql) => ql.displayType === "stream"
  );

  const newQuickLinkOptions = useMemo(() => {
    const options: Option[] = [];
    if (projectorQuickLinks.length < 3) {
      options.push({ label: "Projector", value: "projector" });
    }
    if (monitorQuickLinks.length < 3) {
      options.push({ label: "Monitor", value: "monitor" });
    }
    if (streamQuickLinks.length < 3) {
      options.push({ label: "Stream", value: "stream" });
    }
    return options;
  }, [projectorQuickLinks, monitorQuickLinks, streamQuickLinks]);

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
    let newDisplayType = newQuickLinkDisplayType;

    const projectorQuickLinks = updatedQuickLinks.filter(
      (ql) => ql.displayType === "projector"
    );
    const monitorQuickLinks = updatedQuickLinks.filter(
      (ql) => ql.displayType === "monitor"
    );
    const streamQuickLinks = updatedQuickLinks.filter(
      (ql) => ql.displayType === "stream"
    );

    if (
      projectorQuickLinks.length < 3 &&
      monitorQuickLinks.length === 3 &&
      streamQuickLinks.length === 3
    ) {
      newDisplayType = "projector";
    }
    if (
      projectorQuickLinks.length === 3 &&
      monitorQuickLinks.length < 3 &&
      streamQuickLinks.length === 3
    ) {
      newDisplayType = "monitor";
    }
    if (
      projectorQuickLinks.length === 3 &&
      monitorQuickLinks.length === 3 &&
      streamQuickLinks.length < 3
    ) {
      newDisplayType = "stream";
    }

    setNewQuickLinkDisplayType(newDisplayType);
  };

  return (
    <>
      <h2 className="text-lg font-semibold text-center mb-4 mt-8 border-b-2 border-gray-400 pb-2">
        Quick Links
      </h2>
      <ul className="flex flex-col gap-6 items-center max-lg:gap-12">
        {[
          ...projectorQuickLinks,
          ...monitorQuickLinks,
          ...streamQuickLinks,
        ].map((quickLinkInfo) => {
          const { id } = quickLinkInfo;
          return (
            <QuickLink
              timers={timers}
              key={id}
              isSelected={selectedQuickLink?.id === id}
              setSelectedQuickLink={() => dispatch(setSelectedQuickLink(id))}
              isMobile={isMobile}
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
      <section className="flex items-center justify-center gap-4 mt-4">
        {newQuickLinkOptions.length > 0 ? (
          <>
            <Select
              label="New Quick Link Display Type"
              options={newQuickLinkOptions}
              value={newQuickLinkDisplayType}
              onChange={(val) => setNewQuickLinkDisplayType(val as DisplayType)}
            />
            <Button
              variant="primary"
              svg={AddSVG}
              onClick={() => {
                let linkType: LinkType = "image";
                if (newQuickLinkDisplayType === "monitor") {
                  linkType = "slide";
                }
                if (newQuickLinkDisplayType === "stream") {
                  linkType = "overlay";
                }
                const updatedQuickLinks = [
                  ...quickLinks,
                  {
                    id: generateRandomId(),
                    label: "",
                    canDelete: true,
                    displayType: newQuickLinkDisplayType,
                    linkType,
                  },
                ];
                dispatch(setQuickLinks(updatedQuickLinks));
                updateNewQuickLinkDisplayType(updatedQuickLinks);
              }}
            >
              Add Quick Link
            </Button>
          </>
        ) : (
          <p className="text-center">Max Quick Links Reached</p>
        )}
      </section>
    </>
  );
};

export default QuickLinks;
