import { useContext, useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  CloudOff,
  Cloud,
  Users,
  Save,
  LogOut,
  Loader2,
} from "lucide-react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import Icon from "../../../components/Icon/Icon";
import Button from "../../../components/Button/Button";
import PopOver from "../../../components/PopOver/PopOver";
import Input from "../../../components/Input/Input";
import { WORKSTATION_END_SESSION_LABEL } from "../../../components/WorkstationUnpairConfirmModal/WorkstationUnpairConfirmModal";
import { getHumanAuth } from "../../../firebase/apps";
import {
  firstNameFromDisplayName,
  resolveAccountDisplayNameForAudit,
} from "../../../utils/displayName";
import { ChurchLogoImg } from "../../../components/ChurchLogoImg";
import { resolveChurchToolbarLogoUrl } from "../../../utils/churchBranding";
import type { Instance } from "../../../types";
import { useSelector } from "../../../hooks";
import { selectAnyAutosavePending } from "../../../store/autosaveIndicatorSlice";

const ACCOUNT_TRIGGER_MAX_W = "max-w-[10rem]";

const isToolbarAutosaveStatusRoute = (pathname: string) =>
  pathname.startsWith("/controller") ||
  pathname === "/overlay-controller" ||
  pathname === "/credits-editor";

const UserSection = () => {
  const {
    user,
    userEmail,
    activeInstances,
    hostId,
    sessionKind,
    loginState,
    churchName,
    churchBranding,
    updateSelfDisplayName,
    exitGuestMode,
    endWorkstationOperatorSession,
  } = useContext(GlobalInfoContext) || {};
  const { isMobile, logout } = useContext(ControllerInfoContext) || {};
  const isDemo = loginState === "guest";
  const isLoggedIn = loginState === "success";
  const [isPulsing, setIsPulsing] = useState(false);
  const [firebaseDisplayName, setFirebaseDisplayName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const { pathname } = useLocation();
  const showToolbarAutosaveStatus = isToolbarAutosaveStatusRoute(pathname);
  const anyAutosavePending = useSelector(selectAnyAutosavePending);

  useEffect(() => {
    if (sessionKind !== "human") {
      setFirebaseDisplayName("");
      return;
    }
    const auth = getHumanAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setFirebaseDisplayName(u?.displayName?.trim() || "");
    });
    return () => unsub();
  }, [sessionKind]);

  const fullDisplayName = useMemo(
    () =>
      resolveAccountDisplayNameForAudit({
        sessionKind: sessionKind ?? null,
        user: user ?? "",
        firebaseHumanDisplayName: firebaseDisplayName,
      }),
    [sessionKind, firebaseDisplayName, user],
  );

  const toolbarFirstName = firstNameFromDisplayName(fullDisplayName);
  const churchLine = churchName?.trim() ?? "";
  const churchLogoUrl = useMemo(
    () => resolveChurchToolbarLogoUrl(churchBranding),
    [churchBranding],
  );
  const emailLine = userEmail?.trim() ?? "";

  useEffect(() => {
    setNameDraft(fullDisplayName || "");
  }, [fullDisplayName]);

  useEffect(() => {
    if ((activeInstances?.length || 0) > 0) {
      setIsPulsing(true);
      const timer = setTimeout(() => {
        setIsPulsing(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [activeInstances?.length]);

  const activeCount = activeInstances?.length || 0;
  const activeInstanceRows = useMemo(() => {
    const instances = activeInstances || [];
    const getInstanceLabel = (instance: Instance) =>
      instance.name?.trim() ||
      instance.user?.trim() ||
      instance.deviceLabel?.trim() ||
      "Operator";

    return [...instances]
      .sort((a, b) => {
        if (a.hostId === hostId) return -1;
        if (b.hostId === hostId) return 1;
        return getInstanceLabel(a).localeCompare(getInstanceLabel(b));
      })
      .map((instance) => ({
        key: instance.hostId,
        label: getInstanceLabel(instance),
        isCurrentHost: instance.hostId === hostId,
        detail:
          instance.sessionKind === "workstation"
            ? "Shared workstation"
            : null,
      }));
  }, [activeInstances, hostId]);

  const accountAriaLabel = (() => {
    let label = "";
    if (!fullDisplayName && !churchLine) {
      label = "Account";
    } else if (!churchLine) {
      label = `Account: ${fullDisplayName}`;
    } else {
      label = `Account: ${fullDisplayName}, ${churchLine}`;
    }
    if (!isMobile) {
      label = `${label}. ${activeCount} active ${activeCount === 1 ? "session" : "sessions"}`;
    }
    return label;
  })();

  const accountBlock = (
    <PopOver
      TriggeringButton={
        <Button
          type="button"
          variant="tertiary"
          gap="gap-2"
          padding="py-0.5 px-1"
          className="h-auto min-h-0! max-md:min-h-0! rounded-md font-normal"
          aria-label={accountAriaLabel}
        >
          <div
            className={`flex min-w-0 flex-col gap-1 items-start text-left ${ACCOUNT_TRIGGER_MAX_W}`}
          >
            {showToolbarAutosaveStatus ? (
              <div className="flex w-full min-w-0 items-center gap-1">
                <div
                  className="flex min-w-0 flex-1 items-center gap-1 text-xs font-medium"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <span
                    className="inline-flex size-3.5 shrink-0 items-center justify-center"
                    aria-hidden
                  >
                    {anyAutosavePending ? (
                      <Loader2 className="size-3.5 animate-spin text-gray-400" />
                    ) : isDemo ? (
                      <CloudOff className="size-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <Cloud className="size-3.5 shrink-0 text-emerald-400" />
                    )}
                  </span>
                  <span
                    className={`min-w-15 leading-none ${anyAutosavePending ? "text-gray-400" : "text-emerald-400"}`}
                  >
                    {anyAutosavePending ? "Syncing..." : "Synced"}
                  </span>
                </div>
                {!isMobile ? (
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-flex shrink-0"
                      title="Active sessions"
                    >
                      <Icon
                        svg={Users}
                        size="xs"
                        color="#22d3ee"
                        className={isPulsing ? "animate-pulse" : ""}
                      />
                    </span>
                    <span className="shrink-0 text-sm">{activeCount}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="flex min-w-0 w-full flex-col gap-0.5 text-center">
              <span className="w-full truncate text-sm font-semibold max-w-28">
                {toolbarFirstName || fullDisplayName || "—"}
              </span>
              {churchLine ? (
                <span className="w-full truncate text-xs text-gray-300 max-w-28">
                  {churchLine}
                </span>
              ) : null}
            </div>
          </div>
          {!isMobile && !showToolbarAutosaveStatus ? (
            <>
              <span className="inline-flex shrink-0" title="Active sessions">
                <Icon
                  svg={Users}
                  size="xs"
                  color="#22d3ee"
                  className={isPulsing ? "animate-pulse" : ""}
                />
              </span>
              <span className="shrink-0 text-sm">{activeCount}</span>
            </>
          ) : null}
        </Button>
      }
    >
      <div className="flex min-w-[220px] max-w-sm flex-col gap-3 pt-1">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            User
          </span>
          <span className="wrap-break-word text-sm font-semibold text-white">
            {fullDisplayName || "—"}
          </span>
        </div>
        {emailLine ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Email
            </span>
            <span className="wrap-break-word text-sm text-gray-300">{emailLine}</span>
          </div>
        ) : null}
        {sessionKind === "human" && updateSelfDisplayName ? (
          <div className="border-t border-gray-600 pt-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Name
            </span>
            <Input
              className="mt-2"
              id="account-display-name"
              label="Display name"
              hideLabel
              value={nameDraft}
              onChange={(value) => setNameDraft(String(value))}
              disabled={isSavingName}
            />
            <Button
              type="button"
              variant="secondary"
              svg={Save}
              iconSize="sm"
              color="#22d3ee"
              className="mt-2 w-full justify-center text-sm"
              isLoading={isSavingName}
              disabled={isSavingName || !nameDraft.trim() || nameDraft.trim() === fullDisplayName}
              onClick={() => {
                void (async () => {
                  setIsSavingName(true);
                  try {
                    const didUpdate = await updateSelfDisplayName(nameDraft);
                    if (didUpdate) {
                      setFirebaseDisplayName(nameDraft.trim());
                    }
                  } finally {
                    setIsSavingName(false);
                  }
                })();
              }}
            >
              Save name
            </Button>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Church
          </span>
          <div className="flex min-w-0 items-center gap-2.5">
            {churchLogoUrl ? (
              <ChurchLogoImg src={churchLogoUrl} variant="popover" />
            ) : null}
            <span className="min-w-0 flex-1 wrap-break-word text-sm leading-snug text-gray-300">
              {churchLine || "—"}
            </span>
          </div>
        </div>
        {activeInstanceRows.length > 0 ? (
          <div className="border-t border-gray-600 pt-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Active right now
            </span>
            <ul className="mt-2 flex flex-col gap-2" aria-label="Active sessions">
              {activeInstanceRows.map((instance) => (
                <li
                  key={instance.key}
                  className={
                    instance.isCurrentHost
                      ? "flex flex-col gap-1 rounded-md border border-cyan-500/35 bg-cyan-950/40 px-2 py-2"
                      : "flex flex-col gap-1 px-2 py-1"
                  }
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="wrap-break-word text-sm text-white">
                      {instance.label}
                    </span>
                    {instance.isCurrentHost ? (
                      <span className="shrink-0 rounded border border-cyan-400/60 bg-cyan-950/60 px-1.5 py-px text-xs font-semibold uppercase tracking-wide text-cyan-200">
                        You
                      </span>
                    ) : null}
                  </div>
                  {instance.detail ? (
                    <span className="text-xs text-gray-400">{instance.detail}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {isLoggedIn &&
          (sessionKind === "workstation" && endWorkstationOperatorSession ? (
            <div className="border-t border-gray-600 pt-3">
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-center text-sm"
                onClick={() => void endWorkstationOperatorSession()}
              >
                {WORKSTATION_END_SESSION_LABEL}
              </Button>
            </div>
          ) : logout ? (
            <div className="border-t border-gray-600 pt-3">
              <Button
                type="button"
                variant="primary"
                svg={LogOut}
                iconSize="sm"
                color="#22d3ee"
                className="w-full justify-center text-sm"
                onClick={() => void logout()}
              >
                Sign out
              </Button>
            </div>
          ) : null)}
        {isDemo && exitGuestMode ? (
          <div className="border-t border-gray-600 pt-3">
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-center text-sm"
              onClick={() => exitGuestMode()}
            >
              Return to start
            </Button>
            <p className="mt-2 text-xs text-gray-400">
              Leave the local demo and open the screen where you choose sign-in, link a
              device, or guest mode.
            </p>
          </div>
        ) : null}
      </div>
    </PopOver>
  );

  return <div className="flex min-w-0 items-center text-white">{accountBlock}</div>;
};

export default UserSection;
