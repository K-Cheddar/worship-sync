import * as React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/utils/cnHelper";

export type SectionTabItem<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  content: React.ReactNode;
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
          "sticky top-0 z-10 -mx-1 border-b border-border/80 bg-background/95 px-0 pb-0 backdrop-blur-sm",
          tabBarClassName
        )}
      >
        <TabsList
          variant="line"
          className={cn(
            "p-0! h-auto min-h-0 w-full min-w-0 flex-nowrap items-stretch justify-start gap-0 overflow-x-auto overflow-y-hidden rounded-md border border-gray-400 bg-transparent scrollbar-thin group-data-[orientation=horizontal]/tabs:h-auto",
            tabsListClassName
          )}
        >
          {items.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className={cn(
                "relative inline-flex h-full min-h-0 min-w-0 shrink-0 flex-1 items-center justify-center self-stretch rounded-none border-0 border-r border-gray-400 px-4 py-2.5 text-sm font-semibold shadow-none last:border-r-0",
                // Match group/tabs-list specificity from ui/tabs so we override line-variant defaults (otherwise active stays transparent).
                "after:hidden group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-0",
                "group-data-[variant=line]/tabs-list:data-[state=active]:bg-white group-data-[variant=line]/tabs-list:data-[state=active]:text-black",
                "group-data-[variant=line]/tabs-list:data-[state=active]:hover:bg-white",
                "dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-white dark:group-data-[variant=line]/tabs-list:data-[state=active]:text-black",
                "group-data-[variant=line]/tabs-list:data-[state=inactive]:bg-transparent",
                "group-data-[variant=line]/tabs-list:data-[state=inactive]:text-zinc-600 dark:group-data-[variant=line]/tabs-list:data-[state=inactive]:text-zinc-200",
                "group-data-[variant=line]/tabs-list:data-[state=inactive]:hover:bg-gray-500/25 group-data-[variant=line]/tabs-list:data-[state=inactive]:hover:text-foreground",
                "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
          className={cn("mt-3 text-sm text-muted-foreground", descriptionClassName)}
        >
          {descriptionText}
        </p>
      ) : null}

      <div className={cn("mt-4 space-y-4", tabsContentClassName)}>
        {items.map((item) => (
          <TabsContent
            key={item.value}
            value={item.value}
            className="space-y-4 outline-none"
          >
            {item.content}
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}
