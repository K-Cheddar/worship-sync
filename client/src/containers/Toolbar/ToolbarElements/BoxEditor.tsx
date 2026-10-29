import { createPortal } from "react-dom";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import { Minus, Plus } from "lucide-react";
import type { ItemState } from "../../../types";
import { useDispatch, useSelector } from "../../../hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RadioButton, {
  RadioGroup,
} from "../../../components/RadioButton/RadioButton";
import { updateBoxProperties } from "../../../utils/formatter";
import {
  applyOwnedContentMutation,
  setItemFormatting,
} from "../../../store/itemSlice";
import {
  getItemMutationOwner,
  scheduleOwnedItemMutation,
  type ItemMutationOwner,
  type PendingItemMutationHandle,
} from "../../../store/deferredItemMutations";
import { useToast } from "../../../context/toastContext";
import {
  cleanItemNewlines,
  itemHasCleanableNewlines,
} from "../../../utils/itemNewlineCleanup";

const FORMAT_DEBOUNCE_MS = 500;
const CLEANUP_TOAST_COOLDOWN_MS = 60_000;
const cleanupToastLastShownAtByItem = new Map<string, number>();

type BoxDimensions = { x: number; y: number; width: number; height: number };

type BoxPreset = {
  key: string;
  label: string;
  dimensions: BoxDimensions;
};

const BOX_PRESETS: BoxPreset[] = [
  { key: "full", label: "Full", dimensions: { x: 0, y: 0, width: 100, height: 100 } },
  { key: "middle", label: "50% Middle", dimensions: { x: 0, y: 20, width: 100, height: 55 } },
  { key: "center", label: "90% Middle", dimensions: { x: 0, y: 10, width: 100, height: 90 } },
  { key: "top", label: "Top 20%", dimensions: { x: 0, y: 0, width: 100, height: 20 } },
  { key: "left", label: "Left Half", dimensions: { x: 0, y: 0, width: 50, height: 100 } },
  { key: "right", label: "Right Half", dimensions: { x: 50, y: 0, width: 50, height: 100 } },
  { key: "lower-third", label: "Lower Third", dimensions: { x: 0, y: 65, width: 100, height: 35 } },
  { key: "middle-third", label: "Middle Third", dimensions: { x: 0, y: 35, width: 100, height: 35 } },
  { key: "upper-third", label: "Upper Third", dimensions: { x: 0, y: 0, width: 100, height: 35 } },
];

const QUICK_PRESET_KEYS = ["full", "middle", "lower-third", "middle-third"];

const cleanupNewlinesToastMessage = (itemKind: "song" | "free") =>
  itemKind === "song"
    ? "This song has extra blank lines. Remove them?"
    : "This custom item has extra blank lines. Remove them?";

/** Keep the user's value for the changed field; adjust the partner only if needed to stay in bounds. */
const constrainBoxAfterFieldChange = (
  dims: BoxDimensions,
  field: keyof BoxDimensions,
  value: number,
) => {
  const next = { ...dims, [field]: Math.max(0, Math.min(100, value)) };
  if (field === "height") {
    if (next.y + next.height > 100) next.y = Math.max(0, 100 - next.height);
  } else if (field === "y") {
    if (next.y + next.height > 100) next.height = Math.max(0, 100 - next.y);
  } else if (field === "width") {
    if (next.x + next.width > 100) next.x = Math.max(0, 100 - next.width);
  } else if (field === "x") {
    if (next.x + next.width > 100) next.width = Math.max(0, 100 - next.x);
  }
  return next;
};

/** Ensure box is in bounds by adjusting position (x, y) to fit size; size is not overwritten. */
const sanitizeBoxToBounds = (dims: BoxDimensions): BoxDimensions => {
  const width = Math.max(0, Math.min(100, dims.width));
  const height = Math.max(0, Math.min(100, dims.height));
  const x = Math.max(0, Math.min(100 - width, dims.x));
  const y = Math.max(0, Math.min(100 - height, dims.y));
  return { x, y, width, height };
};

/** Mini CSS preview of a box preset (percent 0–100). */
const PresetIcon = ({
  width,
  height,
  x,
  y,
  label,
  large = false,
}: BoxDimensions & { label?: string; large?: boolean }) => (
  <div
    className={`relative box-border aspect-video shrink-0 overflow-hidden border border-current/60 bg-black/5 ${large ? "w-16 md:w-10" : "w-8"}`}
    data-testid="box-preset-icon"
    aria-hidden="true"
  >
    <div
      className="absolute bg-current/50"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${width}%`,
        height: `${height}%`,
      }}
    />
    {label && (
      <span className={`pointer-events-none absolute inset-0 flex items-center justify-center font-bold uppercase text-white ${large ? "text-[10px] md:text-[7px]" : "text-[7px]"}`}>
        {label}
      </span>
    )}
  </div>
);

const CleanupNewlinesToastAction = ({
  onDismiss,
  onClean,
}: {
  onDismiss: () => void;
  onClean: () => void;
}) => (
  <div className="mt-3 flex justify-center gap-2">
    <Button variant="primary" className="text-sm" onClick={onDismiss}>
      Keep as is
    </Button>
    <Button variant="cta" className="text-sm" onClick={onClean}>
      Remove blank lines
    </Button>
  </div>
);

type BoxEditorProps = {
  updateItem: (item: ItemState, expectedOwner?: ItemMutationOwner) => void;
  quickBoxLayoutTarget: HTMLElement | null;
  quickBoxHeightTarget: HTMLElement | null;
  drawerTarget: HTMLElement | null;
};

const BoxEditor = ({
  updateItem,
  quickBoxLayoutTarget,
  quickBoxHeightTarget,
  drawerTarget,
}: BoxEditorProps) => {
  const dispatch = useDispatch();
  const { showToast, removeToast } = useToast();
  const item = useSelector((state) => state.undoable.present.item);
  const { selectedSlide, selectedBox, slides } = item;
  const owner = getItemMutationOwner(item);

  const boxes = useMemo(
    () => slides[selectedSlide]?.boxes || [],
    [slides, selectedSlide],
  );
  const currentBox = useMemo(
    () => boxes[selectedBox] || {},
    [boxes, selectedBox],
  );
  const slide = slides[selectedSlide];

  const [shouldApplyToAll, setShouldApplyToAll] = useState(item.type !== "free");
  const [dimensions, setDimensions] = useState<BoxDimensions>(() =>
    sanitizeBoxToBounds({
      x: currentBox.x ?? 0,
      y: currentBox.y ?? 0,
      width: currentBox.width ?? 0,
      height: currentBox.height ?? 0,
    }),
  );
  const pendingDimensionsRef = useRef(dimensions);
  const pendingGeometryRef = useRef<{
    handle: PendingItemMutationHandle;
    targetKey: string;
  } | null>(null);
  const isEditingRef = useRef(false);
  const pendingCleanupCheckRef = useRef(false);
  const itemRef = useRef(item);
  itemRef.current = item;

  const targetKey = JSON.stringify([
    owner?.scopeId,
    owner?.databaseKey,
    owner?.churchId,
    owner?.itemId,
    owner?.itemType,
    item.type === "song"
      ? item.arrangements[item.selectedArrangement]?.id
      : null,
    slide?.id,
    currentBox.id ?? selectedBox,
  ]);

  const targetForItem = useCallback(
    (targetItem: ItemState, boxIndex: number, shouldApplyAll: boolean) => {
      const targetSlide = targetItem.slides[targetItem.selectedSlide];
      const targetOwner = getItemMutationOwner(targetItem);
      if (!targetOwner || !targetSlide?.id) return null;
      const targetSectionNum = targetSlide.name.match(/Section (\d+)/)?.[1];
      return {
        owner: targetOwner,
        slideId: targetSlide.id,
        targetBoxId: targetSlide.boxes?.[boxIndex]?.id,
        sectionNum: targetSectionNum
          ? parseInt(targetSectionNum, 10)
          : undefined,
        arrangementId:
          targetItem.type === "song"
            ? targetItem.arrangements[targetItem.selectedArrangement]?.id
            : undefined,
        boxIndex,
        applyToAll: shouldApplyAll,
      };
    },
    [],
  );

  const runWithFormatting = useCallback(
    (targetOwner: ItemMutationOwner, action: () => void) => {
      dispatch(setItemFormatting(true));
      scheduleOwnedItemMutation(targetOwner, 0, () => {
        try {
          action();
        } finally {
          dispatch(setItemFormatting(false));
        }
      });
    },
    [dispatch],
  );

  const handleToastCleanup = useCallback(
    (toastId: string, itemId: string) => {
      const currentItem = itemRef.current;
      if (
        currentItem._id !== itemId ||
        (currentItem.type !== "song" && currentItem.type !== "free")
      ) {
        removeToast(toastId);
        return;
      }
      if (!itemHasCleanableNewlines(currentItem)) {
        removeToast(toastId);
        return;
      }

      const currentOwner = getItemMutationOwner(currentItem);
      if (!currentOwner) {
        removeToast(toastId);
        return;
      }
      runWithFormatting(currentOwner, () => {
        try {
          updateItem(cleanItemNewlines(currentItem), currentOwner);
        } finally {
          removeToast(toastId);
        }
      });
    },
    [removeToast, runWithFormatting, updateItem],
  );

  const scheduleCleanupToastCheck = useCallback(
    (updatedItem: ItemState) => {
      if (!updatedItem._id) return;
      const itemKind = updatedItem.type;
      if (itemKind !== "song" && itemKind !== "free") return;

      setTimeout(() => {
        if (!itemHasCleanableNewlines(updatedItem)) return;
        const now = Date.now();
        const lastShownAt =
          cleanupToastLastShownAtByItem.get(updatedItem._id) ?? 0;
        if (now - lastShownAt < CLEANUP_TOAST_COOLDOWN_MS) return;

        cleanupToastLastShownAtByItem.set(updatedItem._id, now);
        showToast({
          message: cleanupNewlinesToastMessage(itemKind),
          variant: "info",
          duration: 15000,
          showCloseButton: false,
          children: (toastId) => (
            <CleanupNewlinesToastAction
              onDismiss={() => removeToast(toastId)}
              onClean={() => handleToastCleanup(toastId, updatedItem._id)}
            />
          ),
        });
      }, 0);
    },
    [handleToastCleanup, removeToast, showToast],
  );

  const dispatchGeometry = useCallback(
    (
      target: NonNullable<ReturnType<typeof targetForItem>>,
      next: BoxDimensions,
      sourceItem: ItemState,
      shouldCheckCleanup: boolean,
    ) => {
      const updatedItem = updateBoxProperties({
        updatedProperties: next,
        item: sourceItem,
        shouldFormatItem: true,
        shouldApplyToAll: target.applyToAll,
      });
      const { owner: targetOwner, ...mutationTarget } = target;
      runWithFormatting(targetOwner, () => {
        dispatch(
          applyOwnedContentMutation({
            owner: targetOwner,
            mutation: {
              kind: "boxProperties",
              ...mutationTarget,
              properties: next,
              formatItem: true,
            },
          }),
        );
      });
      if (shouldCheckCleanup) scheduleCleanupToastCheck(updatedItem);
    },
    [dispatch, runWithFormatting, scheduleCleanupToastCheck],
  );

  const flushPendingGeometry = useCallback(() => {
    const pending = pendingGeometryRef.current;
    if (!pending) return;
    pendingGeometryRef.current = null;
    pending.handle.flush();
  }, []);

  useEffect(() => {
    setShouldApplyToAll(item.type !== "free");
  }, [item.type]);

  useEffect(() => {
    if (pendingGeometryRef.current?.targetKey !== targetKey) {
      flushPendingGeometry();
      isEditingRef.current = false;
      pendingCleanupCheckRef.current = false;
    }
    if (!isEditingRef.current) {
      const next = sanitizeBoxToBounds({
        x: currentBox.x ?? 0,
        y: currentBox.y ?? 0,
        width: currentBox.width ?? 0,
        height: currentBox.height ?? 0,
      });
      setDimensions(next);
      pendingDimensionsRef.current = next;
    }
  }, [
    currentBox.height,
    currentBox.width,
    currentBox.x,
    currentBox.y,
    flushPendingGeometry,
    targetKey,
  ]);

  useEffect(
    () => () => {
      flushPendingGeometry();
    },
    [flushPendingGeometry],
  );

  const applyPreset = useCallback(
    (nextDimensions: BoxDimensions) => {
      flushPendingGeometry();
      const next = sanitizeBoxToBounds(nextDimensions);
      const target = targetForItem(item, selectedBox, shouldApplyToAll);
      if (!target) return;
      isEditingRef.current = false;
      pendingCleanupCheckRef.current = false;
      setDimensions(next);
      pendingDimensionsRef.current = next;
      const shouldCheckCleanup =
        next.width !== (currentBox.width ?? 0) ||
        next.height !== (currentBox.height ?? 0);
      dispatchGeometry(target, next, item, shouldCheckCleanup);
    },
    [
      currentBox.height,
      currentBox.width,
      dispatchGeometry,
      flushPendingGeometry,
      item,
      selectedBox,
      shouldApplyToAll,
      targetForItem,
    ],
  );

  const handleInputChange = useCallback(
    (field: keyof BoxDimensions, value: string) => {
      const numValue = parseFloat(value);
      if (Number.isNaN(numValue)) return;

      const target = targetForItem(item, selectedBox, shouldApplyToAll);
      if (!target) return;

      const targetChanged = Boolean(
        pendingGeometryRef.current &&
        pendingGeometryRef.current.targetKey !== targetKey
      );
      if (targetChanged) {
        flushPendingGeometry();
      }
      const baseDimensions = targetChanged
        ? sanitizeBoxToBounds({
            x: currentBox.x ?? 0,
            y: currentBox.y ?? 0,
            width: currentBox.width ?? 0,
            height: currentBox.height ?? 0,
          })
        : dimensions;
      const next = constrainBoxAfterFieldChange(baseDimensions, field, numValue);
      pendingGeometryRef.current?.handle.cancel();
      isEditingRef.current = true;
      pendingCleanupCheckRef.current =
        pendingCleanupCheckRef.current || field === "width" || field === "height";
      setDimensions(next);
      pendingDimensionsRef.current = next;

      const capturedCleanupCheck = pendingCleanupCheckRef.current;
      const capturedItem = item;
      const capturedTarget = target;
      let handle: PendingItemMutationHandle;
      handle = scheduleOwnedItemMutation(target.owner, FORMAT_DEBOUNCE_MS, () => {
        if (pendingGeometryRef.current?.handle === handle) {
          pendingGeometryRef.current = null;
        }
        isEditingRef.current = false;
        pendingCleanupCheckRef.current = false;
        const finalDimensions = sanitizeBoxToBounds(pendingDimensionsRef.current);
        dispatchGeometry(
          capturedTarget,
          finalDimensions,
          capturedItem,
          capturedCleanupCheck,
        );
      });
      pendingGeometryRef.current = { handle, targetKey };
    },
    [
      dimensions,
      currentBox.height,
      currentBox.width,
      currentBox.x,
      currentBox.y,
      dispatchGeometry,
      flushPendingGeometry,
      item,
      selectedBox,
      shouldApplyToAll,
      targetForItem,
      targetKey,
    ],
  );

  const applyPresetButton = (preset: BoxPreset, compact = false) => (
    <Button
      key={preset.key}
      type="button"
      variant="tertiary"
      className={compact ? "h-8 w-10 shrink-0 p-0" : "min-h-12 min-w-0 justify-center p-1"}
      padding={compact ? "p-0" : "p-1"}
      title={
        compact
          ? `Apply ${preset.label} box preset to ${
              shouldApplyToAll ? "all slides" : "the selected slide"
            }`
          : `Apply ${preset.label} box preset`
      }
      aria-label={`Apply ${preset.label} box preset`}
      onClick={() => applyPreset(preset.dimensions)}
    >
      <PresetIcon {...preset.dimensions} large={!compact} />
    </Button>
  );

  const matchPreset: BoxPreset = {
    key: "match",
    label: "Match",
    dimensions: isEditingRef.current
      ? dimensions
      : {
          x: currentBox.x ?? 0,
          y: currentBox.y ?? 0,
          width: currentBox.width ?? 0,
          height: currentBox.height ?? 0,
        },
  };
  const quickPresets = [
    ...BOX_PRESETS.filter((preset) => QUICK_PRESET_KEYS.includes(preset.key)),
    matchPreset,
  ];

  const scopeControls = (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium">Apply changes to</p>
      <RadioGroup
        value={shouldApplyToAll ? "all" : "selected"}
        onValueChange={(value) => setShouldApplyToAll(value === "all")}
        className="flex flex-wrap items-center gap-2"
        aria-label="Apply changes to"
        title="All slides applies this box's position and size across this item"
      >
        <RadioButton
          className="w-fit text-xs"
          optionValue="selected"
          label="This slide"
          hideLabelColon
        />
        <RadioButton
          className="w-fit text-xs"
          optionValue="all"
          label="All slides"
          hideLabelColon
        />
      </RadioGroup>
    </div>
  );

  const fullControls = (
    <div
      data-testid="box-layout-drawer-controls"
      className="flex min-w-0 flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        {(["x", "y"] as const).map((field) => (
          <Input
            key={field}
            type="number"
            value={dimensions[field]}
            onChange={(value) => handleInputChange(field, value.toString())}
            label={field.toUpperCase()}
            labelLayout="inline"
            labelFontSize="text-xs"
            min={0}
            max={100}
            inputWidth="w-16"
            inputTextSize="text-xs"
            hideSpinButtons={false}
          />
        ))}
        <div className="flex items-center gap-2">
          {(["width", "height"] as const).map((field) => (
            <Input
              key={field}
              type="number"
              value={dimensions[field]}
              onChange={(value) => handleInputChange(field, value.toString())}
              label={field === "width" ? "Width" : "Height"}
              labelLayout="inline"
              labelFontSize="text-xs"
              min={0}
              max={100}
              inputWidth="w-16"
              inputTextSize="text-xs"
              hideSpinButtons={false}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">Layouts</p>
        <div
          data-testid="box-layout-drawer-presets"
          className="flex flex-wrap items-center gap-2"
        >
          {BOX_PRESETS.map((preset) => applyPresetButton(preset))}
          <Button
            type="button"
            variant="tertiary"
            className="min-h-12 min-w-0 justify-center p-1"
            padding="p-1"
            title="Match the selected box geometry across the chosen scope"
            aria-label="Apply Match box preset"
            disabled={!shouldApplyToAll}
            onClick={() => applyPreset(matchPreset.dimensions)}
          >
            <PresetIcon {...matchPreset.dimensions} label="MATCH" large />
          </Button>
        </div>
      </div>
      {scopeControls}
    </div>
  );

  const quickLayoutControls = (
    <div
      className="flex shrink-0 items-center gap-1"
      role="group"
      aria-label="Layout"
      title="Box layout presets"
    >
      <span className="text-xs font-semibold">Layout</span>
      {quickPresets.map((preset) =>
        preset.key === "match" ? (
          <Button
            key={preset.key}
            type="button"
            variant="tertiary"
            className="h-8 w-10 shrink-0 p-0"
            padding="p-0"
            title="Match the selected box geometry across all slides"
            aria-label="Apply Match box preset"
            disabled={!shouldApplyToAll}
            onClick={() => applyPreset(preset.dimensions)}
          >
            <PresetIcon {...preset.dimensions} label="MATCH" />
          </Button>
        ) : (
          applyPresetButton(preset, true)
        ),
      )}
    </div>
  );

  const quickHeightControls = (
    <div
      className="flex shrink-0 items-center gap-1"
      role="group"
      aria-label="Height"
    >
      <Button
        type="button"
        variant="tertiary"
        svg={Minus}
        aria-label="Decrease box height"
        title="Decrease box height"
        onClick={() =>
          handleInputChange("height", String(dimensions.height - 1))
        }
      />
      <Input
        type="number"
        value={dimensions.height}
        onChange={(value) => handleInputChange("height", value.toString())}
        label="Height"
        labelLayout="inline"
        labelFontSize="text-xs"
        min={0}
        max={100}
        inputWidth="w-14"
        inputTextSize="text-xs"
        hideSpinButtons={false}
      />
      <Button
        type="button"
        variant="tertiary"
        svg={Plus}
        aria-label="Increase box height"
        title="Increase box height"
        onClick={() =>
          handleInputChange("height", String(dimensions.height + 1))
        }
      />
    </div>
  );

  return (
    <>
      {quickBoxLayoutTarget &&
        createPortal(quickLayoutControls, quickBoxLayoutTarget)}
      {quickBoxHeightTarget &&
        createPortal(quickHeightControls, quickBoxHeightTarget)}
      {drawerTarget &&
        createPortal(
          <div className="flex min-w-0 flex-col gap-4">{fullControls}</div>,
          drawerTarget,
        )}
    </>
  );
};

export default BoxEditor;
