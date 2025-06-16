import { useContext, useState, useEffect } from "react";
import { ReactComponent as SyncDisabled } from "../../../assets/icons/sync-disabled.svg";
import { ReactComponent as SyncCloud } from "../../../assets/icons/sync-cloud.svg";
import { ReactComponent as Circle } from "../../../assets/icons/circle.svg";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import Icon from "../../../components/Icon/Icon";

const UserSection = () => {
  const { user, activeInstances } = useContext(GlobalInfoContext) || {};
  const { isMobile } = useContext(ControllerInfoContext) || {};
  const isDemo = user === "Demo";
  const [isPulsing, setIsPulsing] = useState(false);

  useEffect(() => {
    if (activeInstances !== undefined) {
      setIsPulsing(true);
      const timer = setTimeout(() => {
        setIsPulsing(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [activeInstances]);

  return (
    <div className="flex items-center gap-2">
      <Icon
        svg={isDemo ? SyncDisabled : SyncCloud}
        size="md"
        color={isDemo ? "oklch(0.75 0.183 55.934)" : "#22d3ee"}
      />
      <span className="text-sm font-semibold ">{user}</span>
      {!isMobile && (
        <>
          <Icon
            svg={Circle}
            size="xs"
            color="#22d3ee"
            className={isPulsing ? "animate-pulse" : ""}
          />
          <span className="text-sm">{activeInstances}</span>
        </>
      )}
    </div>
  );
};

export default UserSection;
