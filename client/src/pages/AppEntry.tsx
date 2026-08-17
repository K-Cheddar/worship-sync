import { useContext, useMemo, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  KeyRound,
  Layers,
  MessagesSquare,
  Presentation,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import WorshipSyncImage from "../assets/WorshipSyncImage.png";
import AuthScreenMain from "../components/AuthScreenMain";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import { GlobalInfoContext } from "../context/globalInfo";
import { getAuthRedirectPathnameFromState } from "../utils/authRedirectPath";
import { getStoredServerSessionHint } from "../utils/authStorage";
import { getAllowedRouteOrDefault } from "../utils/sessionRouteAccess";

type EntryStep = "landing" | "link";

type ProductHighlight = {
  title: string;
  description: string;
  icon: LucideIcon;
};

const productHighlights: ProductHighlight[] = [
  {
    title: "Live presentation",
    description:
      "Run slides and media to projector, monitor, and stream from one controller.",
    icon: Presentation,
  },
  {
    title: "Overlays and timers",
    description:
      "Send lower thirds, service timers, and credits without leaving the flow.",
    icon: Layers,
  },
  {
    title: "Teams and scheduling",
    description:
      "Plan services, assign roles, and keep volunteers current each week.",
    icon: CalendarClock,
  },
  {
    title: "Boards and chat",
    description:
      "Moderate attendee questions and coordinate with your team between Sundays.",
    icon: MessagesSquare,
  },
];

const AppEntry = () => {
  const location = useLocation();
  const context = useContext(GlobalInfoContext);
  const [entryStep, setEntryStep] = useState<EntryStep>("landing");
  const [isRetryingAuthConnection, setIsRetryingAuthConnection] =
    useState(false);
  const requestedPath = getAuthRedirectPathnameFromState(location.state) ?? "";
  const authServerStatus = context?.authServerStatus;
  const isAuthConnectionNoticeVisible =
    authServerStatus === "offline" || authServerStatus === "checking";
  const isServerBackedModeDisabled = authServerStatus === "offline";
  const storedServerSessionHint = getStoredServerSessionHint();
  const hasStoredServerSession = storedServerSessionHint !== null;

  const nextState = useMemo(
    () => ({
      from:
        requestedPath && requestedPath !== "/"
          ? { pathname: requestedPath }
          : location,
    }),
    [location, requestedPath],
  );

  const guestDestination =
    requestedPath && requestedPath !== "/" ? requestedPath : "/controller";

  const handleRetryAuthConnection = async () => {
    if (!context || isRetryingAuthConnection) {
      return;
    }

    setIsRetryingAuthConnection(true);
    try {
      await context.refreshAuthBootstrap();
    } finally {
      setIsRetryingAuthConnection(false);
    }
  };

  if (context?.sessionKind === "human") {
    return (
      <Navigate
        to={requestedPath && requestedPath !== "/" ? requestedPath : "/home"}
        replace
      />
    );
  }

  if (context?.loginState === "guest") {
    const nextPath = getAllowedRouteOrDefault(requestedPath, {
      loginState: context.loginState,
      sessionKind: context.sessionKind,
      access: context.access,
      operatorName: context.operatorName,
      displaySurfaceType: context.device?.surfaceType,
      displayOutputId: context.device?.outputId,
    });
    return <Navigate to={nextPath} replace />;
  }

  if (context?.sessionKind === "workstation") {
    const routeContext = {
      loginState: context.loginState,
      sessionKind: context.sessionKind,
      access: context.access,
      operatorName: context.operatorName,
      displaySurfaceType: context.device?.surfaceType,
      displayOutputId: context.device?.outputId,
    };
    const nextPath =
      requestedPath && requestedPath !== "/"
        ? getAllowedRouteOrDefault(requestedPath, routeContext)
        : "/home";
    return <Navigate to={nextPath} replace />;
  }

  if (context?.sessionKind === "display") {
    const nextPath = getAllowedRouteOrDefault(requestedPath, {
      loginState: context.loginState,
      sessionKind: context.sessionKind,
      access: context.access,
      operatorName: context.operatorName,
      displaySurfaceType: context.device?.surfaceType,
      displayOutputId: context.device?.outputId,
    });
    return <Navigate to={nextPath} replace />;
  }

  const connectionNoticeMessage =
    authServerStatus === "checking"
      ? "Connecting to WorshipSync..."
      : hasStoredServerSession
        ? "Could not verify this device. Retry or use the offline demo."
        : "Could not reach WorshipSync. Sign-in needs a connection.";

  const connectionNotice = isAuthConnectionNoticeVisible ? (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-yellow-100/90"
      role="status"
    >
      <p className="min-w-0">{connectionNoticeMessage}</p>
      {authServerStatus === "offline" ? (
        <Button
          type="button"
          variant="textLink"
          className="shrink-0 text-yellow-50"
          onClick={() => {
            void handleRetryAuthConnection();
          }}
          disabled={isRetryingAuthConnection}
          isLoading={isRetryingAuthConnection}
        >
          {isRetryingAuthConnection ? "Trying again..." : "Try again"}
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <AuthScreenMain>
      <div className="flex w-full max-w-3xl flex-col rounded-2xl border border-gray-500 bg-gray-800 p-6 sm:p-8">
        {entryStep === "link" ? (
          <section aria-labelledby="entry-link-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="entry-link-heading"
                className="text-xs font-semibold uppercase tracking-wide text-gray-400"
              >
                Link with a code (no personal account)
              </h2>
              <Button
                component="button"
                type="button"
                variant="textLink"
                svg={ArrowLeft}
                iconSize="sm"
                gap="gap-1.5"
                className="shrink-0"
                onClick={() => {
                  setEntryStep("landing");
                }}
              >
                Back
              </Button>
            </div>
            <p className="mt-1 text-sm text-gray-300">
              Shared controller for the live presentation, or a linked display
              for the audience (room screens, stream, credits, or discussion
              board). Enter the code from account settings. There is no mode
              switch on the next screen.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Button
                component="link"
                to="/workstation/pair"
                variant="tertiary"
                className="min-h-22 flex-col items-start justify-center gap-2 rounded-xl border border-gray-500 bg-gray-900/50 p-4 text-left sm:min-h-24"
                state={nextState}
                disabled={isServerBackedModeDisabled}
                wrap
              >
                <span className="text-lg font-semibold">
                  Link as workstation
                </span>
                <span className="text-sm font-normal text-gray-200">
                  Shared computer for the full live controller with no personal
                  sign-in. You can also open audience outputs on this device, or
                  use a linked display on another machine.
                </span>
              </Button>
              <Button
                component="link"
                to="/display/pair"
                variant="tertiary"
                className="min-h-22 flex-col items-start justify-center gap-2 rounded-xl border border-gray-500 bg-gray-900/50 p-4 text-left sm:min-h-24"
                state={nextState}
                disabled={isServerBackedModeDisabled}
                wrap
              >
                <span className="text-lg font-semibold">Link as display</span>
                <span className="text-sm font-normal text-gray-200">
                  Room screens, stream, credits, or discussion board content
                  your team presents from WorshipSync.
                </span>
              </Button>
            </div>
            {connectionNotice ? (
              <div className="mt-3">{connectionNotice}</div>
            ) : null}
          </section>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                component="link"
                to="/login"
                variant="cta"
                padding="px-4 py-2"
                state={nextState}
              >
                Sign in
              </Button>
            </div>

            <div className="mt-6 flex flex-col items-center text-center">
              <img
                src={WorshipSyncImage}
                alt="WorshipSync"
                className="mx-auto max-w-[42%] sm:max-w-[36%]"
                width={220}
                height={201}
                loading="eager"
              />
              <h1 className="mt-5 text-2xl font-semibold sm:text-3xl">
                Keep every part of worship in sync
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-200 sm:text-base">
                Presentation, scheduling, chat, and discussion boards—so the
                room, the stream, and the team stay connected.
              </p>
            </div>

            <section
              aria-labelledby="entry-product-heading"
              className="mt-8 border-t border-gray-600/80 pt-6"
            >
              <h2
                id="entry-product-heading"
                className="text-xs font-semibold uppercase tracking-wide text-gray-400"
              >
                What you can do
              </h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {productHighlights.map((highlight) => (
                  <li key={highlight.title} className="flex gap-3 text-left">
                    <span
                      aria-hidden
                      className="mt-0.5 shrink-0 text-orange-400"
                    >
                      <Icon
                        svg={highlight.icon}
                        size="md"
                        className="text-orange-400"
                        svgClassName="text-orange-400"
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-white">
                        {highlight.title}
                      </p>
                      <p className="mt-1 text-sm text-gray-300">
                        {highlight.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section
              aria-labelledby="entry-more-setup-heading"
              className="mt-8 border-t border-gray-600/80 pt-6"
            >
              <h2
                id="entry-more-setup-heading"
                className="text-xs font-semibold uppercase tracking-wide text-gray-400"
              >
                More ways to get started
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Button
                  component="button"
                  type="button"
                  variant="secondary"
                  svg={KeyRound}
                  iconSize="sm"
                  gap="gap-2"
                  className="w-full justify-center"
                  disabled={isServerBackedModeDisabled}
                  onClick={() => {
                    setEntryStep("link");
                  }}
                >
                  Link with code
                </Button>
                <Button
                  component="button"
                  type="button"
                  variant="secondary"
                  svg={UserRound}
                  iconSize="sm"
                  gap="gap-2"
                  className="w-full justify-center"
                  onClick={() => {
                    context?.enterGuestMode(guestDestination);
                  }}
                >
                  Test as guest
                </Button>
              </div>
              {connectionNotice ? (
                <div className="mt-3">{connectionNotice}</div>
              ) : null}
            </section>
          </>
        )}

        <footer className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-gray-600/80 pt-5 text-sm text-gray-300">
          <Link
            to="/privacy"
            className="underline underline-offset-2 hover:text-white"
          >
            Privacy Policy
          </Link>
          <span aria-hidden className="text-gray-600">
            ·
          </span>
          <Link
            to="/terms"
            className="underline underline-offset-2 hover:text-white"
          >
            Terms of Service
          </Link>
        </footer>
      </div>
    </AuthScreenMain>
  );
};

export default AppEntry;
