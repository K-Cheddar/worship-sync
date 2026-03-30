import { useContext, useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";
import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import Button from "../components/Button/Button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/Popover";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import { usePwaInstallPrompt } from "../hooks/usePwaInstallPrompt";
import { isElectron, isWindowsBrowser } from "../utils/environment";
import {
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
    description: "Manage overlays, graphics, and lower thirds for the stream.",
    to: "/overlay-controller",
  },
];

const secondaryControllers: CardLink[] = [
  {
    title: "Credits Editor",
    description:
      "Build the credits roll and choose which OBS scene to transition to when credits finish.",
    to: "/credits-editor",
  },
  {
    title: "Info Controller",
    description: "Prepare the information pages used during the service.",
    to: "/info-controller",
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
      className="h-full w-full flex-col items-start gap-3 rounded-2xl border border-gray-500 bg-gray-800 p-5 text-left hover:border-gray-300 hover:bg-gray-700"
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
    <div className="rounded-xl border border-gray-600 bg-gray-900/40 p-4">
      <h3 className="text-base font-semibold text-white">{heading}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-gray-300">{description}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {links.map((link) => (
          <HomeLinkCard key={link.to} {...link} />
        ))}
      </div>
    </div>
  );
};

const Welcome = () => {
  const { loginState } = useContext(GlobalInfoContext) || {};
  const { logout } = useContext(ControllerInfoContext) || {};
  const isLoggedIn = loginState === "success";
  const { canShowInstall, installPwa } = usePwaInstallPrompt();
  const [windowsDownloadHref, setWindowsDownloadHref] = useState(
    getLatestReleaseUrl,
  );

  useEffect(() => {
    let cancelled = false;
    fetchLatestWindowsInstallerUrl().then((directUrl) => {
      if (!cancelled && directUrl) {
        setWindowsDownloadHref(directUrl);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openWindowsDownload = () => {
    window.open(windowsDownloadHref, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="h-dvh overflow-y-auto bg-gray-700 text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 pb-10">
        <div className="flex w-full items-center justify-between gap-4 py-3 text-lg">
          <div className="flex flex-wrap items-center gap-2">
            {!isElectron() && isWindowsBrowser() && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    component="button"
                    variant="tertiary"
                    className="flex items-center gap-2"
                    svg={Download}
                    iconSize="md"
                    onClick={openWindowsDownload}
                  >
                    Download Windows App
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="bottom"
                  sideOffset={8}
                  className="w-80 max-w-[min(100vw-2rem,20rem)] border border-gray-500 bg-gray-800 p-4 text-gray-100 shadow-xl"
                >
                  <p className="text-sm font-semibold text-white">
                    Download for Windows
                  </p>
                  <p className="mt-2 text-sm">
                    Your download should start in a new browser tab. If it does
                    not, try again or open the
                    {" "}
                    <a
                      href={getLatestReleaseUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-gray-100 underline underline-offset-2 hover:text-white"
                    >
                      release page
                    </a>
                    {" "}
                    and choose the Windows installer from Assets.
                  </p>
                  <Button
                    component="button"
                    variant="tertiary"
                    className="mt-3"
                    onClick={openWindowsDownload}
                  >
                    Try download again
                  </Button>
                </PopoverContent>
              </Popover>
            )}
            {!isElectron() && canShowInstall && (
              <Button
                component="button"
                variant="tertiary"
                className="flex items-center gap-2"
                svg={Smartphone}
                iconSize="md"
                onClick={() => void installPwa()}
              >
                Install app
              </Button>
            )}
          </div>
          <div className="flex flex-1 justify-end gap-4">
            <Button
              variant="tertiary"
              onClick={isLoggedIn && logout ? logout : undefined}
              padding="px-4 py-1"
              component={!isLoggedIn ? "link" : "button"}
              to={!isLoggedIn ? "/login" : "/"}
            >
              {!isLoggedIn ? "Login" : "Logout"}
            </Button>
            <UserSection />
          </div>
        </div>

        <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 pt-4 text-center">
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
              For the most complete setup, use the Windows desktop app. Most
              browsers also work well.
            </p>
          </div>
        </section>

        <section className="mx-auto mt-6 w-full max-w-5xl space-y-6">
          <div className="space-y-2 text-center">
            <h2 className="text-2xl font-semibold">Controllers</h2>
            <p className="text-sm text-gray-200">
              These are the pages most teams use during the service.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {primaryControllers.map((link) => (
              <HomeLinkCard key={link.to} {...link} />
            ))}
          </div>

          <p className="pt-2 text-center text-sm font-medium text-gray-300 md:text-left">
            Credits and info
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {secondaryControllers.map((link) => (
              <HomeLinkCard key={link.to} {...link} />
            ))}
          </div>
        </section>

        <details className="mx-auto mt-8 w-full max-w-5xl rounded-2xl border border-gray-500 px-5 py-4">
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

          <div className="mt-6 space-y-5 border-t border-gray-600 pt-6">
            <DisplayLinkGroup
              heading="Fullscreen in the browser"
              description="For a computer wired to a projector or monitor. Open the page on that machine, then click the button to enter fullscreen."
              links={standaloneDisplays}
            />
            <DisplayLinkGroup
              heading="Browser sources (streaming)"
              description="Add each URL as a browser source or browser input in OBS, vMix, or other streaming tools."
              links={obsDisplays}
            />
          </div>
        </details>
      </div>
    </main>
  );
};

export default Welcome;
