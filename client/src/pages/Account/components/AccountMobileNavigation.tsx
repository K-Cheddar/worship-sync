import { useState } from "react";
import { Menu as MenuIcon } from "lucide-react";
import Button from "../../../components/Button/Button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import type { MenuItemType } from "../../../types";
import AccountSidebarNav from "./AccountSidebarNav";

type AccountMobileNavigationProps = {
  menuItems: MenuItemType[];
};

/** Combines app-level actions and church administration sections into one drawer. */
const AccountMobileNavigation = ({ menuItems }: AccountMobileNavigationProps) => {
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="tertiary"
        className="w-fit max-md:min-h-0 max-md:px-1 max-md:py-0.5"
        aria-label="Open menu"
        aria-haspopup="dialog"
        svg={MenuIcon}
        iconSize="md"
        gap="gap-1.5"
        onClick={() => setOpen(true)}
      >
        Menu
      </Button>
      <SheetContent
        side="left"
        className="flex w-[16rem] max-w-[85vw] flex-col border-gray-700 bg-gray-950/95 p-0"
        aria-describedby={undefined}
      >
        <SheetHeader className="border-gray-700 bg-gray-950/95">
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-1">
            {menuItems.map((item, index) => {
              const content = item.element || item.text;

              if (item.preventClose) {
                return (
                  <div
                    key={index}
                    className="mt-2 border-t border-gray-700 pt-2"
                  >
                    <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Interface zoom
                    </p>
                    {content}
                  </div>
                );
              }

              return (
                <Button
                  key={index}
                  variant="tertiary"
                  className="w-full justify-start rounded-lg px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-800 hover:text-white max-md:min-h-10 max-md:[&>div]:min-h-0"
                  component={item.to ? "link" : "button"}
                  to={item.to}
                  onClick={() => {
                    item.onClick?.();
                    closeMenu();
                  }}
                >
                  {content}
                </Button>
              );
            })}
          </div>
          <div className="mt-4 border-t border-gray-700 pt-2">
            <AccountSidebarNav onNavigate={closeMenu} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default AccountMobileNavigation;
