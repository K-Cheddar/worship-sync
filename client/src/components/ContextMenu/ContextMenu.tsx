import cn from "classnames";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface ContextMenuProps {
  children: React.ReactNode;
  menuItems: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
    disabled?: boolean;
    variant?: "default" | "destructive";
  }[];
  header?: {
    title: string;
    subtitle?: string;
  };
  className?: string;
  onOpen?: () => void;
  /** Called before opening; use to e.g. select the item under the cursor. When provided, menu may open even if menuItems is currently empty (they update on next render). */
  onContextMenuOpen?: (e: React.MouseEvent) => void;
  /**
   * If this returns true, the default context menu flow is skipped (preventDefault, no Radix open).
   * Use for gestures that should not compete with the context menu (e.g. plain right-click elsewhere).
   */
  onBeforeContextMenu?: (e: React.MouseEvent) => boolean;
}

const ContextMenuWrapper = ({
  children,
  menuItems,
  header,
  className,
  onOpen,
  onContextMenuOpen,
  onBeforeContextMenu,
}: ContextMenuProps) => {
  /**
   * Radix composes trigger handlers as: our onContextMenu first, then Radix's.
   * If we preventDefault in the first handler, Radix never records pointer position
   * or opens the menu. Radix ContextMenu Root also does not support a controlled
   * `open` prop — only `onOpenChange` — so local open state cannot drive visibility.
   */
  const handleContextMenu = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (onBeforeContextMenu?.(e)) {
      e.preventDefault();
      return;
    }

    onContextMenuOpen?.(e);

    if (menuItems.length === 0 && !onContextMenuOpen) {
      e.preventDefault();
    } else {
      onOpen?.();
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn("relative", className)}
          onContextMenu={handleContextMenu}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-[200px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {header && (
          <>
            <ContextMenuLabel className="max-w-[250px] truncate font-semibold">
              {header.title}
            </ContextMenuLabel>
            {header.subtitle ? (
              <span className="block px-2 pb-2 text-xs font-normal text-gray-400">
                {header.subtitle}
              </span>
            ) : null}
            <ContextMenuSeparator />
          </>
        )}
        {menuItems.map((item, index) => (
          <ContextMenuItem
            key={index}
            disabled={item.disabled}
            className={cn(
              item.variant === "destructive" &&
              "text-red-400 focus:bg-red-400/10 focus:text-red-300"
            )}
            onSelect={() => {
              if (!item.disabled) {
                item.onClick();
              }
            }}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <span>{item.label}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
};

export default ContextMenuWrapper;
