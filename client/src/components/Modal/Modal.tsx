import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import Button from "../Button/Button";

type ModalProps = {
  children: React.ReactNode;
  onClose: () => void;
  isOpen: boolean;
};

const Modal = ({ children, isOpen, onClose }: ModalProps) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed z-30 top-0 left-0 w-full h-full">
      <div className="absolute top-0 left-0 w-full h-full bg-black opacity-50" />
      <div className="bg-slate-700 relative top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-fit h-fit min-w-[300px] min-h-[200px] rounded-lg shadow-xl max-w-full max-h-full">
        <Button
          className="absolute top-1 right-1 z-40"
          variant="tertiary"
          svg={CloseSVG}
          onClick={onClose}
        />
        <div className="p-4 pt-8 relative">{children}</div>
      </div>
    </div>
  );
};

export default Modal;
