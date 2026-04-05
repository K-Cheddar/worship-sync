import Button from "../../components/Button/Button";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import { DisplayType, LinkType, QuickLinkType, TimerInfo } from "../../types";
import { Trash2 } from "lucide-react";
import cn from "classnames";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import QuickLinkButton from "./QuickLinkButton";
import { useToast } from "../../context/toastContext";
import QuickLinkSelection from "./QuickLinkSelection";
import { useSelector } from "../../hooks";
import { mergeStoredPresentationWithLiveOverlay } from "../../utils/quickLinkOverlayPresentation";

const baseImgUrl =
  "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds";

const baseLinkTypeOptions = [
  { label: "Media", value: "media" },
  { label: "Slide", value: "slide" },
  { label: "Overlay", value: "overlay" },
];

/** Debounce Redux updates so typing the label does not rerender the whole tree every keystroke. */
const LABEL_COMMIT_DEBOUNCE_MS = 300;

type QuickLinkProps = QuickLinkType & {
  removeQuickLink: () => void;
  updateQuickLink: (key: keyof QuickLinkType, value: any) => void;
  isMobile?: boolean;
  isSelected: boolean;
  setSelectedQuickLink: () => void;
  timers: TimerInfo[];
  index: number;
  /** Overlay stream-only drawer: display type is always stream. */
  hideDisplayTypeSelect?: boolean;
  /** Drag handle and sortable wiring from parent when reordering is enabled. */
  dragHandle?: ReactNode;
  listItemRef?: Ref<HTMLLIElement>;
  sortableStyle?: CSSProperties;
};

const QuickLink = ({
  canDelete,
  displayType,
  label,
  presentationInfo,
  updateQuickLink,
  removeQuickLink,
  index,
  isMobile,
  isSelected,
  setSelectedQuickLink: setSelectedQuickLinkProp,
  linkType: _linkType,
  timers,
  id,
  hideDisplayTypeSelect = false,
  dragHandle,
  listItemRef,
  sortableStyle,
}: QuickLinkProps) => {
  const { showToast } = useToast();

  const overlaysList = useSelector(
    (state) => state.undoable.present.overlays.list
  );

  const resolvedPresentation = useMemo(
    () => mergeStoredPresentationWithLiveOverlay(presentationInfo, overlaysList),
    [presentationInfo, overlaysList]
  );

  const [labelDraft, setLabelDraft] = useState(() => label ?? "");
  const labelDraftRef = useRef(labelDraft);
  labelDraftRef.current = labelDraft;

  /** Last value we committed to Redux from debounce/blur (avoids clobbering draft when Redux lags typing). */
  const lastCommittedLabelRef = useRef(label ?? "");

  const updateQuickLinkRef = useRef(updateQuickLink);
  updateQuickLinkRef.current = updateQuickLink;

  const labelPropRef = useRef(label ?? "");
  labelPropRef.current = label ?? "";

  const labelCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    if (labelCommitTimeoutRef.current) {
      clearTimeout(labelCommitTimeoutRef.current);
      labelCommitTimeoutRef.current = null;
    }
    const incoming = label ?? "";
    setLabelDraft((prev) => {
      if (incoming === prev) return prev;
      if (
        incoming === lastCommittedLabelRef.current &&
        prev.length > incoming.length &&
        prev.startsWith(incoming)
      ) {
        return prev;
      }
      lastCommittedLabelRef.current = incoming;
      return incoming;
    });
  }, [label, id]);

  useEffect(() => {
    return () => {
      if (labelCommitTimeoutRef.current) {
        clearTimeout(labelCommitTimeoutRef.current);
        labelCommitTimeoutRef.current = null;
      }
      const draft = labelDraftRef.current;
      const committed = labelPropRef.current;
      if (draft !== committed) {
        updateQuickLinkRef.current("label", draft);
      }
    };
  }, []);

  const scheduleLabelCommit = (next: string) => {
    if (labelCommitTimeoutRef.current) {
      clearTimeout(labelCommitTimeoutRef.current);
    }
    labelCommitTimeoutRef.current = setTimeout(() => {
      labelCommitTimeoutRef.current = null;
      lastCommittedLabelRef.current = next;
      updateQuickLinkRef.current("label", next);
    }, LABEL_COMMIT_DEBOUNCE_MS);
  };

  const handleLabelChange = (val: string) => {
    setLabelDraft(val);
    scheduleLabelCommit(val);
  };

  const handleLabelBlur = () => {
    if (labelCommitTimeoutRef.current) {
      clearTimeout(labelCommitTimeoutRef.current);
      labelCommitTimeoutRef.current = null;
    }
    const next = labelDraftRef.current;
    const committed = label ?? "";
    if (next !== committed) {
      lastCommittedLabelRef.current = next;
      updateQuickLink("label", next);
    }
  };

  const [linkType, setLinkType] = useState<LinkType>(() => {
    if (displayType === "projector") {
      return _linkType || "media";
    }
    if (displayType === "monitor") {
      return _linkType || "slide";
    }
    if (displayType === "stream") {
      return _linkType || "overlay";
    }
    return "media";
  });

  const linkTypeOptions = useMemo(() => {
    if (displayType === "projector") {
      return [baseLinkTypeOptions[0], baseLinkTypeOptions[1]];
    }
    if (displayType === "monitor") {
      return [baseLinkTypeOptions[1]];
    }
    if (displayType === "stream") {
      return [baseLinkTypeOptions[1], baseLinkTypeOptions[2]];
    }
    return baseLinkTypeOptions;
  }, [displayType]);

  const timerInfoForDisplay = useMemo(() => {
    if (_linkType === "slide") {
      return timers.find((t) => t.id === presentationInfo?.timerId);
    }
    return undefined;
  }, [timers, presentationInfo, _linkType]);

  const handleQuickLinkButtonClick = () => {
    setSelectedQuickLinkProp();

    if (linkType === "slide") {
      showToast({
        message: "Select a slide to link",
        variant: "neutral",
        persist: true,
        children: (toastId) => (
          <QuickLinkSelection
            linkType="slide"
            quickLinkId={id}
            isMobile={isMobile}
            toastId={toastId}
            displayType={displayType}
          />
        ),
      });
    } else if (linkType === "overlay") {
      showToast({
        message: "Select an overlay to link",
        variant: "neutral",
        persist: true,
        children: (toastId) => (
          <QuickLinkSelection
            linkType="overlay"
            quickLinkId={id}
            isMobile={isMobile}
            toastId={toastId}
            displayType={displayType}
          />
        ),
      });
    }
  };

  return (
    <li
      ref={listItemRef}
      style={sortableStyle}
      className={cn(
        "flex gap-4 items-center justify-around flex-wrap border-b-2 border-gray-400 p-2 max-lg:pb-6 rounded-md",
        index % 2 === 0 && "bg-gray-600"
      )}
      id={`quick-link-${id}`}
    >
      {dragHandle}
      {!hideDisplayTypeSelect && (
        <Select
          className="flex flex-col"
          selectClassName="bg-gray-900"
          textColor="text-white"
          label="Display Type"
          disabled={!canDelete}
          options={[
            {
              label: "Projector",
              value: "projector",
            },
            {
              label: "Monitor",
              value: "monitor",
            },
            {
              label: "Stream",
              value: "stream",
            },
          ]}
          value={displayType || "projector"}
          onChange={(val) => updateQuickLink("displayType", val as DisplayType)}
        />
      )}
      <Input
        label="Label"
        type="text"
        className="w-32"
        value={labelDraft}
        onChange={(val) => handleLabelChange(val as string)}
        onBlur={handleLabelBlur}
        disabled={!canDelete}
      />
      <Select
        className="flex flex-col"
        label="Type"
        options={linkTypeOptions}
        value={linkType}
        onChange={(val) => {
          setLinkType(val as LinkType);
          updateQuickLink("linkType", val as LinkType);
        }}
      />

      {linkType === "media" && (
        <QuickLinkButton
          title="Media"
          content={
            presentationInfo?.slide?.boxes[0]?.background?.replace(
              baseImgUrl,
              ""
            ) || ""
          }
          helpText="Click to select media."
          selectedText="Now right click media and click set."
          isSelected={isSelected}
          onClick={setSelectedQuickLinkProp}
        />
      )}

      {linkType === "slide" && (
        <QuickLinkButton
          title="Slide"
          content={resolvedPresentation?.name || ""}
          helpText="Click to select slide from item."
          selectedText="Now select a slide and click select."
          isSelected={isSelected}
          onClick={handleQuickLinkButtonClick}
        />
      )}

      {linkType === "overlay" && (
        <QuickLinkButton
          title="Overlay"
          content={resolvedPresentation?.name || ""}
          helpText="Click to select overlay."
          selectedText="Now select an overlay and click select."
          isSelected={isSelected}
          onClick={handleQuickLinkButtonClick}
        />
      )}

      <section className="flex flex-col gap-2 items-center">
        <p className="font-semibold">Presentation:</p>
        <DisplayWindow
          displayType={displayType}
          showBorder
          width={isMobile ? 24 : 12}
          boxes={resolvedPresentation?.slide?.boxes}
          bibleDisplayInfo={resolvedPresentation?.bibleDisplayInfo}
          participantOverlayInfo={resolvedPresentation?.participantOverlayInfo}
          stbOverlayInfo={resolvedPresentation?.stbOverlayInfo}
          qrCodeOverlayInfo={resolvedPresentation?.qrCodeOverlayInfo}
          imageOverlayInfo={resolvedPresentation?.imageOverlayInfo}
          timerInfo={timerInfoForDisplay}
        />
      </section>
      {canDelete && (
        <Button
          variant="tertiary"
          iconSize="lg"
          svg={Trash2}
          color="red"
          onClick={removeQuickLink}
        />
      )}
    </li>
  );
};

export default QuickLink;
