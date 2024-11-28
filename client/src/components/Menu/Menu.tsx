import {
  cloneElement,
  ComponentPropsWithoutRef,
  ReactElement,
  useMemo,
  useState,
} from "react";
import {
  useFloating,
  autoUpdate,
  flip,
  shift,
  useDismiss,
  useRole,
  useClick,
  useInteractions,
  FloatingFocusManager,
} from "@floating-ui/react";

import { MenuItemType } from "../../types";
import MenuItem from "./MenuItem";
import "./Menu.scss";
import cn from "classnames";
import { ButtonProps } from "../Button/Button";

interface MenuProps extends ComponentPropsWithoutRef<"ul"> {
  TriggeringButton: ReactElement<ButtonProps>;
  menuItems: MenuItemType[];
}

const Menu = ({ menuItems, TriggeringButton, ...rest }: MenuProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [flip({ fallbackAxisSideDirection: "end" }), shift()],
    whileElementsMounted: autoUpdate,
    placement: "bottom-end",
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);

  const triggeringButton = cloneElement(TriggeringButton, {
    ref: refs.setReference,
    onClick: () => setIsOpen((val) => !val),
    ...getReferenceProps(),
  });

  const menuItemsWIds = useMemo(() => {
    return menuItems.map((item, index) => {
      return { ...item, id: index };
    });
  }, [menuItems]);

  return (
    <>
      {triggeringButton}
      {isOpen && (
        <FloatingFocusManager context={context} modal>
          <ul
            className={cn("menu")}
            style={floatingStyles}
            ref={refs.setFloating}
            {...getFloatingProps()}
            {...rest}
          >
            {menuItemsWIds.map(({ onClick, text, to, id }) => {
              return (
                <MenuItem key={id} onClick={onClick} to={to}>
                  {text}
                </MenuItem>
              );
            })}
          </ul>
        </FloatingFocusManager>
      )}
    </>
  );
};

export default Menu;
