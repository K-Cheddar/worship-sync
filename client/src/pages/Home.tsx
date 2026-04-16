import {
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Download, Smartphone } from "lucide-react";
import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import Button from "../components/Button/Button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/Popover";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import { GlobalInfoContext } from "../context/globalInfo";
import { usePwaInstallPrompt } from "../hooks/usePwaInstallPrompt";
import {
  isElectron,
  isLinuxBrowser,
  isMacBrowser,
  isWindowsBrowser,
} from "../utils/environment";
import {
  fetchLatestLinuxInstallerUrl,
  fetchLatestMacInstallerUrl,
  fetchLatestWindowsInstallerUrl,
  getLatestReleaseUrl,
} from "../utils/githubRelease";

type CardLink = {
  title: string;
  description: string;
  to: string;
};

const primaryControllers: CardLink[] = [
  {
    title: "Presentation Controller",
    description:
      "Build and run the main presentation. Arrange service items, edit slides, and send output to projector, monitor, and stream.",
    to: "/controller",
  },
  {
    title: "Overlay Controller",
    description: "Manage overlays, service timers, credits, and lower thirds for the stream.",
    to: "/overlay-controller",
  },
];

const secondaryControllers: CardLink[] = [
  {
    title: "Board moderation",
    description:
      "Take attendee questions, moderate posts, and send highlights to the presentation screen.",
    to: "/boards/controller",
  },
  {
    title: "Credits Editor",
    description:
      "Build the credits roll and choose which OBS scene to transition to when credits finish.",
    to: "/credits-editor",
  },
];

const adminLinks: CardLink[] = [
  {
    title: "Church administration",
    description:
      "Invite teammates, manage access, pair workstations and displays, recovery and trusted devices, and branding for this church.",
    to: "/account",
  },
];

const standaloneDisplays: CardLink[] = [
  {
    title: "Monitor",
    description: "Open the monitor view, move to the desired display, then enter fullscreen when you are ready to show it.",
    to: "/monitor",
  },
  {
    title: "Projector",
    description: "Open the projector view, move to the desired display, then enter fullscreen when you are ready to show it.",
    to: "/projector",
  },
];

const obsDisplays: CardLink[] = [
  {
    title: "Stream",
    description: "Main program output for a browser source in your streaming software.",
    to: "/stream",
  },
  {
    title: "Stream Info",
    description: "Information pages for a browser source in your streaming software.",
    to: "/stream-info",
  },
  {
    title: "Projector",
    description: "Projector-sized output for a browser source in your streaming software.",
    to: "/projector-full",
  },
  {
    title: "Credits",
    description:
      "Credits roll for a browser source. In Credits Editor, choose which scene to switch to after the roll. In OBS, set this Browser Source's page permissions to Advanced access so the page can change scenes when credits finish.",
    to: "/credits",
  },
];

const HomeLinkCard = ({ title, description, to }: CardLink) => {
  return (
    <Button
      variant="none"
      to={to}
      component="link"
      className="h-full w-full flex-col items-start gap-3 rounded-2xl border border-gray-600 border-l-4 border-l-orange-400 bg-gray-900 p-5 text-left hover:border-gray-500 hover:border-l-orange-300 hover:bg-gray-800"
      wrap
    >
      <span className="text-xl font-semibold">{title}</span>
      <span className="text-sm font-normal text-gray-200">{description}</span>
    </Button>
  );
};

type DisplayLinkGroupProps = {
  heading: string;
  description: string;
  links: CardLink[];
};

const DisplayLinkGroup = ({
  heading,
  description,
  links,
}: DisplayLinkGroupProps) => {
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-white">{heading}</h3>
      <p className="text-sm leading-relaxed text-gray-300">{description}</p>
      <div className="grid gap-4 pt-1 md:grid-cols-2">
        {links.map((link) => (
          <HomeLinkCard key={link.to} {...link} />
        ))}
      </div>
    </div>
  );
};

type DesktopOs = "windows" | "mac" | "linux";

type DesktopDownloadHelpProps = {
  os: DesktopOs;
  onTryAgain: () => void;
};

type DesktopInstallPopoverView = "menu" | "downloadHelp";

const getDesktopInstallMenuBody = (os: DesktopOs, canInstall: boolean) => {
  if (os === "windows") {
    return canInstall
      ? "Install as an app in this browser for quick access, or download the Windows installer for the desktop app."
      : "Download the Windows installer for the desktop app.";
  }
  if (os === "mac") {
    return canInstall
      ? "Install as an app in this browser for quick access, or download the Mac disk image (DMG) for the desktop app."
      : "Download the Mac disk image (DMG) for the desktop app.";
  }
  return canInstall
    ? "Install as an app in this browser for quick access, or download the Linux desktop app (AppImage or Debian package)."
    : "Download the Linux desktop app (AppImage or Debian package).";
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

const isMobileBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
};

const isIosBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
};

const DesktopDownloadHelp = ({ os, onTryAgain }: DesktopDownloadHelpProps) => {
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
        Your download should begin automatically. If it does not, try again
        or open the {releaseLink} and choose the Windows installer from Assets.
      </>
    );
  } else if (os === "mac") {
    body = (
      <>
        Your download should begin automatically. If it does not, try again
        or open the {releaseLink} and choose the Mac disk image (.dmg) from
        Assets. If macOS warns that the app cannot be checked for malicious
        software, Control-click WorshipSync in Finder, choose Open, then
        confirm.
      </>
    );
  } else {
    body = (
      <>
        Your download should begin automatically. If it does not, try again
        or open the {releaseLink} and choose the Linux AppImage or .deb from
        Assets. AppImage runs without installing a package; use the .deb if you
        prefer a system package.
      </>
    );
  }

  return (
    <>
      <p className="text-sm font-semibold text-white">
        {getDesktopDownloadHelpTitle(os)}
      </p>
      <p className="mt-2 text-sm">{body}</p>

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

const Welcome = () => {
  const { loginState, role, access } = useContext(GlobalInfoContext) || {};
  const isLoggedIn = loginState === "success";
  const isAdmin = role === "admin";
  const isMusicAccess = isLoggedIn && access === "music";
  const visiblePrimaryControllers = isMusicAccess
    ? primaryControllers.filter((link) => link.to === "/controller")
    : primaryControllers;
  const visibleSecondaryControllers = isMusicAccess
    ? []
    : isLoggedIn
      ? secondaryControllers.filter((link) => {
        if (access === "view") {
          return link.to !== "/boards/controller";
        }
        return true;
      })
      : secondaryControllers.filter((link) => link.to !== "/boards/controller");
  const { canShowInstall, installPwa, isStandalone } = usePwaInstallPrompt();
  const isWeb = !isElectron();
  const desktopOs = useMemo((): DesktopOs | null => {
    if (!isWeb) return null;
    if (isWindowsBrowser()) return "windows";
    if (isMacBrowser()) return "mac";
    if (isLinuxBrowser()) return "linux";
    return null;
  }, [isWeb]);

  const [installerHref, setInstallerHref] = useState(() =>
    isElectron() ? "" : getLatestReleaseUrl(),
  );
  const [desktopAppMenuOpen, setDesktopAppMenuOpen] = useState(false);
  const [desktopInstallPopoverView, setDesktopInstallPopoverView] =
    useState<DesktopInstallPopoverView>("menu");
  const [mobileInstallHelpOpen, setMobileInstallHelpOpen] = useState(false);
  const isMobileWeb = useMemo(() => isWeb && isMobileBrowser(), [isWeb]);
  const isiOSWeb = useMemo(() => isWeb && isIosBrowser(), [isWeb]);

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

  const openInstallerDownload = () => {
    window.open(installerHref, "_blank", "noopener,noreferrer");
  };

  const handleDownloadInstallerClick = () => {
    openInstallerDownload();
  };

  const handleDesktopInstallPopoverOpenChange = (open: boolean) => {
    setDesktopAppMenuOpen(open);
    if (!open) setDesktopInstallPopoverView("menu");
  };

  const handleInstallAppClick = () => {
    handleDesktopInstallPopoverOpenChange(false);
    void installPwa();
  };

  const handleDownloadDesktopFromMenu = () => {
    openInstallerDownload();
    setDesktopInstallPopoverView("downloadHelp");
  };

  /** One desktop web entry point avoids a toolbar flash when `beforeinstallprompt` arrives after first paint. */
  const showDesktopAppMenu = desktopOs !== null && !isStandalone;
  const showMobileInstallButton = isMobileWeb && !desktopOs && !isStandalone;

  const popoverSurfaceClass =
    "w-80 max-w-[min(100vw-2rem,20rem)] border border-gray-500 bg-gray-800 p-4 text-gray-100 shadow-xl";

  return (
    <main className="h-dvh overflow-y-auto bg-homepage-canvas text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 px-4 pb-8">
        <div className="flex w-full items-center justify-between gap-4 border-b border-gray-700 py-3 text-lg">
          <div className="flex flex-wrap items-center gap-2">
            {showDesktopAppMenu && desktopOs && (
              <div className="relative inline-flex">
                <Popover
                  open={desktopAppMenuOpen}
                  onOpenChange={handleDesktopInstallPopoverOpenChange}
                  modal={false}
                >
                  <PopoverTrigger asChild>
                    <Button
                      component="button"
                      variant="tertiary"
                      className="flex items-center gap-2"
                      svg={Smartphone}
                      iconSize="md"
                    >
                      Install
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="bottom"
                    sideOffset={8}
                    className={popoverSurfaceClass}
                    aria-label={
                      desktopInstallPopoverView === "downloadHelp"
                        ? getDesktopDownloadHelpAriaLabel(desktopOs)
                        : undefined
                    }
                  >
                    {desktopInstallPopoverView === "menu" ? (
                      <>
                        <p className="text-sm font-semibold text-white">
                          Choose how to run WorshipSync
                        </p>
                        <p className="mt-1.5 text-sm text-gray-200">
                          {getDesktopInstallMenuBody(desktopOs, canShowInstall)}
                        </p>
                        <div className="mt-3 flex flex-col gap-2">
                          {canShowInstall && (
                            <Button
                              component="button"
                              variant="tertiary"
                              className="flex w-full items-center justify-center gap-2"
                              svg={Smartphone}
                              iconSize="md"
                              onClick={handleInstallAppClick}
                            >
                              Install app
                            </Button>
                          )}
                          <Button
                            component="button"
                            variant="tertiary"
                            className="flex w-full items-center justify-center gap-2"
                            svg={Download}
                            iconSize="md"
                            onClick={handleDownloadDesktopFromMenu}
                          >
                            {getDesktopDownloadButtonLabel(desktopOs)}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <DesktopDownloadHelp
                        os={desktopOs}
                        onTryAgain={handleDownloadInstallerClick}
                      />
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            )}
            {showMobileInstallButton && (
              canShowInstall ? (
                <Button
                  component="button"
                  variant="tertiary"
                  className="flex items-center gap-2"
                  svg={Smartphone}
                  iconSize="md"
                  onClick={() => {
                    void installPwa();
                  }}
                >
                  Install
                </Button>
              ) : (
                <Popover
                  open={mobileInstallHelpOpen}
                  onOpenChange={setMobileInstallHelpOpen}
                  modal={false}
                >
                  <PopoverTrigger asChild>
                    <Button
                      component="button"
                      variant="tertiary"
                      className="flex items-center gap-2"
                      svg={Smartphone}
                      iconSize="md"
                    >
                      Install
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="bottom"
                    sideOffset={8}
                    className={popoverSurfaceClass}
                    aria-label="Mobile install instructions"
                  >
                    <p className="text-sm font-semibold text-white">
                      Install WorshipSync
                    </p>
                    {isiOSWeb ? (
                      <p className="mt-1.5 text-sm text-gray-200">
                        On iPhone and iPad, open Safari&apos;s Share menu, then choose
                        {" "}
                        <span className="font-semibold text-white">Add to Home Screen</span>
                        .
                      </p>
                    ) : (
                      <p className="mt-1.5 text-sm text-gray-200">
                        Open your browser menu and choose
                        {" "}
                        <span className="font-semibold text-white">Install app</span>
                        {" "}
                        or
                        {" "}
                        <span className="font-semibold text-white">Add to Home screen</span>
                        .
                      </p>
                    )}
                  </PopoverContent>
                </Popover>
              )
            )}
          </div>
          <div className="flex flex-1 justify-end gap-4">
            {!isLoggedIn ? (
              <Button
                variant="tertiary"
                component="link"
                to="/login"
                padding="px-4 py-1"
              >
                Sign in
              </Button>
            ) : null}
            <UserSection />
          </div>
        </div>

        <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-5 pt-4 text-center">
          <img
            src={WorshipSyncImage}
            alt="WorshipSync"
            className="max-w-[75%]"
            width={360}
            height={330}
            loading="eager"
          />
          <div className="space-y-3">
            <p className="mx-auto max-w-3xl text-lg text-gray-100">
              Present slides and media, manage overlays, timers, and credits,
              and keep each display in sync during the service.
            </p>
            <p className="mx-auto max-w-3xl text-sm text-gray-200 md:hidden">
              For the full experience on room outputs, use the Windows or Mac desktop app.
              Most browsers also work well.
            </p>
          </div>
        </section>

        {isAdmin && (
          <section className="mx-auto w-full max-w-5xl space-y-3 rounded-xl border border-gray-700 bg-gray-900/40 p-4 sm:p-5">
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-semibold">Church administration</h2>
              <p className="text-sm text-gray-200">
                People, devices, pairing, recovery, trust, and branding for
                this church.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {adminLinks.map((link) => (
                <HomeLinkCard key={link.to} {...link} />
              ))}
            </div>
          </section>
        )}

        <section className="mx-auto w-full max-w-5xl space-y-4 rounded-xl border border-gray-700 bg-gray-900/40 p-4 sm:p-5">
          <div className="space-y-2 text-center">
            <h2 className="text-2xl font-semibold">Controllers</h2>
            <p className="text-sm text-gray-200">
              These are the pages most teams use during the service.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {visiblePrimaryControllers.map((link) => (
              <HomeLinkCard key={link.to} {...link} />
            ))}
          </div>

          {visibleSecondaryControllers.length > 0 && (
            <div className="space-y-3 border-t border-gray-700 pt-4">
              <p className="text-center text-sm font-medium text-gray-300 md:text-left">
                Credits and board moderation
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {visibleSecondaryControllers.map((link) => (
                  <HomeLinkCard key={link.to} {...link} />
                ))}
              </div>
            </div>
          )}
        </section>

        {isLoggedIn && access === "full" ? (
          <details className="mx-auto w-full max-w-5xl rounded-xl border border-gray-700 bg-gray-900/40 p-4 sm:p-5">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-col gap-2 text-left md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold">Display outputs</h2>
                  <p className="text-sm text-gray-200">
                    URLs for room screens or browser sources in streaming software.
                  </p>
                </div>
                <span className="shrink-0 self-start rounded-full border border-gray-400 px-3 py-1 text-sm font-semibold text-gray-100 md:self-center">
                  Show display links
                </span>
              </div>
            </summary>

            <div className="mt-4 space-y-4 border-t border-gray-700 pt-4">
              <DisplayLinkGroup
                heading="Fullscreen in the browser"
                description="For a computer wired to a projector or monitor. Open the page on that machine, then click the button to enter fullscreen."
                links={standaloneDisplays}
              />
              <div className="border-t border-gray-700 pt-4">
                <DisplayLinkGroup
                  heading="Browser sources (streaming)"
                  description="Add each URL as a browser source or browser input in OBS, vMix, or other streaming tools."
                  links={obsDisplays}
                />
              </div>
            </div>
          </details>
        ) : !isLoggedIn ? (
          <section
            className="mx-auto w-full max-w-5xl rounded-xl border border-gray-700 bg-gray-900/40 p-4 sm:p-5"
            aria-labelledby="display-outputs-heading"
          >
            <h2 id="display-outputs-heading" className="text-2xl font-semibold">
              Display outputs
            </h2>
            <p className="mt-1.5 text-sm text-gray-200">
              URLs for room screens or browser sources in streaming software.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-gray-300">
              Sign in to show display links. Projector, monitor, and stream pages
              require a signed-in account or a linked display device, so those
              URLs are available after you authenticate.
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
};

export default Welcome;
