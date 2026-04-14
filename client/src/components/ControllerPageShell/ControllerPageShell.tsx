import { CSSProperties, MouseEventHandler, ReactNode, Ref } from "react";
import Toolbar, {
  ToolbarVariant,
} from "../../containers/Toolbar/Toolbar";
import { ConnectionStatus } from "../../context/controllerInfo";
import ControllerLoadingOverlay from "./ControllerLoadingOverlay";

type ControllerPageShellProps = {
  children: ReactNode;
  user?: string;
  churchName?: string;
  dbProgress?: number;
  connectionStatus?: ConnectionStatus;
  scrollbarWidth?: string | number;
  toolbarVariant?: ToolbarVariant;
  onRootClick?: MouseEventHandler<HTMLDivElement>;
  mainClassName?: string;
  layoutRef?: Ref<HTMLDivElement>;
};

const ControllerPageShell = ({
  children,
  user,
  churchName,
  dbProgress,
  connectionStatus,
  scrollbarWidth,
  toolbarVariant = "default",
  onRootClick,
  mainClassName = "flex flex-1 relative min-h-0 bg-homepage-canvas",
  layoutRef,
}: ControllerPageShellProps) => {
  return (
    <div
      onClick={onRootClick}
      className="dark bg-homepage-canvas flex h-dvh w-dvw list-none flex-col overflow-hidden text-white"
      style={
        {
          "--scrollbar-width": scrollbarWidth,
        } as CSSProperties
      }
    >
      <ControllerLoadingOverlay
        dbProgress={dbProgress}
        connectionStatus={connectionStatus}
        user={user}
        churchName={churchName}
      />
      <Toolbar
        variant={toolbarVariant}
        className="flex min-h-fit shrink-0 overflow-y-hidden border-b-2 border-gray-500 bg-homepage-canvas text-sm"
      />
      <div id="controller-main" className={mainClassName} ref={layoutRef}>
        {children}
      </div>
    </div>
  );
};

export default ControllerPageShell;
