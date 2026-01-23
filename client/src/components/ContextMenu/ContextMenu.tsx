import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import cn from "classnames";

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
}

const ContextMenu = ({
  children,
  menuItems,
  header,
  className,
  onOpen,
}: ContextMenuProps) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasAdjustedRef = useRef(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If menu is already open, close it instead of reopening
    if (open) {
      setOpen(false);
      return;
    }
    
    const initialPosition = { x: e.clientX, y: e.clientY };
    setPosition(initialPosition);
    setOpen(true);
    hasAdjustedRef.current = false;
    onOpen?.();
  };

  // Adjust position to stay within bounds after menu renders
  useEffect(() => {
    if (!open || !menuRef.current || hasAdjustedRef.current) return;

    const adjustPosition = () => {
      const menuRect = menuRef.current?.getBoundingClientRect();
      if (!menuRect) return;

      const padding = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      setPosition((prevPosition) => {
        let adjustedX = prevPosition.x;
        let adjustedY = prevPosition.y;

        // Adjust horizontal position if menu goes off right edge
        if (prevPosition.x + menuRect.width > viewportWidth - padding) {
          adjustedX = viewportWidth - menuRect.width - padding;
        }
        // Adjust horizontal position if menu goes off left edge
        if (adjustedX < padding) {
          adjustedX = padding;
        }

        // Adjust vertical position if menu goes off bottom edge
        if (prevPosition.y + menuRect.height > viewportHeight - padding) {
          adjustedY = viewportHeight - menuRect.height - padding;
        }
        // Adjust vertical position if menu goes off top edge
        if (adjustedY < padding) {
          adjustedY = padding;
        }

        hasAdjustedRef.current = true;
        return { x: adjustedX, y: adjustedY };
      });
    };

    // Use requestAnimationFrame to ensure menu is rendered and measured
    requestAnimationFrame(() => {
      adjustPosition();
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    // Use setTimeout to avoid immediate close
    setTimeout(() => {
      document.addEventListener("click", handleClickOutside, true);
      document.addEventListener("contextmenu", handleClickOutside, true);
      document.addEventListener("keydown", handleEscape);
    }, 0);

    return () => {
      document.removeEventListener("click", handleClickOutside, true);
      document.removeEventListener("contextmenu", handleClickOutside, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <>
      <div
        ref={containerRef}
        className={cn("relative", className)}
        onContextMenu={handleContextMenu}
      >
        {children}
      </div>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 bg-gray-700 text-white min-w-[200px] rounded-md border border-gray-600 shadow-lg py-1"
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {header && (
              <>
                <div className="px-3 py-2 border-b border-gray-600">
                  <div className="flex flex-col">
                    <span className="font-semibold text-sm max-w-[250px] truncate">{header.title}</span>
                    {header.subtitle && (
                      <span className="text-xs text-gray-400 font-normal">
                        {header.subtitle}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
            {menuItems.map((item, index) => (
              <button
                key={index}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-600 transition-colors",
                  item.disabled && "opacity-50 cursor-not-allowed",
                  item.variant === "destructive" &&
                    "text-red-400 hover:text-red-300 hover:bg-red-400/10"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!item.disabled) {
                    item.onClick();
                    setOpen(false);
                  }
                }}
                disabled={item.disabled}
              >
                {item.icon && <span className="shrink-0">{item.icon}</span>}
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
};

export default ContextMenu;
