import { useContext, useState, useEffect, useRef } from "react";
import { ReactComponent as SyncDisabled } from "../../../assets/icons/sync-disabled.svg";
import { ReactComponent as SyncCloud } from "../../../assets/icons/sync-cloud.svg";
import { ReactComponent as Circle } from "../../../assets/icons/circle.svg";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import { useVersionContext } from "../../../context/versionContext";
import {
  isVersionUpdateDismissed,
  markVersionUpdateDismissed,
} from "../../../utils/versionUtils";
import Icon from "../../../components/Icon/Icon";
import Button from "../../../components/Button/Button";
import PopOverContent from "../../../components/PopOver/PopOverContent";

const UserSection = () => {
  const { user, activeInstances } = useContext(GlobalInfoContext) || {};
  const { isMobile } = useContext(ControllerInfoContext) || {};
  const { versionUpdate, setShowUpdateModal, setVersionUpdate } =
    useVersionContext();
  const isDemo = user === "Demo";
  const [isPulsing, setIsPulsing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const viewingDetailsRef = useRef(false);

  useEffect(() => {
    if (versionUpdate && !isVersionUpdateDismissed(versionUpdate.newVersion)) {
      setIsOpen(true);
    }
  }, [versionUpdate]);

  useEffect(() => {
    if ((activeInstances?.length || 0) > 0) {
      setIsPulsing(true);
      const timer = setTimeout(() => {
        setIsPulsing(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [activeInstances?.length]);

  const handlePopoverClose = () => {
    if (!viewingDetailsRef.current && versionUpdate) {
      markVersionUpdateDismissed(versionUpdate.newVersion);
      setVersionUpdate(null);
    }
    setIsOpen(false);
    viewingDetailsRef.current = false;
  };

  return (
    <div className="flex items-center gap-2 text-white">
      <Icon
        svg={isDemo ? SyncDisabled : SyncCloud}
        size="md"
        color={isDemo ? "oklch(0.75 0.183 55.934)" : "#22d3ee"}
      />
      <span className="text-sm font-semibold">{user}</span>
      {!isMobile && (
        <>
          <Icon
            svg={Circle}
            size="xs"
            color="#22d3ee"
            className={isPulsing ? "animate-pulse" : ""}
          />
          <span className="text-sm">{activeInstances?.length || 0}</span>
        </>
      )}

      <PopOverContent
        isOpen={isOpen}
        setIsOpen={(open) => {
          if (!open) {
            handlePopoverClose();
          } else {
            setIsOpen(true);
          }
        }}
        position="fixed"
        className="lg:top-2 max-lg:bottom-2 lg:right-2 max-lg:left-2 flex flex-row-reverse items-center"
        childrenClassName="px-4 py-2 flex gap-2 items-center"
        closeButtonClassName=""
      >
        <p className="font-semibold text-white">Update Available!</p>
        <Button
          onClick={() => {
            viewingDetailsRef.current = true;
            setIsOpen(false);
            setShowUpdateModal(true);
          }}
          variant="cta"
          className="justify-center"
        >
          View Update Details
        </Button>
      </PopOverContent>
    </div>
  );
};

export default UserSection;
