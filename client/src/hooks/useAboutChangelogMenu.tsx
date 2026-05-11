import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CircleAlert, Info, ScrollText } from "lucide-react";
import Icon from "../components/Icon/Icon";
import ChangelogModal from "../components/ChangelogModal/ChangelogModal";
import AboutModal from "../components/AboutModal/AboutModal";
import type { MenuItemType } from "../types";
import { useElectronWindows } from "./useElectronWindows";

export const useAboutChangelogMenu = (): {
  aboutChangelogMenuItems: MenuItemType[];
  aboutChangelogModals: ReactNode;
  updateReadyVersion: string;
} => {
  const { isElectron } = useElectronWindows();
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [updateReadyVersion, setUpdateReadyVersion] = useState("");

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onUpdateDownloaded) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void window.electronAPI
      .getDesktopUpdateCapabilities?.()
      .then((caps) => {
        if (cancelled || !caps?.autoUpdate) {
          return;
        }
        unsubscribe = window.electronAPI?.onUpdateDownloaded?.((info) => {
          setUpdateReadyVersion(info.version);
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        unsubscribe = window.electronAPI?.onUpdateDownloaded?.((info) => {
          setUpdateReadyVersion(info.version);
        });
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [isElectron]);

  const aboutChangelogMenuItems = useMemo(
    () => [
      {
        element: (
          <div className="flex items-center gap-2 max-md:min-h-12">
            <Icon svg={ScrollText} color="#d1d5dc" />
            Changelog
          </div>
        ),
        onClick: () => setIsChangelogOpen(true),
      },
      {
        element: (
          <div className="flex items-center gap-2 max-md:min-h-12">
            <Icon svg={Info} color="#d1d5dc" />
            About
            {updateReadyVersion ? (
              <Icon svg={CircleAlert} color="#f59e0b" size="sm" />
            ) : null}
          </div>
        ),
        onClick: () => setIsAboutOpen(true),
      },
    ],
    [updateReadyVersion],
  );

  const aboutChangelogModals = useMemo(
    () => (
      <>
        <ChangelogModal
          isOpen={isChangelogOpen}
          onClose={() => setIsChangelogOpen(false)}
        />
        <AboutModal
          isOpen={isAboutOpen}
          onClose={() => setIsAboutOpen(false)}
          updateReadyVersion={updateReadyVersion}
        />
      </>
    ),
    [isChangelogOpen, isAboutOpen, updateReadyVersion],
  );

  return {
    aboutChangelogMenuItems,
    aboutChangelogModals,
    updateReadyVersion,
  };
};
