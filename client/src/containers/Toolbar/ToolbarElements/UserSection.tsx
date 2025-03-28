import { useContext } from "react";
import { ReactComponent as SyncDisabled } from "../../../assets/icons/sync-disabled.svg";
import { ReactComponent as SyncCloud } from "../../../assets/icons/sync-cloud.svg";
import Button from "../../../components/Button/Button";
import { GlobalInfoContext } from "../../../context/globalInfo";

const UserSection = () => {
  const { user } = useContext(GlobalInfoContext) || {};
  const isDemo = user === "Demo";
  return (
    <div>
      <Button
        color={
          isDemo ? "oklch(0.75 0.183 55.934)" : "oklch(0.723 0.219 149.579)"
        }
        svg={isDemo ? SyncDisabled : SyncCloud}
        variant="none"
      >
        {user}
      </Button>
    </div>
  );
};

export default UserSection;
