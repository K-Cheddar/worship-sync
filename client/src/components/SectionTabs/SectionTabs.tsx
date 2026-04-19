import * as React from "react";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  lineTabsListShellClassName,
  lineTabsTriggerClassName,
} from "@/components/ui/tabs";
import { cn } from "@/utils/cnHelper";

export type SectionTabItem<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  content: React.ReactNode;
  /** When true, the tab cannot be activated (e.g. prerequisite not met). */
  disabled?: boolean;
  /** Merged into `TabsContent`; default is `space-y-4` when omitted. */
  contentClassName?: string;
};

export type SectionTabsProps<T extends string> = {
  items: SectionTabItem<T>[];
  className?: string;
  /** Sticky bar behind the tab triggers (border / background). */
  tabBarClassName?: string;
  tabsListClassName?: string;
  triggerClassName?: string;
  descriptionClassName?: string;
  tabsContentClassName?: string;
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
};

export function SectionTabs<T extends string>({
  items,
  className,
  tabBarClassName,
  tabsListClassName,
  triggerClassName,
  descriptionClassName,
  tabsContentClassName,
  value,
  defaultValue,
  onValueChange,
}: SectionTabsProps<T>) {
  const firstValue = items[0]?.value;
  const isControlled = value !== undefined;

  const [internalValue, setInternalValue] = React.useState<T | undefined>(
    defaultValue ?? firstValue
  );

  const activeValue = isControlled ? value : (internalValue ?? firstValue);

  const descriptionText = items.find((item) => item.value === activeValue)
    ?.description;

  const handleChange = (next: string) => {
    const nextTyped = next as T;
    if (!isControlled) {
      setInternalValue(nextTyped);
    }
    onValueChange?.(nextTyped);
  };

  return (
    <Tabs
      value={isControlled ? value : undefined}
      defaultValue={
        isControlled ? undefined : (defaultValue ?? firstValue)
      }
      onValueChange={handleChange}
      className={cn("w-full gap-0", className)}
    >
      <div
        className={cn(
          "sticky top-0 z-10 -mx-1 overflow-hidden rounded-xl bg-gray-950 px-0 pb-0",
          tabBarClassName
        )}
      >
        <TabsList
          variant="line"
          className={cn(lineTabsListShellClassName, tabsListClassName)}
        >
          {items.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              className={cn(lineTabsTriggerClassName, triggerClassName)}
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {descriptionText ? (
        <p
          className={cn("mt-3 text-sm text-gray-400", descriptionClassName)}
        >
          {descriptionText}
        </p>
      ) : null}

      <div className={cn("mt-4 space-y-4", tabsContentClassName)}>
        {items.map((item) => (
          <TabsContent
            key={item.value}
            value={item.value}
            className={cn(
              "outline-none",
              item.contentClassName ?? "space-y-4",
            )}
          >
            {item.content}
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}
