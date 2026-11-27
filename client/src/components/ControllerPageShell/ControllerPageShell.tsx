import { CSSProperties, MouseEventHandler, ReactNode, Ref } from "react";
import Toolbar, {
  ToolbarVariant,
} from "../../containers/Toolbar/Toolbar";
import {
  ConnectionStatus,
  ControllerStartupInfo,
  StartupActivitySubscription,
} from "../../context/controllerInfo";
import ControllerLoadingOverlay from "./ControllerLoadingOverlay";
import { ThumbnailPreviewModeProvider } from "../../context/thumbnailPreviewMode";

type ControllerPageShellProps = {
  children: ReactNode;
  user?: string;
  churchName?: string;
  dbProgress?: number | null;
  connectionStatus?: ConnectionStatus;
  startupInfo?: ControllerStartupInfo;
  subscribeToStartupActivity?: StartupActivitySubscription;
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
  startupInfo,
  subscribeToStartupActivity,
  scrollbarWidth,
  toolbarVariant = "default",
  onRootClick,
  mainClassName = "flex flex-1 relative min-h-0 bg-homepage-canvas",
  layoutRef,
}: ControllerPageShellProps) => {
  const isStartupLoading = dbProgress !== 100;

  return (
    <ThumbnailPreviewModeProvider>
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
          startupInfo={startupInfo}
          subscribeToStartupActivity={subscribeToStartupActivity}
          user={user}
          churchName={churchName}
        />
        <div
          data-testid="controller-interaction-layer"
          inert={isStartupLoading}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <Toolbar
            variant={toolbarVariant}
            className="flex shrink-0 overflow-y-hidden border-b-2 border-gray-500 bg-homepage-canvas text-sm"
          />
          <div id="controller-main" className={mainClassName} ref={layoutRef}>
            {children}
          </div>
        </div>
      </div>
    </ThumbnailPreviewModeProvider>
  );
};

export default ControllerPageShell;
