import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useStore } from "react-redux";
import { useNavigate } from "react-router-dom";
import { GlobalInfoContext, globalFireDbInfo } from "../../context/globalInfo";
import { globalDb } from "../../context/controllerInfo";
import { useTransferActions } from "../../context/transferContext";
import { useDispatch } from "../../hooks";
import { setFocusMediaId, setIsMediaExpanded, setRequestOpenMediaPanel } from "../../store/preferencesSlice";
import type { RootState } from "../../store/store";
import type { MediaType } from "../../types";
import { deleteLocalVideoFile } from "../../utils/localVideoFileAssets";
import { buildLocalVideoCloudSharePatch } from "../../containers/Media/localMediaCloudShare";
import { createLocalMediaFromDownloadedVideo } from "../../containers/Media/localMediaImport";
import { uploadDownloadedVideoToMux } from "../../containers/Media/utils/muxUpload";
import { MEDIA_STORAGE_CHANGED_EVENT } from "../../containers/Media/mediaStorageEvents";
import { DesktopVideoDownloadManager as DesktopVideoDownloadController, type DesktopVideoDownloadInput, type DesktopVideoDownloadOwner } from "./desktopVideoDownloadController";
import { persistDownloadedVideoMedia } from "./persistDownloadedVideoMedia";

type DesktopVideoDownloadContextValue = {
  start: (input: DesktopVideoDownloadInput) => string;
};

const DesktopVideoDownloadContext = createContext<DesktopVideoDownloadContextValue | null>(null);

export const useDesktopVideoDownload = () => {
  const context = useContext(DesktopVideoDownloadContext);
  if (!context) throw new Error("Desktop video downloads are unavailable.");
  return context;
};

const DesktopVideoDownloadManager = ({ children }: { children: ReactNode }) => {
  const info = useContext(GlobalInfoContext);
  const churchId = info?.churchId ?? "";
  const dispatch = useDispatch();
  const reduxStore = useStore<RootState>();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  const churchIdRef = useRef(churchId);
  navigateRef.current = navigate;
  churchIdRef.current = churchId;
  const transfer = useTransferActions();
  const managerRef = useRef<DesktopVideoDownloadController | null>(null);

  if (!managerRef.current && window.electronAPI) {
    const native = window.electronAPI;
    const isOwnerCurrent = (owner: DesktopVideoDownloadOwner) =>
      churchIdRef.current === owner.churchId &&
      globalFireDbInfo.churchId === owner.churchId &&
      globalDb === owner.dbAtStart;
    const persistMediaItem = (incoming: MediaType, owner: DesktopVideoDownloadOwner, patch?: Partial<MediaType>) =>
      persistDownloadedVideoMedia({ incoming, owner, patch, dispatch, getState: reduxStore.getState, isOwnerCurrent });

    managerRef.current = new DesktopVideoDownloadController({
      native,
      getDatabase: () => globalDb,
      isOwnerCurrent,
      createLocalMedia: ({ asset, owner, displayName, duration, destination }) =>
        createLocalMediaFromDownloadedVideo({
          asset,
          workspaceId: owner.workspaceId,
          displayName,
          duration,
          storagePolicy: destination === "cloud" ? "local-and-cloud" : "local-only",
          folderId: owner.folderId,
        }),
      registerLocalMedia: (media, owner) => persistMediaItem(media, owner),
      registerCloudMedia: (media, patch, owner) => persistMediaItem(media, owner, patch),
      removeUnregisteredLocalMedia: async (_media, assetId) => {
        if (assetId) await deleteLocalVideoFile(assetId);
      },
      uploadToCloud: uploadDownloadedVideoToMux,
      buildCloudPatch: buildLocalVideoCloudSharePatch,
      viewMedia: (media, owner) => {
        dispatch(setRequestOpenMediaPanel(true));
        dispatch(setIsMediaExpanded(true));
        dispatch(setFocusMediaId(media.id));
        navigateRef.current(owner.routePath || "/controller");
      },
      notifyCloudStorageChanged: () => window.dispatchEvent(new Event(MEDIA_STORAGE_CHANGED_EVENT)),
      transfer,
    });
  }

  const manager = managerRef.current;
  useEffect(() => manager?.attachProgressListener(), [manager]);
  useEffect(() => {
    manager?.handleChurchChange(churchId);
  }, [churchId, manager]);

  const start = useCallback((input: DesktopVideoDownloadInput) => {
    if (!manager) throw new Error("Video downloads are available in the desktop app.");
    return manager.start(input);
  }, [manager]);

  return (
    <DesktopVideoDownloadContext.Provider value={{ start }}>
      {children}
    </DesktopVideoDownloadContext.Provider>
  );
};

export default DesktopVideoDownloadManager;
