import type { ReactNode } from "react";
import TeamsReturnBackButton from "./TeamsReturnBackButton";
import type { TeamsReturnTo } from "../teamsReturnNavigation";

type TeamsReturnToolbarProps = {
  returnTo: TeamsReturnTo | null;
  onBack: () => void;
  children?: ReactNode;
};

const TeamsReturnToolbar = ({
  returnTo,
  onBack,
  children,
}: TeamsReturnToolbarProps) => {
  if (!returnTo && !children) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {returnTo ? <TeamsReturnBackButton returnTo={returnTo} onClick={onBack} /> : null}
      {children}
    </div>
  );
};

export default TeamsReturnToolbar;
