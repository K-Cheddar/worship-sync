import { useContext, useState, useEffect, useMemo } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  Cloud,
  Users,
  Save,
  LogOut,
  Loader2,
  ChevronDown,
  ChevronRight,
  MonitorSmartphone,
  MessageCircle,
  Pencil,
} from "lucide-react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import Icon from "../../../components/Icon/Icon";
import Button from "../../../components/Button/Button";
import PopOver from "../../../components/PopOver/PopOver";
import Input from "../../../components/Input/Input";
import { Switch } from "../../../components/ui/Switch";
import {
  NOTIFICATION_CATEGORY_COPY,
  orderNotificationCategories,
} from "../../../utils/notificationCategories";
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
import ChatLauncher from "../../../chat/ChatLauncher";
import { useChat } from "../../../chat/ChatContext";

const ACCOUNT_TRIGGER_MAX_W = "max-w-[10rem]";

const getInstanceLabel = (instance: Instance) =>
  instance.name?.trim() ||
  instance.user?.trim() ||
  instance.deviceLabel?.trim() ||
  "Operator";

const getPresenceRouteLabel = (presenceRoute?: string | null) => {
  if (!presenceRoute) return "Display";
  if (presenceRoute === "/projector") return "Projector";
  if (presenceRoute === "/projector-full") return "Projector Full";
  if (presenceRoute === "/monitor") return "Monitor";
  if (presenceRoute === "/stream") return "Stream";
  if (presenceRoute === "/stream-info") return "Stream Info";
  if (presenceRoute === "/credits") return "Credits";
  if (presenceRoute === "/boards/display") return "Board Display";
  if (presenceRoute.startsWith("/boards/present/")) return "Board Present";
  return "Display";
};

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
    notificationCategories,
    notificationPreferences,
    setNotificationPreference,
    exitGuestMode,
    endWorkstationOperatorSession,
  } = useContext(GlobalInfoContext) || {};
  const { isMobile, logout } = useContext(ControllerInfoContext) || {};
  const chat = useChat();
  const isDemo = loginState === "guest";
  const isLoggedIn = loginState === "success";
  const [isPulsing, setIsPulsing] = useState(false);
  const [firebaseDisplayName, setFirebaseDisplayName] = useState("");
  const [isAccountPopoverOpen, setIsAccountPopoverOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [displaysExpanded, setDisplaysExpanded] = useState(false);
  const [notificationsExpanded, setNotificationsExpanded] = useState(false);
  /** Which switch is mid-save, so only that one disables. */
  const [savingCategory, setSavingCategory] = useState("");
  const visibleNotificationCategories = useMemo(
    () => orderNotificationCategories(notificationCategories),
    [notificationCategories],
  );
  const enabledNotificationCount = useMemo(
    () =>
      visibleNotificationCategories.filter(
        (category) => notificationPreferences?.[category] !== "off",
      ).length,
    [notificationPreferences, visibleNotificationCategories],
  );
  const notificationSummary = (() => {
    const total = visibleNotificationCategories.length;
    if (total === 0) return "";
    if (enabledNotificationCount === total) return "All on";
    if (enabledNotificationCount === 0) return "All off";
    return `${enabledNotificationCount} of ${total} on`;
  })();
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

  const handleAccountPopoverOpenChange = (open: boolean) => {
    setIsAccountPopoverOpen(open);
    if (!open) {
      setDisplaysExpanded(false);
      setNotificationsExpanded(false);
      setIsEditingName(false);
      setNameDraft(fullDisplayName || "");
    }
  };

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

  const { operatorRows, displayRows } = useMemo(() => {
    const instances = activeInstances || [];
    const sortedInstances = [...instances]
      .sort((a, b) => {
        if (a.hostId === hostId) return -1;
        if (b.hostId === hostId) return 1;
        return getInstanceLabel(a).localeCompare(getInstanceLabel(b));
      });

    const mappedInstances = sortedInstances.map((instance) => ({
      instance,
      key: instance.hostId,
      label: getInstanceLabel(instance),
      routeLabel: getPresenceRouteLabel(instance.presenceRoute),
      isDisplay:
        instance.presenceSurface === "display" ||
        instance.sessionKind === "display",
      isCurrentHost: instance.hostId === hostId,
      detail:
        instance.sessionKind === "workstation"
          ? "Shared workstation"
          : null,
    }));

    return {
      operatorRows: mappedInstances.filter((instance) => !instance.isDisplay),
      displayRows: mappedInstances.filter((instance) => instance.isDisplay),
    };
  }, [activeInstances, hostId]);

  useEffect(() => {
    if (displayRows.length === 0) {
      setDisplaysExpanded(false);
    }
  }, [displayRows.length]);

  const activeInstanceRows = useMemo(
    () =>
      operatorRows.map((instance) => ({
        key: instance.key,
        label: instance.label,
        isCurrentHost: instance.isCurrentHost,
        detail: instance.detail,
      })),
    [operatorRows]
  );
  const activeCount = activeInstanceRows.length;

  const accountAriaLabel = (() => {
    let label = "";
    if (!fullDisplayName && !churchLine) {
      label = "Account";
    } else if (!churchLine) {
      label = `Account: ${fullDisplayName}`;
    } else {
      label = `Account: ${fullDisplayName}, ${churchLine}`;
    }
    if (!isMobile && !isDemo) {
      label = `${label}. ${activeCount} active ${activeCount === 1 ? "session" : "sessions"}`;
    }
    if (chat?.unreadCount) {
      label = `${label}. ${chat.unreadCount} unread team chat ${chat.unreadCount === 1 ? "message" : "messages"}`;
    }
    return label;
  })();

  const accountBlock = (
    <PopOver
      open={isAccountPopoverOpen}
      onOpenChange={handleAccountPopoverOpenChange}
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
            {(!isDemo || anyAutosavePending) ? (
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
                <div className="flex shrink-0 items-center gap-2">
                  {!isMobile && !isDemo ? (
                    <span
                      className="flex items-center gap-1"
                      title="Active sessions"
                    >
                      <Icon
                        svg={Users}
                        size="xs"
                        color="#22d3ee"
                        className={isPulsing ? "animate-pulse" : ""}
                      />
                      <span className="text-sm tabular-nums">{activeCount}</span>
                    </span>
                  ) : null}
                  {chat?.unreadCount ? (
                    <span
                      className="flex items-center gap-1"
                      title={`${chat.unreadCount} unread team chat ${chat.unreadCount === 1 ? "message" : "messages"}`}
                    >
                      <Icon svg={MessageCircle} size="xs" color="#22d3ee" />
                      <span className="text-sm tabular-nums text-cyan-300">
                        {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : chat?.unreadCount ? (
              <div className="flex w-full min-w-0 items-center justify-end gap-1">
                <span
                  className="flex items-center gap-1"
                  title={`${chat.unreadCount} unread team chat ${chat.unreadCount === 1 ? "message" : "messages"}`}
                >
                  <Icon svg={MessageCircle} size="xs" color="#22d3ee" />
                  <span className="text-sm tabular-nums text-cyan-300">
                    {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                  </span>
                </span>
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
        </Button>
      }
    >
      <div className="flex min-w-[240px] max-w-sm flex-col gap-3 pt-1">
        <ChatLauncher onOpen={() => setIsAccountPopoverOpen(false)} />

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Account
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-gray-500">Name</span>
            {isEditingName ? (
              <>
                <Input
                  id="account-display-name"
                  label="Display name"
                  hideLabel
                  value={nameDraft}
                  onChange={(value) => setNameDraft(String(value))}
                  disabled={isSavingName}
                />
                <div className="mt-1 flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1 justify-center text-sm"
                    disabled={isSavingName}
                    onClick={() => {
                      setNameDraft(fullDisplayName || "");
                      setIsEditingName(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    svg={Save}
                    iconSize="sm"
                    color="#22d3ee"
                    className="flex-1 justify-center text-sm"
                    isLoading={isSavingName}
                    disabled={
                      isSavingName ||
                      !nameDraft.trim() ||
                      nameDraft.trim() === fullDisplayName
                    }
                    onClick={() => {
                      void (async () => {
                        setIsSavingName(true);
                        try {
                          const didUpdate =
                            await updateSelfDisplayName?.(nameDraft);
                          if (didUpdate) {
                            setFirebaseDisplayName(nameDraft.trim());
                            setIsEditingName(false);
                          }
                        } finally {
                          setIsSavingName(false);
                        }
                      })();
                    }}
                  >
                    Save
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="wrap-break-word text-sm font-semibold text-white">
                  {fullDisplayName || "—"}
                </span>
                {sessionKind === "human" && updateSelfDisplayName ? (
                  <Button
                    type="button"
                    variant="tertiary"
                    aria-label="Edit name"
                    className="shrink-0 rounded p-0.5"
                    onClick={() => setIsEditingName(true)}
                    svg={Pencil}
                  />
                ) : null}
              </div>
            )}
          </div>
          {emailLine ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-gray-500">
                Email
              </span>
              <span className="wrap-break-word text-sm text-gray-300">
                {emailLine}
              </span>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-gray-500">Church</span>
            <div className="flex min-w-0 items-center gap-2.5">
              {churchLogoUrl ? (
                <ChurchLogoImg src={churchLogoUrl} variant="popover" />
              ) : null}
              <span className="min-w-0 flex-1 wrap-break-word text-sm leading-snug text-gray-300">
                {churchLine || "—"}
              </span>
            </div>
          </div>
        </div>

        {activeInstanceRows.length > 0 || displayRows.length > 0 ? (
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
                    <span className="text-xs text-gray-400">
                      {instance.detail}
                    </span>
                  ) : null}
                </li>
              ))}
              {displayRows.length > 0 ? (
                <li className="rounded-md border border-gray-700/80 bg-black/15">
                  <Button
                    type="button"
                    variant="none"
                    className="w-full justify-between gap-3 px-2 py-2 text-left"
                    onClick={() => setDisplaysExpanded((current) => !current)}
                    aria-expanded={displaysExpanded}
                    aria-controls="active-display-list"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <MonitorSmartphone className="size-4 shrink-0 text-cyan-300" />
                      <span className="text-sm text-white">
                        {displayRows.length}{" "}
                        {displayRows.length === 1 ? "display" : "displays"}
                      </span>
                    </span>
                    {displaysExpanded ? (
                      <ChevronDown className="size-4 shrink-0 text-gray-400" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-gray-400" />
                    )}
                  </Button>
                  {displaysExpanded ? (
                    <ul
                      id="active-display-list"
                      className="border-t border-gray-700/80 px-2 py-2"
                      aria-label="Active displays"
                    >
                      {displayRows.map((instance) => (
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
                          <span className="text-xs text-gray-400">
                            {instance.routeLabel}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {isLoggedIn && visibleNotificationCategories.length > 0 ? (
          <div className="border-t border-gray-600 pt-3">
            <div className="rounded-md border border-gray-700/80 bg-black/15">
              <Button
                type="button"
                variant="none"
                className="w-full justify-between gap-3 px-2 py-2 text-left"
                onClick={() =>
                  setNotificationsExpanded((current) => !current)
                }
                aria-expanded={notificationsExpanded}
                aria-controls="email-notification-preferences"
              >
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="text-sm text-white">Email notifications</span>
                  <span className="text-xs text-gray-400">
                    {notificationSummary}
                  </span>
                </span>
                {notificationsExpanded ? (
                  <ChevronDown className="size-4 shrink-0 text-gray-400" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-gray-400" />
                )}
              </Button>
              {notificationsExpanded ? (
                <div
                  id="email-notification-preferences"
                  className="flex flex-col gap-3 border-t border-gray-700/80 px-2 py-3"
                >
                  {visibleNotificationCategories.map((category) => {
                    const copy = NOTIFICATION_CATEGORY_COPY[category];
                    // Only an explicit "off" mutes; "default" and anything unset
                    // resolve to on, mirroring isNotificationEnabled on the server.
                    const enabled =
                      notificationPreferences?.[category] !== "off";
                    return (
                      <label
                        key={category}
                        className="flex items-start justify-between gap-3"
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-sm font-medium text-white">
                            {copy.label}
                          </span>
                          <span className="text-xs text-gray-400">
                            {copy.description}
                          </span>
                        </span>
                        <Switch
                          checked={enabled}
                          disabled={savingCategory === category}
                          aria-label={copy.ariaLabel}
                          onCheckedChange={(checked) => {
                            void (async () => {
                              setSavingCategory(category);
                              try {
                                await setNotificationPreference(
                                  category,
                                  checked,
                                );
                              } finally {
                                setSavingCategory("");
                              }
                            })();
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
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
              Leave the local demo and open the screen where you choose sign-in,
              link a device, or guest mode.
            </p>
          </div>
        ) : null}
      </div>
    </PopOver>
  );

  return <div className="flex min-w-0 items-center text-white">{accountBlock}</div>;
};

export default UserSection;
