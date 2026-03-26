import { CSSProperties, MouseEventHandler, ReactNode, Ref } from "react";
import Toolbar, {
  ToolbarVariant,
} from "../../containers/Toolbar/Toolbar";
import { ConnectionStatus } from "../../context/controllerInfo";
import ControllerLoadingOverlay from "./ControllerLoadingOverlay";

type ControllerPageShellProps = {
  children: ReactNode;
  user?: string;
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
  dbProgress,
  connectionStatus,
  scrollbarWidth,
  toolbarVariant = "default",
  onRootClick,
  mainClassName = "flex flex-1 relative min-h-0 bg-gray-700",
  layoutRef,
}: ControllerPageShellProps) => {
  return (
    <>
      <ControllerLoadingOverlay
        dbProgress={dbProgress}
        connectionStatus={connectionStatus}
        user={user}
      />
      <div
        onClick={onRootClick}
        className="bg-gray-700 w-dvw h-dvh flex flex-col text-white overflow-hidden list-none"
        style={
          {
            "--scrollbar-width": scrollbarWidth,
          } as CSSProperties
        }
      >
        <Toolbar
          variant={toolbarVariant}
          className="flex border-b-2 border-gray-500 text-sm min-h-fit bg-gray-700"
        />
        <div id="controller-main" className={mainClassName} ref={layoutRef}>
          {children}
        </div>
      </div>
    </>
  );
};

export default ControllerPageShell;
