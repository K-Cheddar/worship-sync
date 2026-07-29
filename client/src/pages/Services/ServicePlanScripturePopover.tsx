import { useMemo, useState, type ReactNode } from "react";
import { BookOpen, Plus } from "lucide-react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { bibleVersions } from "../../utils/bibleVersions";
import { parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";
import type { ServicePlanScriptureReference } from "../../types/servicePlan";

const DEFAULT_VERSION = "niv";
const FIELD_LABEL_CLASS = "text-neutral-100";

export const SERVICE_PLAN_SCRIPTURE_ICON_CLASS = "text-orange-300";

type ServicePlanScripturePopoverProps = {
  disabled?: boolean;
  onSelect: (scriptureRef: ServicePlanScriptureReference) => void;
  /** Controlled open. When set, pair with `onOpenChange` and optionally `anchor`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * When provided (controlled mode), the built-in "Add scripture" trigger is
   * omitted and this node is used as the popover anchor — typically the row's
   * Add menu button.
   */
  anchor?: ReactNode;
};

/**
 * Compact popover to attach a scripture reference to a plan element.
 * Kept separate from the song library modal — scripture only needs a
 * reference + version, not a full library browser.
 *
 * Supports a standalone trigger (tests / legacy) or a controlled open state
 * anchored to a parent control (the element-row Add menu).
 */
const ServicePlanScripturePopover = ({
  disabled = false,
  onSelect,
  open: openProp,
  onOpenChange,
  anchor,
}: ServicePlanScripturePopoverProps) => {
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [reference, setReference] = useState("");
  const [version, setVersion] = useState(DEFAULT_VERSION);

  const parsedReference = useMemo(
    () => (reference.trim() ? parseBibleReference(reference.trim()) : null),
    [reference],
  );

  const reset = () => {
    setReference("");
    setVersion(DEFAULT_VERSION);
  };

  const handleAttach = () => {
    if (!parsedReference) return;
    const upperVersion = version.toUpperCase();
    onSelect({
      label: getBibleImportDisplayName(parsedReference, upperVersion),
      book: parsedReference.book,
      chapter: parsedReference.chapter,
      verseRange: parsedReference.verseRange,
      version: upperVersion,
    });
    reset();
    setOpen(false);
  };

  const showBuiltInTrigger = !isControlled && !anchor;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      {showBuiltInTrigger ? (
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="tertiary"
            svg={Plus}
            iconSize="sm"
            disabled={disabled}
            isSelected={open}
            aria-expanded={open}
            aria-haspopup="dialog"
          >
            Add scripture
          </Button>
        </PopoverTrigger>
      ) : null}
      {anchor ? <PopoverAnchor asChild>{anchor}</PopoverAnchor> : null}
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-2rem))] border border-gray-700 bg-gray-900 p-3 text-white shadow-xl"
      >
        <div className="flex flex-col gap-2 text-left">
          <Input
            label="Scripture reference"
            labelClassName={FIELD_LABEL_CLASS}
            placeholder="e.g. John 3:16-18"
            value={reference}
            onChange={(value) => setReference(String(value))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && parsedReference) {
                event.preventDefault();
                handleAttach();
              }
            }}
          />
          <Select
            label="Version"
            labelClassName={FIELD_LABEL_CLASS}
            value={version}
            onChange={setVersion}
            options={bibleVersions.map((item) => ({
              value: item.value,
              label: item.label,
            }))}
          />
          {reference.trim() && !parsedReference ? (
            <p className="text-sm text-amber-200" role="status">
              That doesn&apos;t look like a scripture reference yet — try
              something like &ldquo;John 3:16-18&rdquo;.
            </p>
          ) : null}
          {parsedReference ? (
            <p className="flex items-center gap-2 text-sm text-gray-300">
              <BookOpen
                className={`size-4 shrink-0 ${SERVICE_PLAN_SCRIPTURE_ICON_CLASS}`}
                aria-hidden
              />
              {getBibleImportDisplayName(parsedReference, version.toUpperCase())}
            </p>
          ) : null}
          <Button
            type="button"
            disabled={!parsedReference}
            onClick={handleAttach}
          >
            Attach scripture
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ServicePlanScripturePopover;
