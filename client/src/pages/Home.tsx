import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Info,
  Layers,
  LayoutDashboard,
  MessagesSquare,
  Monitor,
  Presentation,
  Projector,
  Radio,
  ScrollText,
  ScreenShare,
  Smartphone,
  Users,
} from "lucide-react";
import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import HomeToolbarMenu from "../components/HomeToolbarMenu/HomeToolbarMenu";
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
import type { MenuItemType } from "../types";

type CardLink = {
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
};

const primaryControllers: CardLink[] = [
  {
    title: "Presentation Controller",
    description:
      "Build and run the main presentation. Arrange service items, edit slides, and send output to projector, monitor, and stream.",
    to: "/controller",
    icon: Presentation,
  },
  {
    title: "Overlay Controller",
    description: "Manage overlays, service timers, credits, and lower thirds for the stream.",
    to: "/overlay-controller",
    icon: Layers,
  },
];

const secondaryControllers: CardLink[] = [
  {
    title: "Board moderation",
    description:
      "Take attendee questions, moderate posts, and send highlights to the presentation screen.",
    to: "/boards/controller",
    icon: MessagesSquare,
  },
  {
    title: "Credits Editor",
    description:
      "Build the credits roll and choose which OBS scene to transition to when credits finish.",
    to: "/credits-editor",
    icon: ScrollText,
  },
];

const adminLinks: CardLink[] = [
  {
    title: "Church administration",
    description:
      "Invite teammates, manage access, pair workstations and displays, recovery and trusted devices, and branding for this church.",
    to: "/account",
    icon: Building2,
  },
  {
    title: "Teams",
    description:
      "Manage scheduling roster people, roles, teams, services, and service assignments.",
    to: "/teams",
    icon: Users,
  },
];

const standaloneDisplays: CardLink[] = [
  {
    title: "Monitor",
    description: "Open the monitor view, move to the desired display, then enter fullscreen when you are ready to show it.",
    to: "/monitor",
    icon: Monitor,
  },
  {
    title: "Projector",
    description: "Open the projector view, move to the desired display, then enter fullscreen when you are ready to show it.",
    to: "/projector",
    icon: Projector,
  },
  {
    title: "Discussion Board",
    description: "Open the discussion board view, move to the desired display, then enter fullscreen when you are ready to show it.",
    to: "/boards/display",
    icon: MessagesSquare,
  },
];

const obsDisplays: CardLink[] = [
  {
    title: "Stream",
    description: "Main program output for a browser source in your streaming software.",
    to: "/stream",
    icon: Radio,
  },
  {
    title: "Stream Info",
    description: "Information pages for a browser source in your streaming software.",
    to: "/stream-info",
    icon: Info,
  },
  {
    title: "Projector",
    description: "Projector-sized output for a browser source in your streaming software.",
    to: "/projector-full",
    icon: Projector,
  },
  {
    title: "Credits",
    description:
      "Credits roll for a browser source. In Credits Editor, choose which scene to switch to after the roll. In OBS, set this Browser Source's page permissions to Advanced access so the page can change scenes when credits finish.",
    to: "/credits",
    icon: ScrollText,
  },
];

const HomeLinkCard = ({ title, description, to, icon }: CardLink) => {
  return (
    <Button
      variant="none"
      to={to}
      component="link"
      className="h-full w-full flex-col items-start gap-3 rounded-2xl border border-gray-600 border-l-4 border-l-orange-400 bg-gray-900 p-5 text-left hover:border-gray-500 hover:border-l-orange-300 hover:bg-gray-800"
      wrap
    >
      <span className="flex w-full items-start gap-3">
        <span aria-hidden className="shrink-0 text-orange-400">
          <Icon
            svg={icon}
            size="lg"
            className="text-orange-400"
            svgClassName="text-orange-400"
          />
        </span>
        <span className="min-w-0 flex-1 text-xl font-semibold">{title}</span>
      </span>
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

const isMobileBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
};

const isIosBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
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

const Welcome = () => {
  const { loginState, role, access, canViewTeams } =
    useContext(GlobalInfoContext) || {};
  const isLoggedIn = loginState === "success";
  const isAdmin = role === "admin";
  const visibleAdminLinks = adminLinks.filter(
    (link) => isAdmin || (link.to === "/teams" && canViewTeams),
  );
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
  const [desktopInstallHelpDialogOpen, setDesktopInstallHelpDialogOpen] =
    useState(false);
  const [mobileInstallHelpDialogOpen, setMobileInstallHelpDialogOpen] =
    useState(false);
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

  return (
    <main className="h-dvh overflow-y-auto bg-homepage-canvas text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 px-4 pb-8">
        <div className="flex w-full items-center justify-between gap-4 border-b border-gray-700 py-3 text-lg">
          <div className="flex flex-wrap items-center gap-2">
            <HomeToolbarMenu extraMenuItems={installMenuItems} />
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

        {visibleAdminLinks.length > 0 && (
          <section className="mx-auto w-full max-w-5xl space-y-3 rounded-xl border border-gray-700 bg-gray-900/40 p-4 sm:p-5">
            <div className="space-y-2 text-center">
              <h2 className="flex items-center justify-center gap-2 text-2xl font-semibold">
                <span aria-hidden className="text-orange-400">
                  <Icon
                    svg={Building2}
                    size="lg"
                    className="text-orange-400"
                    svgClassName="text-orange-400"
                  />
                </span>
                Church administration
              </h2>
              <p className="text-sm text-gray-200">
                People, devices, teams, pairing, recovery, trust, and branding
                for this church.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {visibleAdminLinks.map((link) => (
                <HomeLinkCard key={link.to} {...link} />
              ))}
            </div>
          </section>
        )}

        <section className="mx-auto w-full max-w-5xl space-y-4 rounded-xl border border-gray-700 bg-gray-900/40 p-4 sm:p-5">
          <div className="space-y-2 text-center">
            <h2 className="flex items-center justify-center gap-2 text-2xl font-semibold">
              <span aria-hidden className="text-orange-400">
                <Icon
                  svg={LayoutDashboard}
                  size="lg"
                  className="text-orange-400"
                  svgClassName="text-orange-400"
                />
              </span>
              Controllers
            </h2>
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
                  <h2 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
                    <span aria-hidden className="text-orange-400">
                      <Icon
                        svg={ScreenShare}
                        size="lg"
                        className="text-orange-400"
                        svgClassName="text-orange-400"
                      />
                    </span>
                    Display outputs
                  </h2>
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
            <h2
              id="display-outputs-heading"
              className="flex flex-wrap items-center gap-2 text-2xl font-semibold"
            >
              <span aria-hidden className="text-orange-400">
                <Icon
                  svg={ScreenShare}
                  size="lg"
                  className="text-orange-400"
                  svgClassName="text-orange-400"
                />
              </span>
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
            <DialogTitle className="text-white">Install WorshipSync</DialogTitle>
          </DialogHeader>
          {isiOSWeb ? (
            <p className="text-sm text-gray-200">
              On iPhone and iPad, open Safari&apos;s Share menu, then choose
              {" "}
              <span className="font-semibold text-white">Add to Home Screen</span>
              .
            </p>
          ) : (
            <p className="text-sm text-gray-200">
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
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default Welcome;
