import { useContext, useState, useEffect } from "react";
import { CloudOff, Cloud, CircleDot } from "lucide-react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import Icon from "../../../components/Icon/Icon";

const UserSection = () => {
  const { user, activeInstances } = useContext(GlobalInfoContext) || {};
  const { isMobile } = useContext(ControllerInfoContext) || {};
  const isDemo = user === "Demo";
  const [isPulsing, setIsPulsing] = useState(false);

  useEffect(() => {
    if ((activeInstances?.length || 0) > 0) {
      setIsPulsing(true);
      const timer = setTimeout(() => {
        setIsPulsing(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [activeInstances?.length]);

  return (
    <div className="flex items-center gap-2 text-white">
      <Icon
        svg={isDemo ? CloudOff : Cloud}
        size="md"
        color={isDemo ? "oklch(0.75 0.183 55.934)" : "#22d3ee"}
      />
      <span className="text-sm font-semibold">{user}</span>
      {!isMobile && (
        <>
          <Icon
            svg={CircleDot}
            size="xs"
            color="#22d3ee"
            className={isPulsing ? "animate-pulse" : ""}
          />
          <span className="text-sm">{activeInstances?.length || 0}</span>
        </>
      )}
    </div>
  );
};

export default UserSection;
