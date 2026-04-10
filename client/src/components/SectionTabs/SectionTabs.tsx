import * as React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
          "sticky top-0 z-10 -mx-1 overflow-hidden rounded-xl border border-gray-700/80 bg-gray-950/45 px-0 pb-0",
          tabBarClassName
        )}
      >
        <TabsList
          variant="line"
          className={cn(
            "scrollbar-thin group-data-[orientation=horizontal]/tabs:h-auto h-auto min-h-0 min-w-0 w-full flex-nowrap items-stretch justify-start gap-0 overflow-x-auto overflow-y-hidden rounded-xl border border-white/35 bg-transparent p-0!",
            tabsListClassName
          )}
        >
          {items.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              className={cn(
                "relative inline-flex h-full min-h-0 min-w-0 shrink-0 flex-1 items-center justify-center self-stretch rounded-none border-r border-white/25 px-4 py-2.5 text-sm font-semibold shadow-none transition-colors duration-150 first:rounded-l-xl last:rounded-r-xl last:border-r-0",
                // Match group/tabs-list specificity from ui/tabs; hide default line underline (we use border-b accent instead).
                "after:hidden group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-0",
                // Active — darker surface + cyan bottom (clearly above inactive tint).
                "group-data-[variant=line]/tabs-list:data-[state=active]:border-b-2 group-data-[variant=line]/tabs-list:data-[state=active]:border-b-cyan-500 group-data-[variant=line]/tabs-list:data-[state=active]:bg-gray-950 group-data-[variant=line]/tabs-list:data-[state=active]:text-white group-data-[variant=line]/tabs-list:data-[state=active]:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]",
                // Inactive — light tint (matches Account management overview tabs).
                "group-data-[variant=line]/tabs-list:data-[state=inactive]:border-b-2 group-data-[variant=line]/tabs-list:data-[state=inactive]:border-b-transparent group-data-[variant=line]/tabs-list:data-[state=inactive]:bg-white/6 group-data-[variant=line]/tabs-list:data-[state=inactive]:text-gray-200 group-data-[variant=line]/tabs-list:data-[state=inactive]:hover:bg-gray-600/45 group-data-[variant=line]/tabs-list:data-[state=inactive]:hover:text-white",
                "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900",
                triggerClassName
              )}
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
