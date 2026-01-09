"use client";

import React, { useRef, useEffect } from "react";
import { cn } from "@/utils/cnHelper";
import Button from "@/components/ui/Button";

export interface ListboxProps<T extends string | number> {
  label?: string;
  items: readonly T[];
  value?: T;
  onChange?: (value: T) => void;
  className?: string;
  itemClassName?: string;
  "aria-label"?: string;
}

export function Listbox<T extends string | number>({
  label,
  items,
  value,
  onChange,
  className,
  itemClassName,
  "aria-label": ariaLabel,
}: ListboxProps<T>) {
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!selectedItemRef.current) return;
    selectedItemRef.current.focus({ preventScroll: true });
    selectedItemRef.current.scrollIntoView({ block: "nearest" });
  }, [value]);

  return (
    <div className={cn("flex flex-col", className)}>
      {label && (
        <span className="px-1 pb-1 text-xs text-muted-foreground">{label}</span>
      )}
      <div
        role="listbox"
        aria-label={ariaLabel || label}
        className="max-h-56 w-16 overflow-auto rounded-md border border-border bg-card p-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <Button
            key={String(item)}
            type="button"
            variant="none"
            size="sm"
            role="option"
            aria-selected={String(value) === String(item)}
            onClick={() => onChange?.(item)}
            ref={String(value) === String(item) ? selectedItemRef : undefined}
            className={cn(
              "w-full justify-start px-2 py-1 text-left text-sm",
              String(value) === String(item)
                ? "bg-primary text-primary-foreground hover:bg-primary"
                : "hover:bg-gray-400 hover:text-white",
              itemClassName
            )}
          >
            {String(item)}
          </Button>
        ))}
      </div>
    </div>
  );
}
