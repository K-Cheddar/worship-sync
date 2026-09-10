import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarClock,
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
  Users,
} from "lucide-react";
import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import Modal from "../components/Modal/Modal";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import HomeToolbarMenu from "../components/HomeToolbarMenu/HomeToolbarMenu";
import { GlobalInfoContext } from "../context/globalInfo";
import { useAppInstallChrome } from "../hooks/useAppInstallChrome";
import { isMemberOnlyAccess, isViewOnlyAccess } from "../utils/accessTiers";
import { useSelector } from "../hooks";
import { selectControllerProfiles } from "../store/controllerProfilesSlice";
import { selectDisplayOutputs } from "../store/displayOutputsSlice";
import {
  findControllerProfile,
  getAuxControllerProfiles,
  getControllerProfileDescription,
  OVERLAY_CONTROLLER_ID,
  PRESENTATION_CONTROLLER_ID,
} from "../utils/controllerProfiles";
import {
  getDisplayOutputBrowserSourceHomePath,
  getDisplayOutputFullscreenHomePath,
  getEnabledDisplayOutputs,
} from "../utils/displayOutputs";

type CardLink = {
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
};

const primaryControllerTemplates: Omit<CardLink, "title" | "description">[] = [
  {
    to: "/controller",
    icon: Presentation,
  },
  {
    to: "/overlay-controller",
    icon: Layers,
  },
];

const currentPlanLink: CardLink = {
  title: "Service Workspace",
  description:
    "Open the live workspace for the current service, with service plan and display previews together.",
  to: "/current-service",
  icon: LayoutDashboard,
};

/** The only surface a `member` gets: their own assignments, nothing else. */
const mySchedulelink: CardLink = {
  title: "My schedule",
  description:
    "See the services and positions you are scheduled for, and when they start.",
  to: "/my-schedule",
  icon: CalendarClock,
};

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
    title: "Teams and Services",
    description:
      "Manage scheduling roster, positions, teams, and schedule assignments, plus service times and order-of-service plans.",
    to: "/teams-and-services",
    icon: Users,
  },
];

/** Features shown to guests as locked previews (not navigable without sign-in). */
const guestLockedFeatures: CardLink[] = [
  adminLinks[1],
  secondaryControllers[0],
  adminLinks[0],
  {
    title: "Display outputs",
    description:
      "URLs for room screens or browser sources in streaming software.",
    to: "/projector",
    icon: ScreenShare,
  },
];

type LockedFeaturePrompt = {
  title: string;
};

const displayOutputIcon = (type: string): LucideIcon => {
  if (type === "monitor") return Monitor;
  if (type === "projector") return Projector;
  if (type === "stream") return Radio;
  if (type === "stream-info") return Info;
  if (type === "credits") return ScrollText;
  if (type === "board") return MessagesSquare;
  return ScreenShare;
};

const displayOutputFullscreenDescription = (type: string) => {
  if (type === "board") {
    return "Open the discussion board view, move to the desired display, then enter fullscreen when you are ready to show it.";
  }
  if (type === "monitor") {
    return "Open the monitor view, move to the desired display, then enter fullscreen when you are ready to show it.";
  }
  return "Open the projector view, move to the desired display, then enter fullscreen when you are ready to show it.";
};

const displayOutputBrowserSourceDescription = (type: string) => {
  if (type === "stream") {
    return "Main program output for a browser source in your streaming software.";
  }
  if (type === "stream-info") {
    return "Information pages for a browser source in your streaming software.";
  }
  if (type === "credits") {
    return "Credits roll for a browser source. In Credits Editor, choose which scene to switch to after the roll. In OBS, set this Browser Source's page permissions to Advanced access so the page can change scenes when credits finish.";
  }
  return "Projector-sized output for a browser source in your streaming software.";
};

const HomeLinkCard = ({ title, description, to, icon }: CardLink) => {
  const navigate = useNavigate();
  const navigationTimeoutRef = useRef<number | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current !== null) {
        window.clearTimeout(navigationTimeoutRef.current);
      }
    };
  }, []);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Let the shared Button preserve its existing behavior for modified and
    // non-primary clicks. A zero-delay handoff gives the pending state one
    // paint before the lazy route replaces the home screen.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    setIsPending(true);
    navigationTimeoutRef.current = window.setTimeout(() => {
      navigationTimeoutRef.current = null;
      navigate(to);
    }, 0);
  };

  return (
    <Button
      variant="none"
      to={to}
      component="link"
      aria-busy={isPending}
      isLoading={isPending}
      onClick={handleClick}
      className={`h-full min-w-0 w-full flex-col items-start gap-3 rounded-2xl border border-gray-600 border-l-4 border-l-orange-400 bg-gray-900 p-5 text-left hover:border-gray-500 hover:border-l-orange-300 hover:bg-gray-800 ${isPending
        ? "border-orange-300 border-l-orange-200 bg-gray-800 ring-2 ring-orange-400/40"
        : ""
        }`}
      wrap
    >
      <span className="flex w-full min-w-0 items-start gap-3">
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
      <span className="block w-full min-w-0 text-sm font-normal text-gray-200 whitespace-normal break-words">
        {description}
      </span>
    </Button>
  );
};

type HomeLockedFeatureCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  onSelect: () => void;
};

const HomeLockedFeatureCard = ({
  title,
  description,
  icon,
  onSelect,
}: HomeLockedFeatureCardProps) => {
  return (
    <Button
      variant="none"
      component="button"
      type="button"
      onClick={onSelect}
      className="h-full min-w-0 w-full cursor-pointer flex-col items-start gap-3 rounded-2xl border border-gray-700 border-l-4 border-l-gray-500 bg-gray-950/60 p-5 text-left opacity-80 hover:border-gray-600 hover:bg-gray-900/80 hover:opacity-100"
      wrap
      aria-label={`${title}. Sign in required.`}
    >
      <span className="flex w-full min-w-0 items-start gap-3">
        <span aria-hidden className="shrink-0 text-gray-400">
          <Icon
            svg={icon}
            size="lg"
            className="text-gray-400"
            svgClassName="text-gray-400"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-semibold text-gray-100">{title}</span>
            <span className="rounded border border-gray-500 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-gray-300">
              Sign in required
            </span>
          </span>
        </span>
      </span>
      <span className="block w-full min-w-0 text-sm font-normal text-gray-400 whitespace-normal break-words">
        {description}
      </span>
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
          <HomeLinkCard key={`${link.to}:${link.title}`} {...link} />
        ))}
      </div>
    </div>
  );
};

const Welcome = () => {
  const { loginState, role, access, canViewTeams, sessionKind } =
    useContext(GlobalInfoContext) || {};
  const { installMenuItems, installHelpDialogs } = useAppInstallChrome();
  const controllerProfiles = useSelector(selectControllerProfiles);
  const displayOutputs = useSelector(selectDisplayOutputs);
  const [lockedFeaturePrompt, setLockedFeaturePrompt] =
    useState<LockedFeaturePrompt | null>(null);
  const isLoggedIn = loginState === "success";
  const isGuest = loginState === "guest";
  const isHumanSession = sessionKind === "human";
  const isAdmin = role === "admin";
  const visibleAdminLinks = adminLinks.filter(
    (link) => isAdmin || (link.to === "/teams-and-services" && canViewTeams),
  );
  const isMusicAccess = isLoggedIn && access === "music";
  /**
   * A `member` is a volunteer, not an operator: they get their own schedule and
   * no presentation surfaces at all. `view` still sees the controllers
   * read-only, which is why this is a separate check rather than folding into
   * `isViewOnlyAccess`.
   */
  const isMemberAccess = isMemberOnlyAccess(access);
  const primaryControllers = useMemo((): CardLink[] => {
    const presentation =
      findControllerProfile(controllerProfiles, PRESENTATION_CONTROLLER_ID);
    const overlay =
      findControllerProfile(controllerProfiles, OVERLAY_CONTROLLER_ID);
    return [
      {
        ...primaryControllerTemplates[0],
        title: presentation?.name || "Presentation",
        description: getControllerProfileDescription(
          presentation ?? {
            type: "presentation",
            description: "",
          },
        ),
      },
      {
        ...primaryControllerTemplates[1],
        title: overlay?.name || "Overlays",
        description: getControllerProfileDescription(
          overlay ?? {
            type: "overlay",
            description: "",
          },
        ),
      },
    ];
  }, [controllerProfiles]);
  const visiblePrimaryControllers = isMemberAccess
    ? []
    : isMusicAccess
      ? primaryControllers.filter((link) => link.to === "/controller")
      : primaryControllers;
  const auxControllerLinks = useMemo(
    (): CardLink[] =>
      getAuxControllerProfiles(controllerProfiles).map((profile) => ({
        title: profile.name,
        description: getControllerProfileDescription(profile),
        to: `/aux-controller/${profile.id}`,
        icon: Projector,
      })),
    [controllerProfiles],
  );
  const visibleAuxControllers =
    isMemberAccess || isMusicAccess ? [] : auxControllerLinks;
  const visibleControllerLinks = isMemberAccess
    ? []
    : [...visiblePrimaryControllers, ...visibleAuxControllers];
  /** Live service plan workspace — not a controller surface; sits with My schedule. */
  const showServiceWorkspace = !isMemberAccess && Boolean(canViewTeams);
  const showMySchedule = isLoggedIn && isHumanSession;
  const visibleSecondaryControllers = isMemberAccess
    ? []
    : isMusicAccess
      ? []
      : isLoggedIn
        ? secondaryControllers.filter((link) => {
          if (isViewOnlyAccess(access)) {
            return link.to !== "/boards/controller";
          }
          return true;
        })
        : secondaryControllers.filter((link) => link.to !== "/boards/controller");

  const enabledDisplayOutputs = useMemo(
    () => getEnabledDisplayOutputs(displayOutputs),
    [displayOutputs],
  );
  const standaloneDisplays = useMemo((): CardLink[] => {
    return enabledDisplayOutputs.flatMap((output) => {
      const to = getDisplayOutputFullscreenHomePath(output);
      if (!to) return [];
      return [
        {
          title: output.name,
          description: displayOutputFullscreenDescription(output.type),
          to,
          icon: displayOutputIcon(output.type),
        },
      ];
    });
  }, [enabledDisplayOutputs]);
  const obsDisplays = useMemo((): CardLink[] => {
    return enabledDisplayOutputs.flatMap((output) => {
      const to = getDisplayOutputBrowserSourceHomePath(output);
      if (!to) return [];
      // Projectors appear in both groups; suffix the streaming card so two
      // Home cards with the same configured name stay distinguishable.
      const title =
        output.type === "projector" &&
          standaloneDisplays.some((link) => link.title === output.name)
          ? `${output.name} (browser source)`
          : output.name;
      return [
        {
          title,
          description: displayOutputBrowserSourceDescription(output.type),
          to,
          icon: displayOutputIcon(output.type),
        },
      ];
    });
  }, [enabledDisplayOutputs, standaloneDisplays]);

  const closeLockedFeaturePrompt = () => {
    setLockedFeaturePrompt(null);
  };

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

        {isGuest ? (
          <section
            className="mx-auto w-full max-w-5xl rounded-xl border border-orange-400/30 bg-orange-500/10 p-4 sm:p-5"
            aria-labelledby="guest-demo-heading"
          >
            <h2
              id="guest-demo-heading"
              className="text-lg font-semibold text-white"
            >
              Offline demo
            </h2>
            <p className="mt-2 text-sm text-gray-200">
              Presentation tools work on this device. Sign in to use scheduling,
              boards, church admin, and display links.
            </p>
          </section>
        ) : null}

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

        {/* Personal schedule and the live service workspace sit together —
            neither belongs under Controllers (operator surfaces) nor Church
            administration. My schedule is human-session only; workstations
            still get Service Workspace when they can view teams. */}
        {(showMySchedule || showServiceWorkspace) && (
          <section className="mx-auto w-full max-w-5xl rounded-xl border border-gray-700 bg-gray-900/40 p-4 sm:p-5">
            <div className="grid gap-4 md:grid-cols-2">
              {showMySchedule ? <HomeLinkCard {...mySchedulelink} /> : null}
              {showServiceWorkspace ? (
                <HomeLinkCard {...currentPlanLink} />
              ) : null}
            </div>
          </section>
        )}

        {/* Hidden rather than shown empty: a schedule-only member has no
            controllers, and a bare heading over nothing reads as broken. */}
        {(visibleControllerLinks.length > 0 ||
          visibleSecondaryControllers.length > 0) && (
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
                {visibleControllerLinks.map((link) => (
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
          )}

        {isGuest ? (
          <section
            className="mx-auto w-full max-w-5xl space-y-4 rounded-xl border border-gray-700 bg-gray-900/40 p-4 sm:p-5"
            aria-labelledby="guest-locked-heading"
          >
            <div className="space-y-2 text-center">
              <h2
                id="guest-locked-heading"
                className="text-2xl font-semibold"
              >
                Available after sign in
              </h2>
              <p className="text-sm text-gray-200">
                These stay with your church account. Open one for a quick path
                to sign in.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {guestLockedFeatures.map((feature) => (
                <HomeLockedFeatureCard
                  key={feature.title}
                  title={feature.title}
                  description={feature.description}
                  icon={feature.icon}
                  onSelect={() => {
                    setLockedFeaturePrompt({ title: feature.title });
                  }}
                />
              ))}
            </div>
          </section>
        ) : null}

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
        ) : !isLoggedIn && !isGuest ? (
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

        <footer className="mx-auto mt-2 flex w-full max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-gray-700 pt-6 text-sm text-gray-300">
          <Button
            component="link"
            to="/support"
            variant="none"
            className="h-auto cursor-pointer p-0 font-normal text-gray-300 underline underline-offset-2 hover:text-white"
          >
            Support
          </Button>
          <span aria-hidden className="text-gray-600">
            ·
          </span>
          <Button
            component="link"
            to="/privacy"
            variant="none"
            className="h-auto cursor-pointer p-0 font-normal text-gray-300 underline underline-offset-2 hover:text-white"
          >
            Privacy Policy
          </Button>
          <span aria-hidden className="text-gray-600">
            ·
          </span>
          <Button
            component="link"
            to="/terms"
            variant="none"
            className="h-auto cursor-pointer p-0 font-normal text-gray-300 underline underline-offset-2 hover:text-white"
          >
            Terms of Service
          </Button>
        </footer>
      </div>

      <Modal
        isOpen={lockedFeaturePrompt !== null}
        onClose={closeLockedFeaturePrompt}
        title="Sign in required"
        size="sm"
        description={
          lockedFeaturePrompt
            ? `${lockedFeaturePrompt.title} needs a church account.`
            : undefined
        }
      >
        <div className="space-y-4 text-sm text-gray-200">
          <p>
            {lockedFeaturePrompt
              ? `${lockedFeaturePrompt.title} needs a church account. Sign in to continue.`
              : null}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="tertiary"
              type="button"
              onClick={closeLockedFeaturePrompt}
            >
              Not now
            </Button>
            <Button
              variant="cta"
              component="link"
              to="/login"
              onClick={closeLockedFeaturePrompt}
            >
              Sign in
            </Button>
          </div>
        </div>
      </Modal>

      {installHelpDialogs}
    </main>
  );
};

export default Welcome;
