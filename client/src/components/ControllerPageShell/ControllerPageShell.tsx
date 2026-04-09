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
    <>
      <ControllerLoadingOverlay
        dbProgress={dbProgress}
        connectionStatus={connectionStatus}
        user={user}
        churchName={churchName}
      />
      <div
        onClick={onRootClick}
        className="bg-homepage-canvas w-dvw h-dvh flex flex-col text-white overflow-hidden list-none"
        style={
          {
            "--scrollbar-width": scrollbarWidth,
          } as CSSProperties
        }
      >
        <Toolbar
          variant={toolbarVariant}
          className="flex min-h-fit shrink-0 overflow-y-hidden border-b-2 border-gray-500 bg-homepage-canvas text-sm"
        />
        <div id="controller-main" className={mainClassName} ref={layoutRef}>
          {children}
        </div>
      </div>
    </>
  );
};

export default ControllerPageShell;
