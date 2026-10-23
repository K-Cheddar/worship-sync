import { useContext, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarClock,
  ChevronDown,
  Info,
  LayoutDashboard,
  MessagesSquare,
  Monitor,
  Presentation,
  Projector,
  Radio,
  ScrollText,
  ScreenShare,
} from "lucide-react";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import AnimateCollapse from "../components/AnimateCollapse/AnimateCollapse";
import Toggle from "../components/Toggle/Toggle";
import WorshipSyncWordmark from "../assets/WorshipSyncWordmark.png";
import Modal from "../components/Modal/Modal";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import HomeToolbarMenu from "../components/HomeToolbarMenu/HomeToolbarMenu";
import type { EntityIcon } from "../components/icons/iconTypes";
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
  getRenderableControllerHomeIcon,
  normalizeControllerIcon,
  normalizeControllerIconColor,
} from "../utils/controllerAppearance";
import type { ControllerProfile } from "../utils/controllerProfiles";
import {
  OVERLAY_CONTROLLER_ID,
  PRESENTATION_CONTROLLER_ID,
  getControllerProfileDescription,
  getControllerProfilesInNavigationOrder,
  getControllerProfileTypeForId,
  getDefaultControllerProfileDescription,
  resolveHomeControllerDisplayName,
} from "../utils/controllerProfiles";
import {
  getDisplayOutputBrowserSourceHomePath,
  getDisplayOutputFullscreenHomePath,
  getEnabledDisplayOutputs,
  type DisplayOutput,
} from "../utils/displayOutputs";
import {
  readHomeNavigationMetadata,
  writeHomeNavigationMetadata,
} from "./home/homeNavigationCache";
import {
  readHomeDescriptionsPreference,
  writeHomeDescriptionsPreference,
} from "./home/homeDescriptionsPreference";
import {
  HOME_NAVIGATION_GRID_CLASS,
  HOME_TILE_CLASS,
  HOME_TILE_CONTENT_CLASS,
  HOME_TILE_ICON_CLASS,
  HomeNavigationLink,
  HomeNavigationSection,
  HomeSectionHeading,
  HomeOutputLinkCard,
} from "./home/HomeNavigation";
import { PAGE_APPEARANCES } from "./pageAppearances";

type HomeLink = {
  title: string;
  to: string;
  icon: LucideIcon;
  iconColorClass: string;
  iconRef?: EntityIcon;
  description?: string;
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
    ...PAGE_APPEARANCES.boardModeration,
    description: "Review and present audience posts.",
  },
  {
    title: "Credits Editor",
    to: "/credits-editor",
    ...PAGE_APPEARANCES.creditsEditor,
    description: "Prepare and run service credits.",
  },
];

const adminLinks: HomeLink[] = [
  {
    title: "Resources",
    to: "/resources",
    ...PAGE_APPEARANCES.resources,
    description: "Access shared files and church resources.",
  },
  {
    title: "Administration",
    to: "/account",
    ...PAGE_APPEARANCES.churchAdministration,
    description: "Manage settings, devices, and access.",
  },
  {
    title: "Teams and Services",
    to: "/teams-and-services",
    ...PAGE_APPEARANCES.teamsAndServices,
    description: "Organize volunteers, schedules, and services.",
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
    description: "Links for room screens and streaming software.",
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
  title: resolveHomeControllerDisplayName(profile.id, profile.name),
  description: getControllerProfileDescription(profile),
  to:
    primaryControllerPaths[profile.id] ??
    `/aux-controller/${encodeURIComponent(profile.id)}`,
  icon: getControllerIconComponent(
    normalizeControllerIcon(profile.icon, profile.type),
  ),
  iconColorClass: getControllerIconColorClass(
    normalizeControllerIconColor(
      profile.iconColor,
      profile.type,
      profile.order,
    ),
  ),
  iconRef: getRenderableControllerHomeIcon(profile.homeIcon),
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
    return [
      {
        title: output.name,
        to,
        icon: outputIcon(output.type),
        iconColorClass: outputIconColor(output.type),
      },
    ];
  });

const HomeLockedFeatureCard = ({
  title,
  description,
  icon,
  iconColorClass,
  showDescriptions = false,
  onSelect,
}: HomeLink & { showDescriptions?: boolean; onSelect: () => void }) => (
  <Button
    variant="none"
    component="button"
    type="button"
    onClick={onSelect}
    className={`${HOME_TILE_CLASS} cursor-pointer`}
    wrap
    aria-label={
      showDescriptions && description
        ? `${title}. ${description} Sign in required.`
        : `${title}. Sign in required.`
    }
  >
    <span className={`${HOME_TILE_CONTENT_CLASS} gap-3 py-3 whitespace-normal`}>
      <span aria-hidden className={`${HOME_TILE_ICON_CLASS} ${iconColorClass}`}>
        <Icon
          svg={icon}
          size="xl"
          className={iconColorClass}
          svgClassName={iconColorClass}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="block break-words text-[15px] font-semibold leading-snug tracking-[-0.01em] sm:text-[17px]">
          {title}
        </span>
        {showDescriptions && description ? (
          <span className="mt-0.5 block break-words text-xs font-normal leading-snug text-gray-400">
            {description}
          </span>
        ) : null}
        <span className="mt-2 inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-gray-700/70 px-2 py-0.5 text-[10px] font-medium leading-4 text-gray-300">
          Sign in
        </span>
      </span>
    </span>
  </Button>
);

const HomeOutputGroup = ({
  heading,
  description,
  linkContext,
  links,
  pending,
  showDescriptions,
}: {
  heading: string;
  description: string;
  linkContext: "fullscreen" | "browser source";
  links: DisplayLink[];
  pending: boolean;
  showDescriptions: boolean;
}) => (
  <div className="space-y-2">
    <h3 className="text-xs font-semibold text-gray-300">{heading}</h3>
    {showDescriptions ? (
      <p className="text-xs leading-relaxed text-gray-400">{description}</p>
    ) : null}
    {links.length ? (
      <div
        className={HOME_NAVIGATION_GRID_CLASS}
        role="group"
        aria-label={`${heading} navigation`}
      >
        {links.map((link) => (
          <HomeOutputLinkCard
            key={`${heading}:${link.to ?? link.title}`}
            title={link.title}
            linkContext={linkContext}
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
  const controllerProfilesChurchId = useSelector(
    selectControllerProfilesChurchId,
  );
  const displayOutputs = useSelector(selectDisplayOutputs);
  const displayOutputsLoaded = useSelector(selectDisplayOutputsLoaded);
  const displayOutputsChurchId = useSelector(selectDisplayOutputsChurchId);
  const [lockedFeaturePrompt, setLockedFeaturePrompt] =
    useState<LockedFeaturePrompt | null>(null);
  const [showDescriptions, setShowDescriptions] = useState(
    readHomeDescriptionsPreference,
  );
  const [displayOutputsExpanded, setDisplayOutputsExpanded] = useState(false);
  const [displayOutputsDetailsOpen, setDisplayOutputsDetailsOpen] =
    useState(false);
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
  const controllerNavigationProfiles = useMemo(
    () =>
      controllerRegistryReady
        ? getControllerProfilesInNavigationOrder(controllerProfiles)
        : EMPTY_CONTROLLER_PROFILES,
    [controllerProfiles, controllerRegistryReady],
  );
  const cachedNavigation = useMemo(
    () => readHomeNavigationMetadata(churchId),
    [churchId],
  );

  useEffect(() => {
    const profilesAreCurrent =
      controllerProfilesLoaded && controllerRegistryMatchesChurch;
    const displaysAreCurrent =
      displayOutputsLoaded && displayRegistryMatchesChurch;
    if (!churchId || isGuest || (!profilesAreCurrent && !displaysAreCurrent))
      return;
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
              ...(profile.description.trim()
                ? { description: profile.description }
                : {}),
              homeIcon: profile.homeIcon,
              order: profile.order,
            }))
        : (previouslyCached?.controllers ?? []),
      displays: displaysAreCurrent
        ? getEnabledDisplayOutputs(displayOutputs).map((output) => ({
            id: output.id,
            name: output.name,
            type: output.type,
            order: output.order,
          }))
        : (previouslyCached?.displays ?? []),
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
    .filter(
      (profile) => !isMusicAccess || profile.id === PRESENTATION_CONTROLLER_ID,
    )
    .map(getPrimaryControllerLink);
  const visiblePrimaryControllers = hasOperatorControllerAccess
    ? primaryControllerLinks
    : [];
  const showPendingControllers =
    hasOperatorControllerAccess && !controllerRegistryReady;
  const cachedControllerLinks = getControllerProfilesInNavigationOrder(
    cachedNavigation?.controllers ?? [],
  )
    .filter(
      (profile) => !isMusicAccess || profile.id === PRESENTATION_CONTROLLER_ID,
    )
    .map((profile) => ({
      title: resolveHomeControllerDisplayName(profile.id, profile.name),
      to:
        profile.id === PRESENTATION_CONTROLLER_ID
          ? "/controller"
          : profile.id === OVERLAY_CONTROLLER_ID
            ? "/overlay-controller"
            : `/aux-controller/${encodeURIComponent(profile.id)}`,
      icon: getControllerIconComponent(profile.icon),
      iconColorClass: getControllerIconColorClass(profile.iconColor),
      iconRef: getRenderableControllerHomeIcon(profile.homeIcon),
      description:
        profile.description ??
        getDefaultControllerProfileDescription(
          getControllerProfileTypeForId(profile.id),
        ),
    }));
  const visibleSecondaryControllers = !hasOperatorControllerAccess
    ? []
    : isMusicAccess
      ? []
      : isLoggedIn
        ? secondaryControllers.filter((link) =>
            isViewOnlyAccess(access) ? link.to !== "/boards/controller" : true,
          )
        : secondaryControllers.filter(
            (link) => link.to !== "/boards/controller",
          );

  const showServiceWorkspace = Boolean(canViewTeams);
  const showCurrentServiceViewer = Boolean(canViewServices);
  const showMySchedule = isLoggedIn && isHumanSession;
  const showMyTeams = isLoggedIn && isHumanSession && !canViewTeams;

  const displayMetadataPending =
    isLoggedIn &&
    access === "full" &&
    !(displayOutputsLoaded && displayRegistryMatchesChurch);
  const visibleOutputs =
    displayOutputsLoaded && displayRegistryMatchesChurch
      ? getEnabledDisplayOutputs(displayOutputs).map((output) => ({
          id: output.id,
          type: output.type,
          name: output.name,
          order: output.order,
        }))
      : (cachedNavigation?.displays ?? []);
  const fullscreenDisplayLinks = getDisplayLinks(visibleOutputs, "fullscreen");
  const browserSourceLinks = getDisplayLinks(visibleOutputs, "browser-source");

  const closeLockedFeaturePrompt = () => setLockedFeaturePrompt(null);
  const updateShowDescriptions = (nextValue: boolean) => {
    setShowDescriptions(nextValue);
    writeHomeDescriptionsPreference(nextValue);
  };
  const toggleDisplayOutputs = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();

    if (displayOutputsExpanded) {
      setDisplayOutputsExpanded(false);
      if (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setDisplayOutputsDetailsOpen(false);
      }
      return;
    }

    setDisplayOutputsDetailsOpen(true);
    setDisplayOutputsExpanded(true);
  };

  return (
    <main className="flex h-dvh flex-col overflow-y-auto bg-homepage-canvas text-white">
      <header
        data-testid="home-toolbar"
        className="relative w-full shrink-0 border-b border-gray-700"
      >
        <div className="relative mx-auto flex w-full items-center justify-between gap-4 px-4 py-3 text-lg sm:px-6 lg:px-8">
          <div className="flex shrink-0 items-center gap-2">
            <HomeToolbarMenu extraMenuItems={installMenuItems} />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-4">
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
          <span
            role="img"
            aria-label="WorshipSync"
            className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 select-none items-center gap-2 lg:flex"
          >
            <img
              src={`${import.meta.env.BASE_URL}logo192.png`}
              alt=""
              className="h-6 w-auto object-contain"
            />
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

      <div
        data-testid="home-content"
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 pb-8 pt-5 sm:px-5 lg:pt-6"
      >
        {isGuest ? (
          <section
            className="w-full rounded-lg border border-orange-400/25 bg-orange-500/5 px-3 py-2.5"
            aria-labelledby="guest-demo-heading"
          >
            <h2
              id="guest-demo-heading"
              className="text-sm font-semibold text-white"
            >
              Offline demo
            </h2>
            <p className="mt-1 text-xs text-gray-300">
              Presentation tools work on this device. Sign in to use scheduling,
              boards, church administration, and display links.
            </p>
          </section>
        ) : null}

        <div className="flex w-full justify-end">
          <Toggle
            label={<span>Show what each page does</span>}
            labelClassName="text-xs font-medium text-gray-300"
            value={showDescriptions}
            onChange={updateShowDescriptions}
            className="w-fit gap-2"
          />
        </div>

        {visibleAdminLinks.length > 0 ? (
          <HomeNavigationSection
            title="Management"
            description="Manage resources, access, teams, and services."
            showDescriptions={showDescriptions}
            icon={Building2}
            iconColorClass="text-amber-300"
          >
            <div
              className={HOME_NAVIGATION_GRID_CLASS}
              role="group"
              aria-label="Management navigation"
            >
              {visibleAdminLinks.map((link) => (
                <HomeNavigationLink
                  key={link.to}
                  {...link}
                  showDescriptions={showDescriptions}
                />
              ))}
            </div>
          </HomeNavigationSection>
        ) : null}

        {showMySchedule ||
        showMyTeams ||
        showServiceWorkspace ||
        showCurrentServiceViewer ? (
          <HomeNavigationSection
            title="Personal and service tools"
            description="View your assignments and prepare for services."
            showDescriptions={showDescriptions}
            icon={CalendarClock}
            iconColorClass="text-teal-300"
          >
            <div
              className={HOME_NAVIGATION_GRID_CLASS}
              role="group"
              aria-label="Personal and service tools navigation"
            >
              {showMySchedule ? (
                <HomeNavigationLink
                  title="My schedule"
                  to="/my-schedule"
                  {...PAGE_APPEARANCES.mySchedule}
                  description="View assignments and availability."
                  showDescriptions={showDescriptions}
                />
              ) : null}
              {showMyTeams ? (
                <HomeNavigationLink
                  title="My teams"
                  to="/teams-and-services"
                  {...PAGE_APPEARANCES.myTeams}
                  description="See your teams and responsibilities."
                  showDescriptions={showDescriptions}
                />
              ) : null}
              {showServiceWorkspace ? (
                <HomeNavigationLink
                  title="Service Workspace"
                  to="/current-service"
                  {...PAGE_APPEARANCES.serviceWorkspace}
                  description="Prepare and manage the service plan."
                  showDescriptions={showDescriptions}
                />
              ) : null}
              {showCurrentServiceViewer ? (
                <HomeNavigationLink
                  title="Current Service"
                  to="/current-service/view"
                  {...PAGE_APPEARANCES.currentServiceViewer}
                  description="Follow the current order of service."
                  showDescriptions={showDescriptions}
                />
              ) : null}
            </div>
          </HomeNavigationSection>
        ) : null}

        {visiblePrimaryControllers.length > 0 ||
        visibleSecondaryControllers.length > 0 ||
        showPendingControllers ? (
          <HomeNavigationSection
            title="Controllers"
            description="Run presentations, stream graphics, and displays."
            showDescriptions={showDescriptions}
            icon={LayoutDashboard}
            iconColorClass="text-orange-300"
            busy={showPendingControllers}
          >
            <div
              className={HOME_NAVIGATION_GRID_CLASS}
              role="group"
              aria-label="Controllers navigation"
            >
              {controllerRegistryReady
                ? visiblePrimaryControllers.map((link) => (
                    <HomeNavigationLink
                      key={link.to}
                      {...link}
                      showDescriptions={showDescriptions}
                    />
                  ))
                : cachedControllerLinks.length
                  ? cachedControllerLinks.map((link) => (
                      <HomeNavigationLink
                        key={link.to}
                        {...link}
                        pending
                        showDescriptions={showDescriptions}
                      />
                    ))
                  : Array.from(
                      { length: isMusicAccess ? 1 : 2 },
                      (_, index) => (
                        <div
                          key={`controller-loading-${index}`}
                          role={index === 0 ? "status" : undefined}
                          aria-label={
                            index === 0
                              ? "Loading controller settings"
                              : undefined
                          }
                          className={`${HOME_TILE_CLASS} animate-pulse gap-3`}
                        >
                          <span className={`${HOME_TILE_CONTENT_CLASS} gap-3`}>
                            {index === 0 ? (
                              <span className="sr-only">
                                Loading controller settings
                              </span>
                            ) : null}
                            <span
                              aria-hidden
                              className="h-8 w-8 shrink-0 rounded bg-gray-700"
                            />
                            <span
                              aria-hidden
                              className="h-4 w-2/3 rounded bg-gray-700"
                            />
                          </span>
                        </div>
                      ),
                    )}
              {visibleSecondaryControllers.map((link) => (
                <HomeNavigationLink
                  key={link.to}
                  {...link}
                  showDescriptions={showDescriptions}
                />
              ))}
            </div>
          </HomeNavigationSection>
        ) : null}

        {isGuest ? (
          <HomeNavigationSection
            title="Available after sign in"
            description="Sign in to access these church tools."
            showDescriptions={showDescriptions}
            icon={Info}
            iconColorClass="text-gray-400"
          >
            <div
              className={HOME_NAVIGATION_GRID_CLASS}
              role="group"
              aria-label="Guest navigation"
            >
              {guestLockedFeatures.map((feature) => (
                <HomeLockedFeatureCard
                  key={feature.title}
                  {...feature}
                  showDescriptions={showDescriptions}
                  onSelect={() =>
                    setLockedFeaturePrompt({ title: feature.title })
                  }
                />
              ))}
            </div>
          </HomeNavigationSection>
        ) : null}

        {isLoggedIn && access === "full" ? (
          <details
            data-testid="display-outputs-details"
            open={displayOutputsDetailsOpen}
            className="group w-full rounded-2xl border border-gray-700 bg-gray-900/40 p-4 sm:p-5 lg:p-6"
          >
            <summary
              aria-controls="home-display-outputs-panel"
              aria-expanded={displayOutputsExpanded}
              onClick={toggleDisplayOutputs}
              className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-xl px-2 py-2 text-lg font-semibold tracking-[-0.015em] text-white hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:text-xl md:items-center"
            >
              <HomeSectionHeading
                as="span"
                className="flex-1"
                title="Display outputs"
                description="Links for room screens and streaming software."
                showDescriptions={showDescriptions}
                icon={ScreenShare}
                iconColorClass="text-violet-300"
              />
              <span className="flex items-center gap-1 text-xs font-normal text-gray-400">
                View links
                <ChevronDown
                  aria-hidden
                  className={`h-4 w-4 transition-transform duration-200 ease-out motion-reduce:transition-none ${displayOutputsExpanded ? "rotate-180" : ""}`}
                />
              </span>
            </summary>
            <AnimateCollapse
              open={displayOutputsExpanded}
              onCloseComplete={() => setDisplayOutputsDetailsOpen(false)}
            >
              <div
                id="home-display-outputs-panel"
                className={`mt-3 space-y-4 border-t border-gray-700 pt-4 transition-opacity duration-200 ease-out motion-reduce:transition-none ${displayOutputsExpanded ? "opacity-100" : "opacity-0"}`}
                aria-busy={displayMetadataPending}
              >
                {displayMetadataPending && !visibleOutputs.length ? (
                  <p className="text-xs text-gray-400" role="status">
                    Loading this church&apos;s displays...
                  </p>
                ) : null}
                <HomeOutputGroup
                  heading="Fullscreen in the browser"
                  description="Open these displays full-screen in your browser."
                  linkContext="fullscreen"
                  links={fullscreenDisplayLinks}
                  pending={displayMetadataPending}
                  showDescriptions={showDescriptions}
                />
                <div className="border-t border-gray-700 pt-3">
                  <HomeOutputGroup
                    heading="Browser sources (streaming)"
                    description="Copy these links into OBS or other streaming software as browser sources."
                    linkContext="browser source"
                    links={browserSourceLinks}
                    pending={displayMetadataPending}
                    showDescriptions={showDescriptions}
                  />
                </div>
              </div>
            </AnimateCollapse>
          </details>
        ) : !isLoggedIn && !isGuest ? (
          <HomeNavigationSection
            title="Display outputs"
            description="Sign in to open or copy links for room screens and streaming software."
            showDescriptions={showDescriptions}
            icon={ScreenShare}
            iconColorClass="text-violet-300"
          >
            <p className="text-sm text-gray-400">
              Sign in to show display links.
            </p>
          </HomeNavigationSection>
        ) : null}

        <footer className="mt-1 flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-gray-700 pt-4 text-sm text-gray-300">
          <Button
            component="link"
            to="/support"
            variant="none"
            className="h-auto cursor-pointer p-0 font-normal text-gray-300 underline underline-offset-2 hover:text-white"
          >
            Support
          </Button>
          <span aria-hidden className="text-gray-700">
            {"\u00b7"}
          </span>
          <Button
            component="link"
            to="/privacy"
            variant="none"
            className="h-auto cursor-pointer p-0 font-normal text-gray-300 underline underline-offset-2 hover:text-white"
          >
            Privacy Policy
          </Button>
          <span aria-hidden className="text-gray-700">
            {"\u00b7"}
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
