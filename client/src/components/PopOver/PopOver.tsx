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
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import Button, { ButtonProps } from "../Button/Button";
import { cloneElement, ReactElement, useState } from "react";

type PopOverProps = {
  children: React.ReactNode;
  TriggeringButton: ReactElement<ButtonProps>;
};

const PopOver = ({ children, TriggeringButton }: PopOverProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
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
          <div
            className="bg-slate-700 relative rounded-lg shadow-xl z-30"
            style={floatingStyles}
            ref={refs.setFloating}
            {...getFloatingProps()}
          >
            <Button
              className="absolute top-1 right-1 z-40"
              variant="tertiary"
              svg={CloseSVG}
              onClick={() => setIsOpen(false)}
            />
            <div className="p-4 pt-8 relative">{children}</div>
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
};

export default PopOver;