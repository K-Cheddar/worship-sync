import Button from "../../components/Button/Button";
import cn from "classnames";

type QuickLinkButtonProps = {
  title: string;
  content: string;
  helpText: string;
  isSelected: boolean;
  onClick: () => void;
  selectedText?: string;
};

const QuickLinkButton = ({
  title,
  content,
  helpText,
  isSelected,
  onClick,
  selectedText,
}: QuickLinkButtonProps) => (
  <Button
    variant="tertiary"
    className={cn(
      "flex flex-col gap-2 items-center border-2",
      isSelected ? "border-cyan-500" : "border-transparent"
    )}
    onClick={onClick}
    isSelected={isSelected}
  >
    <p className="text-sm">{title}:</p>
    <p className="text-xs w-48 overflow-hidden text-ellipsis whitespace-nowrap bg-gray-200 p-2 rounded-md text-black">
      {content}
    </p>
    {isSelected && <p className="text-xs">{selectedText}</p>}
    {!isSelected && <p className="text-xs">{helpText}</p>}
  </Button>
);

export default QuickLinkButton;
