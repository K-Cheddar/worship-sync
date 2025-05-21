import Button from "../../components/Button/Button";
import cn from "classnames";

type QuickLinkButtonProps = {
  title: string;
  content: string;
  helpText: string;
  isSelected: boolean;
  onClick: () => void;
};

const QuickLinkButton = ({
  title,
  content,
  helpText,
  isSelected,
  onClick,
}: QuickLinkButtonProps) => (
  <Button
    variant="tertiary"
    className={cn(
      "flex flex-col gap-2 items-center border-2",
      isSelected ? "border-cyan-500" : "border-transparent"
    )}
    onClick={onClick}
  >
    <p className="text-sm">{title}:</p>
    <p className="text-xs w-48 overflow-hidden text-ellipsis whitespace-nowrap bg-gray-200 p-2 rounded-md text-black">
      {content}
    </p>
    <p className="text-xs">{helpText}</p>
  </Button>
);

export default QuickLinkButton;
