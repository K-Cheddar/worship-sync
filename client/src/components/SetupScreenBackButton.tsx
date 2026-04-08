import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Button from "./Button/Button";

type SetupScreenBackButtonProps = {
  label?: string;
  to?: string;
};

const SetupScreenBackButton = ({
  label = "Back to start",
  to = "/",
}: SetupScreenBackButtonProps) => {
  const navigate = useNavigate();
  return (
    <div className="-mt-1 mb-3 flex justify-start">
      <Button
        type="button"
        variant="tertiary"
        svg={ArrowLeft}
        iconSize="sm"
        gap="gap-1.5"
        className="-ml-2 whitespace-nowrap px-2 py-1.5 text-sm"
        onClick={() => navigate(to)}
      >
        {label}
      </Button>
    </div>
  );
};

export default SetupScreenBackButton;
