import { useContext, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarClock,
  ChevronDown,
  Info,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Monitor,
  Presentation,
  Projector,
  Radio,
  ScrollText,
  ScreenShare,
  Users,
  FolderOpen,
} from "lucide-react";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import WorshipSyncIcon from "../assets/WorshipSyncIconNoBg.png";
import WorshipSyncWordmark from "../assets/WorshipSyncWordmark.png";
import Modal from "../components/Modal/Modal";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import HomeToolbarMenu from "../components/HomeToolbarMenu/HomeToolbarMenu";
import { GlobalInfoContext } from "../context/globalInfo";
import { useAppInstallChrome } from "../hooks/useAppInstallChrome";
import { useSelector } from "../hooks";
import {
  selectControllerProfiles,
  selectControllerProfilesChurchId,
  selectControllerProfilesLoaded,
} from "../store/controllerProfilesSlice";
import {
  selectDisplayOutputs,
  selectDisplayOutputsChurchId,
  selectDisplayOutputsLoaded,
} from "../store/displayOutputsSlice";
import { hasControllerAccess, isViewOnlyAccess } from "../utils/accessTiers";
import {
  getControllerIconColorClass,
  getControllerIconComponent,
  normalizeControllerIcon,
  normalizeControllerIconColor,
} from "../utils/controllerAppearance";
import type { ControllerProfile } from "../utils/controllerProfiles";
import {
  OVERLAY_CONTROLLER_ID,
  PRESENTATION_CONTROLLER_ID,
} from "../utils/controllerProfiles";
import {
  getDisplayOutputBrowserSourceHomePath,
  getDisplayOutputFullscreenHomePath,
  getEnabledDisplayOutputs,
  type DisplayOutput,
} from "../utils/displayOutputs";
import { readHomeNavigationMetadata, writeHomeNavigationMetadata } from "./home/homeNavigationCache";
import {
  HOME_NAVIGATION_GRID_CLASS,
  HOME_TILE_CLASS,
  HomeNavigationLink,
  HomeNavigationSection,
  HomeOutputLinkCard,
} from "./home/HomeNavigation";

type HomeLink = {
  title: string;
  to: string;
  icon: LucideIcon;
  iconColorClass: string;
};

type LockedFeaturePrompt = {
  title: string;
};

const primaryControllerPaths: Record<string, string> = {
  [PRESENTATION_CONTROLLER_ID]: "/controller",
  [OVERLAY_CONTROLLER_ID]: "/overlay-controller",
};
const EMPTY_CONTROLLER_PROFILES: ControllerProfile[] = [];

const secondaryControllers: HomeLink[] = [
  {
    title: "Board moderation",
    to: "/boards/controller",
    icon: MessagesSquare,
    iconColorClass: "text-blue-300",
  },
  {
    title: "Credits Editor",
    to: "/credits-editor",
    icon: ScrollText,
    iconColorClass: "text-pink-300",
  },
];

const adminLinks: HomeLink[] = [
  {
    title: "Resources",
    to: "/resources",
    icon: FolderOpen,
    iconColorClass: "text-violet-300",
  },
  {
    title: "Church administration",
    to: "/account",
    icon: Building2,
    iconColorClass: "text-amber-300",
  },
  {
    title: "Teams and Services",
    to: "/teams-and-services",
    icon: Users,
    iconColorClass: "text-cyan-300",
  },
];

const guestLockedFeatures: HomeLink[] = [
  adminLinks[2],
  secondaryControllers[0],
  adminLinks[1],
  adminLinks[0],
  {
    title: "Display outputs",
    to: "/projector",
    icon: ScreenShare,
    iconColorClass: "text-indigo-300",
  },
];

const outputIcon = (type: DisplayOutput["type"]) => {
  if (type === "monitor") return Monitor;
  if (type === "projector") return Projector;
  if (type === "stream") return Radio;
  if (type === "stream-info") return Info;
  if (type === "credits") return ScrollText;
  if (type === "board") return MessagesSquare;
  return ScreenShare;
};

const outputIconColor = (type: DisplayOutput["type"]) => {
  if (type === "monitor") return "text-cyan-300";
  if (type === "projector") return "text-blue-300";
  if (type === "stream") return "text-violet-300";
  if (type === "stream-info") return "text-indigo-300";
  if (type === "credits") return "text-pink-300";
  if (type === "board") return "text-teal-300";
  return "text-gray-300";
};

const getPrimaryControllerLink = (profile: ControllerProfile): HomeLink => ({
  title: profile.name,
  to: primaryControllerPaths[profile.id] ?? `/aux-controller/${encodeURIComponent(profile.id)}`,
  icon: getControllerIconComponent(normalizeControllerIcon(profile.icon, profile.type)),
  iconColorClass: getControllerIconColorClass(
    normalizeControllerIconColor(profile.iconColor, profile.type, profile.order),
  ),
});

const asDisplayOutput = (output: {
  id: string;
  type: DisplayOutput["type"];
  name: string;
  order: number;
}): DisplayOutput => ({ ...output, enabled: true });

type DisplayLink = {
  title: string;
  to: string | null;
  icon: typeof Presentation;
  iconColorClass: string;
};

const getDisplayLinks = (
  outputs: Array<{
    id: string;
    type: DisplayOutput["type"];
    name: string;
    order: number;
  }>,
  kind: "fullscreen" | "browser-source",
): DisplayLink[] =>
  outputs.flatMap((entry) => {
    const output = asDisplayOutput(entry);
    const to =
      kind === "fullscreen"
        ? getDisplayOutputFullscreenHomePath(output)
        : getDisplayOutputBrowserSourceHomePath(output);
    if (!to) return [];
    const isProjectorBrowserSource = kind === "browser-source" && output.type === "projector";
    return [{
      title: isProjectorBrowserSource ? `${output.name} (browser source)` : output.name,
      to,
      icon: outputIcon(output.type),
      iconColorClass: outputIconColor(output.type),
    }];
  });

const HomeLockedFeatureCard = ({
  title,
  icon,
  iconColorClass,
  onSelect,
}: HomeLink & { onSelect: () => void }) => (
  <Button
    variant="none"
    component="button"
    type="button"
    onClick={onSelect}
    className={`${HOME_TILE_CLASS} cursor-pointer justify-between gap-2`}
    wrap
    aria-label={`${title}. Sign in required.`}
  >
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span
        aria-hidden
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl sm:h-14 sm:w-14 ${iconColorClass}`}
      >
        <Icon svg={icon} size="xl" className={iconColorClass} svgClassName={iconColorClass} />
      </span>
      <span className="min-w-0 break-words text-[15px] font-semibold leading-snug tracking-[-0.01em] sm:text-[17px]">{title}</span>
    </span>
    <span className="shrink-0 rounded border border-gray-600 px-1.5 py-0.5 text-[10px] font-medium text-gray-300 sm:text-xs">
      Sign in
    </span>
  </Button>
);

const HomeOutputGroup = ({
  heading,
  links,
  pending,
}: {
  heading: string;
  links: DisplayLink[];
  pending: boolean;
}) => (
  <div className="space-y-2">
    <h3 className="text-xs font-semibold text-gray-300">{heading}</h3>
    {links.length ? (
      <div className={HOME_NAVIGATION_GRID_CLASS} role="group" aria-label={`${heading} navigation`}>
        {links.map((link) => (
          <HomeOutputLinkCard
            key={`${heading}:${link.to ?? link.title}`}
            title={link.title}
            to={link.to}
            icon={link.icon}
            iconColorClass={link.iconColorClass}
            pending={pending}
          />
        ))}
      </div>
    ) : !pending ? (
      <p className="text-xs text-gray-400">No links in this group.</p>
    ) : null}
  </div>
);

const Welcome = () => {
  const {
    loginState,
    role,
    access,
    canViewTeams,
    canViewServices,
    sessionKind,
    churchId,
  } = useContext(GlobalInfoContext) || {};
  const { installMenuItems, installHelpDialogs } = useAppInstallChrome();
  const controllerProfiles = useSelector(selectControllerProfiles);
  const controllerProfilesLoaded = useSelector(selectControllerProfilesLoaded);
  const controllerProfilesChurchId = useSelector(selectControllerProfilesChurchId);
  const displayOutputs = useSelector(selectDisplayOutputs);
  const displayOutputsLoaded = useSelector(selectDisplayOutputsLoaded);
  const displayOutputsChurchId = useSelector(selectDisplayOutputsChurchId);
  const [lockedFeaturePrompt, setLockedFeaturePrompt] =
    useState<LockedFeaturePrompt | null>(null);
  const isLoggedIn = loginState === "success";
  const isGuest = loginState === "guest";
  const isHumanSession = sessionKind === "human";
  const isAdmin = role === "admin";
  const isMusicAccess = isLoggedIn && access === "music";
  const hasOperatorControllerAccess = hasControllerAccess(access);
  const controllerRegistryMatchesChurch =
    Boolean(churchId) && controllerProfilesChurchId === churchId;
  const displayRegistryMatchesChurch =
    Boolean(churchId) && displayOutputsChurchId === churchId;
  const controllerRegistryReady =
    (controllerProfilesLoaded && controllerRegistryMatchesChurch) || isGuest;
  const controllerNavigationProfiles = controllerRegistryReady
    ? controllerProfiles
    : EMPTY_CONTROLLER_PROFILES;
  const cachedNavigation = useMemo(
    () => readHomeNavigationMetadata(churchId),
    [churchId],
  );

  useEffect(() => {
    const profilesAreCurrent = controllerProfilesLoaded && controllerRegistryMatchesChurch;
    const displaysAreCurrent = displayOutputsLoaded && displayRegistryMatchesChurch;
    if (!churchId || isGuest || (!profilesAreCurrent && !displaysAreCurrent)) return;
    const previouslyCached = readHomeNavigationMetadata(churchId);
    writeHomeNavigationMetadata({
      churchId,
      controllers: profilesAreCurrent
        ? controllerNavigationProfiles
            .filter((profile) => profile.enabled)
            .map((profile) => ({
              id: profile.id,
              name: profile.name,
              icon: normalizeControllerIcon(profile.icon, profile.type),
              iconColor: normalizeControllerIconColor(
                profile.iconColor,
                profile.type,
                profile.order,
              ),
              order: profile.order,
            }))
        : previouslyCached?.controllers ?? [],
      displays: displaysAreCurrent
        ? getEnabledDisplayOutputs(displayOutputs).map((output) => ({
            id: output.id,
            name: output.name,
            type: output.type,
            order: output.order,
          }))
        : previouslyCached?.displays ?? [],
    });
  }, [
    churchId,
    controllerProfiles,
    controllerProfilesChurchId,
    controllerProfilesLoaded,
    controllerRegistryMatchesChurch,
    controllerNavigationProfiles,
    displayOutputs,
    displayOutputsChurchId,
    displayOutputsLoaded,
    displayRegistryMatchesChurch,
    isGuest,
  ]);

  const visibleAdminLinks = adminLinks.filter(
    (link) => isAdmin || (link.to === "/teams-and-services" && canViewTeams),
  );
  const primaryControllerLinks = controllerNavigationProfiles
    .filter((profile) => profile.enabled)
    .filter((profile) => !isMusicAccess || profile.id === PRESENTATION_CONTROLLER_ID)
    .map(getPrimaryControllerLink);
  const visiblePrimaryControllers = hasOperatorControllerAccess
    ? primaryControllerLinks
    : [];
  const showPendingControllers = hasOperatorControllerAccess && !controllerRegistryReady;
  const cachedControllerLinks = (cachedNavigation?.controllers ?? [])
    .filter((profile) => !isMusicAccess || profile.id === PRESENTATION_CONTROLLER_ID)
    .map((profile) => ({
      title: profile.name,
      to: profile.id === PRESENTATION_CONTROLLER_ID
        ? "/controller"
        : profile.id === OVERLAY_CONTROLLER_ID
          ? "/overlay-controller"
          : `/aux-controller/${encodeURIComponent(profile.id)}`,
      icon: getControllerIconComponent(profile.icon),
      iconColorClass: getControllerIconColorClass(profile.iconColor),
    }));
  const visibleSecondaryControllers = !hasOperatorControllerAccess
    ? []
    : isMusicAccess
      ? []
      : isLoggedIn
        ? secondaryControllers.filter((link) =>
            isViewOnlyAccess(access) ? link.to !== "/boards/controller" : true,
          )
        : secondaryControllers.filter((link) => link.to !== "/boards/controller");

  const showServiceWorkspace = Boolean(canViewTeams);
  const showCurrentServiceViewer = Boolean(canViewServices);
  const showMySchedule = isLoggedIn && isHumanSession;
  const showMyTeams = isLoggedIn && isHumanSession && !canViewTeams;

  const displayMetadataPending =
    isLoggedIn && access === "full" && !(displayOutputsLoaded && displayRegistryMatchesChurch);
  const visibleOutputs = displayOutputsLoaded && displayRegistryMatchesChurch
    ? getEnabledDisplayOutputs(displayOutputs).map((output) => ({
        id: output.id,
        type: output.type,
        name: output.name,
        order: output.order,
      }))
    : cachedNavigation?.displays ?? [];
  const fullscreenDisplayLinks = getDisplayLinks(visibleOutputs, "fullscreen");
  const browserSourceLinks = getDisplayLinks(visibleOutputs, "browser-source");

  const closeLockedFeaturePrompt = () => setLockedFeaturePrompt(null);

  return (
    <main className="flex h-dvh flex-col overflow-y-auto bg-homepage-canvas text-white">
      <header data-testid="home-toolbar" className="relative w-full shrink-0 border-b border-gray-700">
        <div className="relative mx-auto flex w-full items-center justify-between gap-4 px-4 py-3 text-lg sm:px-6 lg:px-8">
          <div className="flex shrink-0 items-center gap-2">
            <HomeToolbarMenu extraMenuItems={installMenuItems} />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-4">
            {!isLoggedIn ? (
              <Button variant="tertiary" component="link" to="/login" padding="px-4 py-1">
                Sign in
              </Button>
            ) : null}
            <UserSection />
          </div>
          <span
            role="img"
            aria-label="WorshipSync"
            className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 select-none items-center gap-2 lg:flex"
          >
            <img src={WorshipSyncIcon} alt="" className="h-7 w-auto object-contain" />
            <img
              src={WorshipSyncWordmark}
              alt=""
              className="h-4 w-auto object-contain"
              width={1204}
              height={94}
            />
          </span>
        </div>
      </header>

      <div data-testid="home-content" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 pb-8 pt-5 sm:px-5 lg:pt-6">
        {isGuest ? (
          <section
            className="w-full rounded-lg border border-orange-400/25 bg-orange-500/5 px-3 py-2.5"
            aria-labelledby="guest-demo-heading"
          >
            <h2 id="guest-demo-heading" className="text-sm font-semibold text-white">
              Offline demo
            </h2>
            <p className="mt-1 text-xs text-gray-300">
              Presentation tools work on this device. Sign in to use scheduling, boards, church administration, and display links.
            </p>
          </section>
        ) : null}

        {visibleAdminLinks.length > 0 ? (
          <HomeNavigationSection title="Church administration" icon={Building2} iconColorClass="text-amber-300">
            <div className={HOME_NAVIGATION_GRID_CLASS} role="group" aria-label="Church administration navigation">
              {visibleAdminLinks.map((link) => (
                <HomeNavigationLink key={link.to} {...link} />
              ))}
            </div>
          </HomeNavigationSection>
        ) : null}

        {(showMySchedule || showMyTeams || showServiceWorkspace || showCurrentServiceViewer) ? (
          <HomeNavigationSection title="Personal and service tools" icon={CalendarClock} iconColorClass="text-teal-300">
            <div className={HOME_NAVIGATION_GRID_CLASS} role="group" aria-label="Personal and service tools navigation">
              {showMySchedule ? (
                <HomeNavigationLink
                  title="My schedule"
                  to="/my-schedule"
                  icon={CalendarClock}
                  iconColorClass="text-teal-300"
                />
              ) : null}
              {showMyTeams ? (
                <HomeNavigationLink
                  title="My teams"
                  to="/teams-and-services"
                  icon={Users}
                  iconColorClass="text-cyan-300"
                />
              ) : null}
              {showServiceWorkspace ? (
                <HomeNavigationLink
                  title="Service Workspace"
                  to="/current-service"
                  icon={LayoutDashboard}
                  iconColorClass="text-blue-300"
                />
              ) : null}
              {showCurrentServiceViewer ? (
                <HomeNavigationLink
                  title="Current Service Viewer"
                  to="/current-service/view"
                  icon={ListChecks}
                  iconColorClass="text-indigo-300"
                />
              ) : null}
            </div>
          </HomeNavigationSection>
        ) : null}

        {(
          visiblePrimaryControllers.length > 0 ||
          visibleSecondaryControllers.length > 0 ||
          showPendingControllers
        ) ? (
          <HomeNavigationSection title="Controllers" icon={LayoutDashboard} iconColorClass="text-orange-300" busy={showPendingControllers}>
            <div className={HOME_NAVIGATION_GRID_CLASS} role="group" aria-label="Controllers navigation">
              {controllerRegistryReady
                ? visiblePrimaryControllers.map((link) => (
                    <HomeNavigationLink key={link.to} {...link} />
                  ))
                : cachedControllerLinks.length
                  ? cachedControllerLinks.map((link) => (
                      <HomeNavigationLink key={link.to} {...link} pending />
                    ))
                  : Array.from({ length: isMusicAccess ? 1 : 2 }, (_, index) => (
                      <div
                        key={`controller-loading-${index}`}
                        role={index === 0 ? "status" : undefined}
                        aria-label={index === 0 ? "Loading controller settings" : undefined}
                        className={`${HOME_TILE_CLASS} animate-pulse gap-3`}
                      >
                        {index === 0 ? <span className="sr-only">Loading controller settings</span> : null}
                        <span aria-hidden className="h-12 w-12 shrink-0 rounded-xl bg-gray-700 sm:h-14 sm:w-14" />
                        <span aria-hidden className="h-4 w-2/3 rounded bg-gray-700" />
                      </div>
                    ))}
              {visibleSecondaryControllers.map((link) => (
                <HomeNavigationLink key={link.to} {...link} />
              ))}
            </div>
          </HomeNavigationSection>
        ) : null}

        {isGuest ? (
          <HomeNavigationSection title="Available after sign in" icon={Info} iconColorClass="text-gray-400">
            <div className={HOME_NAVIGATION_GRID_CLASS} role="group" aria-label="Guest navigation">
              {guestLockedFeatures.map((feature) => (
                <HomeLockedFeatureCard
                  key={feature.title}
                  {...feature}
                  onSelect={() => setLockedFeaturePrompt({ title: feature.title })}
                />
              ))}
            </div>
          </HomeNavigationSection>
        ) : null}

        {isLoggedIn && access === "full" ? (
          <details data-testid="display-outputs-details" className="group w-full rounded-2xl border border-gray-700 bg-gray-900/40 p-4 sm:p-5 lg:p-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-2 py-2 text-lg font-semibold tracking-[-0.015em] text-white hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:text-xl">
              <span className="flex items-center gap-3">
                <ScreenShare aria-hidden className="h-6 w-6 text-violet-300" />
                Display outputs
              </span>
              <span className="flex items-center gap-1 text-xs font-normal text-gray-400">
                Open or copy links
                <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="mt-3 space-y-4 border-t border-gray-700 pt-4" aria-busy={displayMetadataPending}>
              {displayMetadataPending && !visibleOutputs.length ? (
                <p className="text-xs text-gray-400" role="status">Loading this church&apos;s displays...</p>
              ) : null}
              <HomeOutputGroup heading="Fullscreen in the browser" links={fullscreenDisplayLinks} pending={displayMetadataPending} />
              <div className="border-t border-gray-700 pt-3">
                <HomeOutputGroup heading="Browser sources (streaming)" links={browserSourceLinks} pending={displayMetadataPending} />
              </div>
            </div>
          </details>
        ) : !isLoggedIn && !isGuest ? (
          <HomeNavigationSection title="Display outputs" icon={ScreenShare} iconColorClass="text-violet-300">
            <p className="text-sm text-gray-400">Sign in to show display links.</p>
          </HomeNavigationSection>
        ) : null}

        <footer className="mt-1 flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-gray-700 pt-4 text-sm text-gray-300">
          <Button component="link" to="/support" variant="none" className="h-auto cursor-pointer p-0 font-normal text-gray-300 underline underline-offset-2 hover:text-white">Support</Button>
          <span aria-hidden className="text-gray-700">{"\u00b7"}</span>
          <Button component="link" to="/privacy" variant="none" className="h-auto cursor-pointer p-0 font-normal text-gray-300 underline underline-offset-2 hover:text-white">Privacy Policy</Button>
          <span aria-hidden className="text-gray-700">{"\u00b7"}</span>
          <Button component="link" to="/terms" variant="none" className="h-auto cursor-pointer p-0 font-normal text-gray-300 underline underline-offset-2 hover:text-white">Terms of Service</Button>
        </footer>
      </div>

      <Modal
        isOpen={lockedFeaturePrompt !== null}
        onClose={closeLockedFeaturePrompt}
        title="Sign in required"
        size="sm"
        description={lockedFeaturePrompt ? `${lockedFeaturePrompt.title} needs a church account.` : undefined}
      >
        <div className="space-y-4 text-sm text-gray-200">
          <p>
            {lockedFeaturePrompt
              ? `${lockedFeaturePrompt.title} needs a church account. Sign in to continue.`
              : null}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="tertiary" type="button" onClick={closeLockedFeaturePrompt}>Not now</Button>
            <Button variant="cta" component="link" to="/login" onClick={closeLockedFeaturePrompt}>Sign in</Button>
          </div>
        </div>
      </Modal>

      {installHelpDialogs}
    </main>
  );
};

export default Welcome;
