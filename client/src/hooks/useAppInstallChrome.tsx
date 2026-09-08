import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Smartphone } from "lucide-react";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { usePwaInstallPrompt } from "./usePwaInstallPrompt";
import type { MenuItemType } from "../types";
import { getBrowserFamily } from "../utils/browserFamily";
import { isElectron } from "../utils/environment";
import {
  fetchLatestLinuxInstallerUrl,
  fetchLatestMacInstallerUrl,
  fetchLatestWindowsInstallerUrl,
  getLatestReleaseUrl,
} from "../utils/githubRelease";
import { getAppOs, isMobileBrowser } from "../utils/platform";
import { getPwaInstallGuidance } from "../utils/pwaInstallGuidance";

type DesktopOs = "windows" | "mac" | "linux";

type DesktopDownloadHelpProps = {
  os: DesktopOs;
  onTryAgain: () => void;
  /** When false, omit the inline heading (e.g. when DialogTitle is used). */
  showHeading?: boolean;
};

const getDesktopDownloadButtonLabel = (os: DesktopOs) => {
  if (os === "windows") return "Download Windows app";
  if (os === "mac") return "Download Mac app";
  return "Download Linux app";
};

const getDesktopDownloadHelpAriaLabel = (os: DesktopOs) => {
  if (os === "windows") return "Windows download help";
  if (os === "mac") return "Mac download help";
  return "Linux download help";
};

const getDesktopDownloadHelpTitle = (os: DesktopOs) => {
  if (os === "windows") return "Download for Windows";
  if (os === "mac") return "Download for Mac";
  return "Download for Linux";
};

const DesktopDownloadHelp = ({
  os,
  onTryAgain,
  showHeading = true,
}: DesktopDownloadHelpProps) => {
  const releaseLink = (
    <a
      href={getLatestReleaseUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-gray-100 underline underline-offset-2 hover:text-white"
    >
      release page
    </a>
  );

  let body: ReactNode;
  if (os === "windows") {
    body = (
      <>
        Your download should begin automatically. If it does not, try again or
        open the {releaseLink} and choose the Windows installer from Assets.
      </>
    );
  } else if (os === "mac") {
    body = (
      <>
        Your download should begin automatically. If it does not, try again or
        open the {releaseLink} and choose the Mac disk image (.dmg) from Assets.
        If macOS warns that the app cannot be checked for malicious software,
        Control-click WorshipSync in Finder, choose Open, then confirm.
      </>
    );
  } else {
    body = (
      <>
        Your download should begin automatically. If it does not, try again or
        open the {releaseLink} and choose the Linux AppImage or .deb from
        Assets. AppImage runs without installing a package; use the .deb if you
        prefer a system package.
      </>
    );
  }

  return (
    <>
      {showHeading ? (
        <p className="text-sm font-semibold text-white">
          {getDesktopDownloadHelpTitle(os)}
        </p>
      ) : null}
      <p className={showHeading ? "mt-2 text-sm" : "text-sm"}>{body}</p>

      <div className="mt-3 flex flex-col gap-2">
        <Button
          component="button"
          variant="tertiary"
          className="w-full"
          onClick={onTryAgain}
        >
          Download again
        </Button>
      </div>
    </>
  );
};

export type AppInstallChrome = {
  installMenuItems: MenuItemType[];
  installHelpDialogs: ReactNode;
};

/**
 * Shared Install menu + help dialogs used on Home and App Entry (and any
 * other surface that should offer desktop download / PWA install).
 */
export const useAppInstallChrome = (): AppInstallChrome => {
  const { canShowInstall, installPwa, isStandalone } = usePwaInstallPrompt();
  const isWeb = !isElectron();
  const desktopOs = useMemo((): DesktopOs | null => {
    if (!isWeb) return null;
    // `getAppOs` resolves ios/android first, so an iPad — which reports a
    // desktop "Macintosh" user agent — no longer falls through to "mac" and
    // gets offered a Mac installer it cannot run.
    const os = getAppOs();
    if (os === "windows" || os === "mac" || os === "linux") return os;
    return null;
  }, [isWeb]);

  const [installerHref, setInstallerHref] = useState(() =>
    isElectron() ? "" : getLatestReleaseUrl(),
  );
  const [desktopInstallHelpDialogOpen, setDesktopInstallHelpDialogOpen] =
    useState(false);
  const [mobileInstallHelpDialogOpen, setMobileInstallHelpDialogOpen] =
    useState(false);
  const isMobileWeb = useMemo(() => isWeb && isMobileBrowser(), [isWeb]);
  const mobileInstallGuidance = useMemo(
    () =>
      getPwaInstallGuidance({
        os: getAppOs(),
        browser: getBrowserFamily(),
      }),
    [],
  );

  useEffect(() => {
    if (isElectron() || !desktopOs) return;
    let cancelled = false;
    let fetcher: () => Promise<string | null>;
    if (desktopOs === "windows") {
      fetcher = fetchLatestWindowsInstallerUrl;
    } else if (desktopOs === "mac") {
      fetcher = fetchLatestMacInstallerUrl;
    } else {
      fetcher = fetchLatestLinuxInstallerUrl;
    }
    void fetcher().then((directUrl) => {
      if (!cancelled && directUrl) {
        setInstallerHref(directUrl);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [desktopOs]);

  const openInstallerDownload = useCallback(() => {
    window.open(installerHref, "_blank", "noopener,noreferrer");
  }, [installerHref]);

  const handleDownloadInstallerClick = () => {
    openInstallerDownload();
  };

  /** One desktop web entry point avoids a toolbar flash when `beforeinstallprompt` arrives after first paint. */
  const showDesktopAppMenu = desktopOs !== null && !isStandalone;
  const showMobileInstallButton = isMobileWeb && !desktopOs && !isStandalone;

  const installMenuItems = useMemo((): MenuItemType[] => {
    const items: MenuItemType[] = [];
    if (showDesktopAppMenu && desktopOs) {
      items.push({
        element: (
          <div className="flex items-center gap-2 max-md:min-h-12">
            <Icon svg={Smartphone} color="#d1d5dc" />
            Install
          </div>
        ),
        subItems: [
          ...(canShowInstall
            ? [
              {
                text: "Install app",
                onClick: () => {
                  void installPwa();
                },
              },
            ]
            : []),
          {
            text: getDesktopDownloadButtonLabel(desktopOs),
            onClick: () => {
              openInstallerDownload();
              setDesktopInstallHelpDialogOpen(true);
            },
          },
        ],
      });
    } else if (showMobileInstallButton) {
      items.push({
        element: (
          <div className="flex items-center gap-2 max-md:min-h-12">
            <Icon svg={Smartphone} color="#d1d5dc" />
            Install
          </div>
        ),
        onClick: () => {
          if (canShowInstall) {
            void installPwa();
          } else {
            setMobileInstallHelpDialogOpen(true);
          }
        },
      });
    }
    return items;
  }, [
    canShowInstall,
    desktopOs,
    installPwa,
    openInstallerDownload,
    showDesktopAppMenu,
    showMobileInstallButton,
  ]);

  const installHelpDialogs = (
    <>
      {desktopOs ? (
        <Dialog
          open={desktopInstallHelpDialogOpen}
          onOpenChange={setDesktopInstallHelpDialogOpen}
        >
          <DialogContent
            className="border-gray-600 bg-gray-800 text-gray-100"
            aria-describedby={undefined}
            aria-label={getDesktopDownloadHelpAriaLabel(desktopOs)}
          >
            <DialogHeader>
              <DialogTitle className="text-white">
                {getDesktopDownloadHelpTitle(desktopOs)}
              </DialogTitle>
            </DialogHeader>
            <DesktopDownloadHelp
              os={desktopOs}
              onTryAgain={handleDownloadInstallerClick}
              showHeading={false}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog
        open={mobileInstallHelpDialogOpen}
        onOpenChange={setMobileInstallHelpDialogOpen}
      >
        <DialogContent
          className="border-gray-600 bg-gray-800 text-gray-100"
          aria-describedby={undefined}
          aria-label="Mobile install instructions"
        >
          <DialogHeader>
            <DialogTitle className="text-white">
              {mobileInstallGuidance.title}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-200">
            {mobileInstallGuidance.segments.map((segment, index) =>
              segment.type === "emphasis" ? (
                <span key={index} className="font-semibold text-white">
                  {segment.value}
                </span>
              ) : (
                <span key={index}>{segment.value}</span>
              ),
            )}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );

  return { installMenuItems, installHelpDialogs };
};
