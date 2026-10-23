import { ArrowLeft } from "lucide-react";
import Button from "../../../components/Button/Button";
import type { TeamsReturnTo } from "../teamsReturnNavigation";

type TeamsReturnBackButtonProps = {
  returnTo: TeamsReturnTo;
  onClick: () => void;
  disabled?: boolean;
};

const TeamsReturnBackButton = ({ returnTo, onClick, disabled }: TeamsReturnBackButtonProps) => (
  <Button
    type="button"
    variant="tertiary"
    svg={ArrowLeft}
    iconSize="sm"
    padding="px-2 py-1"
    className="shrink-0 text-xs"
    onClick={onClick}
    disabled={disabled}
  >
    {returnTo.label}
  </Button>
);

export default TeamsReturnBackButton;
