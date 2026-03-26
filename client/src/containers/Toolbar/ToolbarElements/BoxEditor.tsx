import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";

import { Maximize2 } from "lucide-react";

import { ItemState } from "../../../types";
import { useDispatch, useSelector } from "../../../hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RadioButton from "../../../components/RadioButton/RadioButton";
import PopOver from "../../../components/PopOver/PopOver";
import { updateBoxProperties } from "../../../utils/formatter";
import { setItemFormatting } from "../../../store/itemSlice";

const FORMAT_DEBOUNCE_MS = 500;

/** Keep the user's value for the changed field; adjust the partner only if needed to stay in bounds. */
const constrainBoxAfterFieldChange = (
  dims: { x: number; y: number; width: number; height: number },
  field: "x" | "y" | "width" | "height",
  value: number
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
const sanitizeBoxToBounds = (dims: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => {
  const w = Math.max(0, Math.min(100, dims.width));
  const h = Math.max(0, Math.min(100, dims.height));
  const x = Math.max(0, Math.min(100 - w, dims.x));
  const y = Math.max(0, Math.min(100 - h, dims.y));
  return { x, y, width: w, height: h };
};

/** Mini CSS preview of a box preset (percent 0–100). */
const PresetIcon = ({
  width,
  height,
  x,
  y,
  label,
}: {
  width: number;
  height: number;
  x: number;
  y: number;
  label?: string;
}) => (
  <div
    className="w-8 aspect-video border border-current/60 overflow-hidden bg-black/5 relative box-border shrink-0"
    aria-hidden
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
      <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold uppercase text-white pointer-events-none">
        {label}
      </span>
    )}
  </div>
);

const BoxEditor = ({
  updateItem,
  className,
}: {
  updateItem: (item: ItemState) => void;
  isMobile: boolean;
  className?: string;
}) => {
  const dispatch = useDispatch();
  const item = useSelector((state) => state.undoable.present.item);
  const { selectedSlide, selectedBox, slides } = item;

  const boxes = useMemo(() => {
    return slides[selectedSlide]?.boxes || [];
  }, [slides, selectedSlide]);

  const currentBox = useMemo(() => {
    return boxes[selectedBox] || {};
  }, [boxes, selectedBox]);

  const [shouldApplyToAll, setShouldApplyToAll] = useState(
    item.type === "free" ? false : true
  );

  const [dimensions, setDimensions] = useState(() => ({
    x: currentBox.x ?? 0,
    y: currentBox.y ?? 0,
    width: currentBox.width ?? 0,
    height: currentBox.height ?? 0,
  }));

  const formatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEditingRef = useRef(false);
  const pendingDimensionsRef = useRef({
    x: currentBox.x ?? 0,
    y: currentBox.y ?? 0,
    width: currentBox.width ?? 0,
    height: currentBox.height ?? 0,
  });

  useEffect(() => {
    setShouldApplyToAll(item.type === "free" ? false : true);
  }, [item.type]);

  useEffect(() => {
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
  }, [currentBox.x, currentBox.y, currentBox.width, currentBox.height, selectedBox, selectedSlide]);

  const updateBoxSize = useCallback(
    ({
      width,
      height,
      x,
      y,
    }: {
      width: number;
      height: number;
      x: number;
      y: number;
    }) => {
      const updatedItem = updateBoxProperties({
        updatedProperties: { width, height, x, y },
        item,
        shouldFormatItem: true,
        shouldApplyToAll: shouldApplyToAll,
      });
      updateItem(updatedItem);
    },
    [item, shouldApplyToAll, updateItem]
  );

  const runWithFormatting = useCallback(
    (fn: () => void) => {
      dispatch(setItemFormatting(true));
      setTimeout(() => {
        try {
          fn();
        } finally {
          dispatch(setItemFormatting(false));
        }
      }, 0);
    },
    [dispatch]
  );

  const flushDebouncedFormat = useCallback(() => {
    if (formatTimeoutRef.current) {
      clearTimeout(formatTimeoutRef.current);
      formatTimeoutRef.current = null;
    }
    isEditingRef.current = false;
    const d = sanitizeBoxToBounds(pendingDimensionsRef.current);
    runWithFormatting(() =>
      updateBoxSize({
        width: d.width,
        height: d.height,
        x: d.x,
        y: d.y,
      })
    );
  }, [runWithFormatting, updateBoxSize]);

  useEffect(() => {
    return () => {
      if (formatTimeoutRef.current) clearTimeout(formatTimeoutRef.current);
    };
  }, []);

  const applyPreset = useCallback(
    (dims: { width: number; height: number; x: number; y: number }) => {
      if (formatTimeoutRef.current) {
        clearTimeout(formatTimeoutRef.current);
        formatTimeoutRef.current = null;
      }
      isEditingRef.current = false;
      runWithFormatting(() => updateBoxSize(sanitizeBoxToBounds(dims)));
    },
    [runWithFormatting, updateBoxSize]
  );

  const scheduleFormat = useCallback(() => {
    if (formatTimeoutRef.current) clearTimeout(formatTimeoutRef.current);
    formatTimeoutRef.current = setTimeout(flushDebouncedFormat, FORMAT_DEBOUNCE_MS);
  }, [flushDebouncedFormat]);

  const handleInputChange = (
    field: "x" | "y" | "width" | "height",
    value: string
  ) => {
    let numValue = parseFloat(value);
    if (field === "x" || field === "y") {
      if (numValue > 100) numValue = 100;
      if (numValue < 0) numValue = 0;
    }
    if (!isNaN(numValue)) {
      const newDims = constrainBoxAfterFieldChange(dimensions, field, numValue);
      setDimensions(newDims);
      pendingDimensionsRef.current = newDims;
      isEditingRef.current = true;
      scheduleFormat();
    }
  };

  const controls = (
    <>
      <div className="flex flex-wrap gap-2 items-center max-lg:justify-center">
        <Input
          type="number"
          value={dimensions.x}
          onChange={(value) => handleInputChange("x", value.toString())}
          label="X"
          labelClassName="mr-2 max-lg:mb-2"
          min={0}
          max={100}
          inputWidth="w-16"
          inputTextSize="text-xs"
          hideSpinButtons={false}
        />
        <Input
          type="number"
          value={dimensions.y}
          onChange={(value) => handleInputChange("y", value.toString())}
          label="Y"
          labelClassName="mr-2 max-lg:mb-2"
          min={0}
          max={100}
          inputWidth="w-16"
          inputTextSize="text-xs"
          hideSpinButtons={false}
        />
        <Input
          type="number"
          value={dimensions.width}
          onChange={(value) => handleInputChange("width", value.toString())}
          label="Width"
          labelClassName="mr-2 max-lg:mb-2"
          min={0}
          max={100}
          inputWidth="w-16"
          inputTextSize="text-xs"
          hideSpinButtons={false}
        />
        <Input
          type="number"
          value={dimensions.height}
          onChange={(value) => handleInputChange("height", value.toString())}
          label="Height"
          labelClassName="mr-2 max-lg:mb-2"
          min={0}
          max={100}
          inputWidth="w-16"
          inputTextSize="text-xs"
          hideSpinButtons={false}
        />
      </div>
      <div className="flex flex-wrap gap-2 items-center justify-center max-lg:pt-2">
        <Button
          variant="tertiary"
          className="w-10 max-lg:w-18"
          padding="p-0"
          onClick={() =>
            applyPreset({
              width: 100,
              height: 100,
              x: 0,
              y: 0,
            })
          }
        >
          <PresetIcon width={100} height={100} x={0} y={0} />
        </Button>
        <Button
          variant="tertiary"
          className="w-10 max-lg:w-18"
          padding="p-0"
          onClick={() =>
            applyPreset({
              width: 100,
              height: 55,
              x: 0,
              y: 20,
            })
          }
        >
          <PresetIcon width={100} height={55} x={0} y={20} />
        </Button>
        <Button
          variant="tertiary"
          className="w-10 max-lg:w-18"
          padding="p-0"
          onClick={() =>
            applyPreset({
              width: 100,
              height: 90,
              x: 0,
              y: 10,
            })
          }
        >
          <PresetIcon width={100} height={90} x={0} y={10} />
        </Button>
        <Button
          variant="tertiary"
          className="w-10 max-lg:w-18"
          padding="p-0"
          onClick={() =>
            applyPreset({
              width: 100,
              height: 20,
              x: 0,
              y: 0,
            })
          }
        >
          <PresetIcon width={100} height={20} x={0} y={0} />
        </Button>
        <Button
          variant="tertiary"
          className="w-10 max-lg:w-18"
          padding="p-0"
          onClick={() =>
            applyPreset({
              width: 50,
              height: 100,
              x: 0,
              y: 0,
            })
          }
        >
          <PresetIcon width={50} height={100} x={0} y={0} />
        </Button>
        <Button
          variant="tertiary"
          className="w-10 max-lg:w-18"
          padding="p-0"
          onClick={() =>
            applyPreset({
              width: 50,
              height: 100,
              x: 50,
              y: 0,
            })
          }
        >
          <PresetIcon width={50} height={100} x={50} y={0} />
        </Button>
        <Button
          variant="tertiary"
          className="w-10 max-lg:w-18"
          padding="p-0"
          onClick={() =>
            applyPreset({
              width: 100,
              height: 35,
              x: 0,
              y: 65,
            })
          }
        >
          <PresetIcon width={100} height={35} x={0} y={65} />
        </Button>
        <Button
          variant="tertiary"
          className="w-10 max-lg:w-18"
          padding="p-0"
          onClick={() =>
            applyPreset({
              width: 100,
              height: 35,
              x: 0,
              y: 35,
            })
          }
        >
          <PresetIcon width={100} height={35} x={0} y={35} />
        </Button>
        <Button
          variant="tertiary"
          className="w-10 max-lg:w-18"
          padding="p-0"
          onClick={() =>
            applyPreset({
              width: 100,
              height: 35,
              x: 0,
              y: 0,
            })
          }
        >
          <PresetIcon width={100} height={35} x={0} y={0} />
        </Button>
        <Button
          variant="tertiary"
          className="w-10 max-lg:w-18"
          padding="p-0"
          onClick={() =>
            applyPreset({
              width: currentBox.width ?? 0,
              height: currentBox.height ?? 0,
              x: currentBox.x ?? 0,
              y: currentBox.y ?? 0,
            })
          }
        >
          <PresetIcon
            width={currentBox.width ?? 0}
            height={currentBox.height ?? 0}
            x={currentBox.x ?? 0}
            y={currentBox.y ?? 0}
            label="MATCH"
          />
        </Button>
      </div>
      <div className="flex gap-2 items-center justify-center max-lg:pt-2">
        <RadioButton
          className="text-xs w-fit"
          label="Apply to selected"
          value={!shouldApplyToAll}
          onChange={() => setShouldApplyToAll(false)}
        />
        <RadioButton
          label="Apply to all"
          className="text-xs w-fit"
          value={shouldApplyToAll}
          onChange={() => setShouldApplyToAll(true)}
        />
      </div>
    </>
  );

  return (
    <div className={`flex gap-2 items-center ${className || ""}`}>
      <div className="max-lg:hidden flex gap-2 items-center flex-wrap py-1">
        {controls}
      </div>
      <PopOver
        TriggeringButton={
          <Button className="lg:hidden" variant="tertiary" svg={Maximize2}>
            Tools
          </Button>
        }
      >
        <div className="flex flex-col gap-4 items-center p-4">{controls}</div>
      </PopOver>
    </div>
  );
};

export default BoxEditor;
