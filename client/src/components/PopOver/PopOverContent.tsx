import Button from "../Button/Button";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import cn from "classnames";

type PopOverContentProps = {
  children: React.ReactNode;
  floatingStyles?: React.CSSProperties;
  refs?: any;
  getFloatingProps?: any;
  setIsOpen: (isOpen: boolean) => void;
  className?: string;
  isOpen?: boolean;
  position?: "relative" | "fixed" | "absolute";
  childrenClassName?: string;
  closeButtonClassName?: string;
};

const PopOverContent = ({
  children,
  floatingStyles,
  refs,
  getFloatingProps,
  setIsOpen,
  className,
  isOpen,
  position = "relative",
  childrenClassName = "px-4 pb-4 relative",
  closeButtonClassName = "ml-auto mt-2 mr-2",
}: PopOverContentProps) => {
  if (!isOpen) return null;
  return (
    <div
      className={cn(
        "bg-gray-700 rounded-lg shadow-2xl z-30 border-2 border-gray-600 max-w-[85vw] overflow-x-hidden",
        position,
        className
      )}
      style={floatingStyles}
      ref={refs?.setFloating}
      {...getFloatingProps?.()}
    >
      <Button
        className={closeButtonClassName}
        variant="tertiary"
        svg={CloseSVG}
        onClick={() => setIsOpen(false)}
      />
      <div className={childrenClassName}>{children}</div>
    </div>
  );
};

export default PopOverContent;
