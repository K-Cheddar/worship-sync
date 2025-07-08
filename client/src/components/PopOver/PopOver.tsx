import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { ButtonProps } from "../Button/Button";
import { cloneElement, ReactElement, useState } from "react";
import PopOverContent from "./PopOverContent";

type PopOverProps = {
  children: React.ReactNode;
  TriggeringButton: ReactElement<ButtonProps>;
};

const PopOver = ({ children, TriggeringButton }: PopOverProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "bottom-end",
    middleware: [flip({ fallbackAxisSideDirection: "end" }), shift()],
    whileElementsMounted: autoUpdate,
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

  return (
    <>
      {triggeringButton}
      {isOpen && (
        <FloatingFocusManager context={context} modal>
          <PopOverContent
            floatingStyles={floatingStyles}
            refs={refs}
            getFloatingProps={getFloatingProps}
            setIsOpen={setIsOpen}
            isOpen={isOpen}
          >
            {children}
          </PopOverContent>
        </FloatingFocusManager>
      )}
    </>
  );
};

export default PopOver;
