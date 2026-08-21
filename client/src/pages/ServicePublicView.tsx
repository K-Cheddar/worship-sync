import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, LocateFixed, Mic2, Moon, Radio, RefreshCw, Sun } from "lucide-react";
import Button from "../components/Button/Button";
import { ChurchLogoImg } from "../components/ChurchLogoImg";
import ProfileImagePreview from "../components/ProfileImagePreview/ProfileImagePreview";
import Select from "../components/Select/Select";
import ServicePlanRolePicker from "../components/ServicePlanRolePicker";
import ServiceFlowRichText from "../components/ServiceFlowRichText/ServiceFlowRichText";
import { getServiceFlowProgress } from "../services/serviceFlowProgress";
import type {
  PublicServiceFlowItem,
  PublicServiceFlowServingTeam,
  PublicServiceFlowSnapshot,
} from "../services/serviceFlowTypes";
import type { PublicServiceConnection } from "../services/usePublicServiceFlow";
import { cn } from "../utils/cnHelper";
import { formatServicePlanDuration } from "./Services/servicePlanDuration";
import { ServicePlanMicrophoneChip } from "../components/ServicePlanMicrophoneChip";
import {
  readServicePublicNotesTeam,
  writeServicePublicNotesTeam,
} from "./servicePublicNotesTeam";
import { publicPageScrollClassName } from "./Teams/teamsStyles";
import { normalizeHexColor } from "../utils/richTextColorContrast";
import {
  getServicePlanRoleNoteTeamName,
  getServicePlanRoleNoteRoleName,
  roleNoteMatchesServicePlanTeam,
} from "./Services/servicePlanRoleNoteTeam";

const servicePublicItemDomId = (itemId: string) => `service-item-${itemId}`;

/**
 * Ignore scroll events from our own smooth scroll so they do not pause
 * follow. Smooth-scroll duration scales with distance, so this is a settle
 * window that re-extends on every event while the animation is still
 * producing scroll events, rather than a fixed timeout — a long scroll
 * (live item far from the current position) can easily run past a fixed
 * 1s window and have its own tail end mistaken for a manual scroll.
 */
const PROGRAMMATIC_SCROLL_SUPPRESS_MS = 300;
const SERVICE_PUBLIC_THEME_STORAGE_KEY = "worshipsyncServicePublicTheme";
type ServicePublicTheme = "dark" | "light";

const readServicePublicTheme = (): ServicePublicTheme => {
  try {
    return window.localStorage.getItem(SERVICE_PUBLIC_THEME_STORAGE_KEY) === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
};

const persistServicePublicTheme = (theme: ServicePublicTheme) => {
  try {
    window.localStorage.setItem(SERVICE_PUBLIC_THEME_STORAGE_KEY, theme);
  } catch {
    // Embedded and privacy-restricted browsers can deny storage access.
  }
};

const scrollServicePublicItemNearTop = (itemId: string) => {
  document.getElementById(servicePublicItemDomId(itemId))?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
};

const formatServiceDate = (value: string, timezone: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: timezone,
  }).format(new Date(value));

const formatServiceTime = (value: number, timezone: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric", minute: "2-digit", timeZone: timezone,
  }).format(new Date(value));

const itemHasNotes = (
  item: PublicServiceFlowItem,
  selectedTeam: string,
  selectedRole: string,
) => {
  if (item.notes.blocks.length) return true;
  return Boolean(
    visibleAudienceNotesForItem(item, selectedTeam, selectedRole).length
    || visibleMicrophoneAssignmentsForItem(item, selectedTeam, selectedRole).length,
  );
};

const visibleAudienceNotesForItem = (
  item: PublicServiceFlowItem,
  selectedTeam: string,
  selectedRole: string,
) => {
  const notes = item.teamNotes || [];
  return notes.filter((note) =>
    note.scope === "role"
      ? roleNoteMatchesServicePlanTeam(note, selectedTeam)
      && (!selectedRole || rolePositionIds(note).includes(selectedRole))
      : !selectedTeam || note.label === selectedTeam,
  );
};

const visibleMicrophoneAssignmentsForItem = (
  item: PublicServiceFlowItem,
  selectedTeam: string,
  selectedRole: string,
) =>
  (item.microphoneAssignments || []).filter((assignment) => {
    // A microphone whose holder is named but whose roles are not configured
    // still belongs on the unfiltered view — otherwise it would vanish for
    // everyone rather than just for the role that filtered it out.
    if (!assignment.audiences.length) return !selectedTeam && !selectedRole;
    return assignment.audiences.some((audience) =>
      (!selectedTeam || audience.teamName === selectedTeam)
      && (!selectedRole || audience.positionId === selectedRole),
    );
  });

const rolePositionIds = (note: { positionId?: string; positionIds?: string[] }) =>
  note.positionIds?.filter(Boolean) ?? (note.positionId ? [note.positionId] : []);

const normalizePublicBrandHex = (raw: string) => {
  const trimmed = String(raw || "").trim();
  const normalized = normalizeHexColor(trimmed);
  if (normalized) return normalized;
  // Branding allows #RRGGBBAA; public chrome uses the RGB portion.
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) {
    return normalizeHexColor(`#${trimmed.slice(1, 7)}`);
  }
  return null;
};

/**
 * The detailed link is used by service teams. Keep their scheduled mic
 * handoff beside the running order, without exposing it on the simple link.
 */
const PublicServingTeamsPanel = ({
  teams,
  secondaryColor,
  theme,
}: {
  teams: PublicServiceFlowServingTeam[];
  secondaryColor?: string | null;
  theme: ServicePublicTheme;
}) => (
  <aside
    className={cn(
      "rounded-xl border p-3 shadow-lg lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto",
      theme === "light" ? "border-slate-200 bg-white" : "border-neutral-700/80 bg-neutral-900/95",
    )}
    aria-label="Microphone assignments"
  >
    <div className="flex items-center gap-2">
      <Mic2 className={cn("size-4", theme === "light" ? "text-cyan-800" : "text-cyan-300")} aria-hidden />
      <h2 className={cn("text-sm font-semibold", theme === "light" ? "text-slate-900" : "text-neutral-100")}>
        Microphone assignments
      </h2>
    </div>
    <p className={cn("mt-1 text-xs leading-5", theme === "light" ? "text-slate-700" : "text-neutral-400")}>
      Microphones in use for this service.
    </p>
    <div className="mt-3 space-y-4">
      {teams.map((team) => (
        <section key={team.teamId} aria-labelledby={`serving-team-${team.teamId}`}>
          <h3
            id={`serving-team-${team.teamId}`}
            className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-200/90"
            style={secondaryColor ? { color: secondaryColor } : undefined}
          >
            {team.teamName}
          </h3>
          <ul className="mt-1.5 space-y-1.5">
            {team.members.map((member) => (
              <li
                key={`${member.positionId}:${member.memberName}`}
                className={cn("rounded-md border px-2 py-1.5", theme === "light" ? "border-slate-200 bg-slate-50" : "border-neutral-700/70 bg-neutral-950/50")}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {member.profileImageUrl ? (
                      <ProfileImagePreview
                        imageUrl={member.profileImageUrl}
                        memberName={member.memberName}
                        className="size-16"
                      />
                    ) : null}
                    <span className={cn("min-w-0 truncate text-xs font-medium", theme === "light" ? "text-slate-900" : "text-neutral-100")}>
                      {member.memberName}
                    </span>
                  </div>
                  <span className={cn("shrink-0 text-xs", theme === "light" ? "text-slate-800" : "text-neutral-300")}>
                    {member.positionName}
                  </span>
                </div>
                <div
                  className="mt-1 flex flex-wrap gap-1"
                  aria-label={`Microphones for ${member.memberName}`}
                >
                  {member.microphones.map((microphone) => (
                    <ServicePlanMicrophoneChip
                      key={microphone.id}
                      microphone={microphone}
                      theme={theme}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  </aside>
);

export type ServicePublicViewProps = {
  snapshot: PublicServiceFlowSnapshot;
  connection?: PublicServiceConnection;
  error?: string;
  /**
   * Parent owns the page shell (My Schedule tabs). Skips the full-page scroll
   * main and the fixed "Follow live" dock.
   */
  embedded?: boolean;
  onRefresh?: () => void;
};

/**
 * Public service plan chrome — shared by the anonymous share link and the
 * signed-in My Schedule service-plan tab.
 */
const ServicePublicView = ({
  snapshot,
  connection = "connected",
  error = "",
  embedded = false,
  onRefresh,
}: ServicePublicViewProps) => {
  const [clientNow, setClientNow] = useState(() => Date.now());
  const [selectedTeam, setSelectedTeam] = useState(() => readServicePublicNotesTeam());
  const [selectedRole, setSelectedRole] = useState("");
  const [collapsedNoteIds, setCollapsedNoteIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isFollowingLive, setIsFollowingLive] = useState(true);
  const [theme, setTheme] = useState<ServicePublicTheme>(readServicePublicTheme);
  const followedLiveItemIdRef = useRef<string | null>(null);
  const suppressFollowPauseUntilRef = useRef(0);
  const pointerScrollIntentUntilRef = useRef(0);

  useEffect(() => {
    const interval = window.setInterval(() => setClientNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    persistServicePublicTheme(theme);
  }, [theme]);

  const serverOffsetMs = useMemo(() => snapshot.serverNowMs - Date.now(), [snapshot]);
  const progress = useMemo(
    () => getServiceFlowProgress(snapshot.service, clientNow + serverOffsetMs),
    [clientNow, serverOffsetMs, snapshot],
  );
  const currentItemId = progress?.current?.item.id ?? null;

  const scrollCurrentNearTop = (itemId: string) => {
    suppressFollowPauseUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_SUPPRESS_MS;
    scrollServicePublicItemNearTop(itemId);
  };

  const pauseLiveFollow = () => {
    setIsFollowingLive((following) => (following ? false : following));
  };

  const handlePageScroll = () => {
    if (Date.now() < suppressFollowPauseUntilRef.current) {
      // Still inside our own smooth-scroll animation: extend the window so
      // it keeps covering the animation for as long as it keeps producing
      // scroll events, rather than expiring mid-animation on a fixed clock.
      suppressFollowPauseUntilRef.current =
        Date.now() + PROGRAMMATIC_SCROLL_SUPPRESS_MS;
      return;
    }
    // A live-item change can make the browser adjust its scroll anchor before
    // the follow effect starts. That scroll is not a viewer choosing to leave
    // the live item, so only pause for a scroll preceded by pointer intent
    // (such as dragging the scrollbar). Wheel, touch, and keyboard input pause
    // directly through their own handlers below.
    if (Date.now() >= pointerScrollIntentUntilRef.current) return;
    pointerScrollIntentUntilRef.current = 0;
    pauseLiveFollow();
  };

  const notePointerScrollIntent = () => {
    pointerScrollIntentUntilRef.current = Date.now() + 1_000;
  };

  const handlePageKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
      pauseLiveFollow();
    }
  };

  // Follow the live item near the top of the public page when it advances,
  // until the viewer scrolls away and pauses follow.
  useEffect(() => {
    if (!currentItemId) {
      followedLiveItemIdRef.current = null;
      return;
    }
    if (!isFollowingLive) return;
    if (followedLiveItemIdRef.current === currentItemId) return;
    followedLiveItemIdRef.current = currentItemId;
    let innerFrame = 0;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        suppressFollowPauseUntilRef.current =
          Date.now() + PROGRAMMATIC_SCROLL_SUPPRESS_MS;
        scrollServicePublicItemNearTop(currentItemId);
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      window.cancelAnimationFrame(innerFrame);
    };
  }, [currentItemId, isFollowingLive]);

  const toggleNotes = (itemId: string) => {
    setCollapsedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };
  const teamLabels = useMemo(() => {
    if (snapshot.service.viewMode === "general") return [];
    return Array.from(new Set(
      snapshot.service.sections.flatMap((section) =>
        section.items.flatMap((item) =>
          (item.teamNotes || [])
            .filter((note) => note.scope !== "role")
            .map((teamNote) => teamNote.label),
        ),
      ),
    )).sort((left, right) => left.localeCompare(right));
  }, [snapshot]);
  const allRoleOptions = useMemo(() => {
    if (snapshot.service.viewMode === "general") return [];
    const options = new Map<string, {
      positionId: string;
      label: string;
      teamId?: string;
      teamName?: string;
    }>();
    // Prefer the full church roster so quiet roles (no notes/mics) stay selectable.
    (snapshot.roles || []).forEach((role) => {
      const positionId = String(role.positionId || "").trim();
      const label = String(role.label || "").trim();
      if (!positionId || !label) return;
      options.set(positionId, {
        positionId,
        label,
        teamId: role.teamId,
        teamName: role.teamName,
      });
    });
    snapshot.service.sections.forEach((section) => {
      section.items.forEach((item) => {
        (item.teamNotes || []).forEach((note) => {
          if (note.scope === "role" && rolePositionIds(note).length) {
            const separatorIndex = note.label.indexOf(" · ");
            const legacyTeamName = separatorIndex > 0
              ? note.label.slice(0, separatorIndex)
              : "Other roles";
            const teamName = getServicePlanRoleNoteTeamName(note) || legacyTeamName;
            rolePositionIds(note).forEach((positionId) => {
              if (options.has(positionId)) return;
              options.set(positionId, {
                positionId,
                label: getServicePlanRoleNoteRoleName(note.label),
                teamId: note.teamIds?.[0] || note.teamId || `legacy:${teamName}`,
                teamName: note.teamNames?.[0] || teamName,
              });
            });
          }
        });
        (item.microphoneAssignments || []).forEach((assignment) => {
          assignment.audiences.forEach((audience) => {
            if (options.has(audience.positionId)) return;
            const teamName = audience.teamName || "Other roles";
            options.set(audience.positionId, {
              positionId: audience.positionId,
              label: audience.roleName,
              teamId: audience.teamId || `legacy:${teamName}`,
              teamName,
            });
          });
        });
      });
    });
    return Array.from(options.values())
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [snapshot]);
  const roleOptions = useMemo(
    () => allRoleOptions.filter((role) =>
      roleNoteMatchesServicePlanTeam(role, selectedTeam),
    ),
    [allRoleOptions, selectedTeam],
  );

  useEffect(() => {
    if (!teamLabels.length) {
      if (selectedTeam) setSelectedTeam("");
      return;
    }
    if (selectedTeam && teamLabels.includes(selectedTeam)) return;
    const stored = readServicePublicNotesTeam();
    if (stored && teamLabels.includes(stored)) {
      setSelectedTeam(stored);
      return;
    }
    if (selectedTeam) setSelectedTeam("");
  }, [selectedTeam, teamLabels]);

  useEffect(() => {
    if (!selectedRole) return;
    if (roleOptions.some((role) => role.positionId === selectedRole)) return;
    setSelectedRole("");
  }, [roleOptions, selectedRole]);

  const handleTeamNotesFilterChange = (value: string) => {
    const next = value === "__everyone__" ? "" : value;
    setSelectedTeam(next);
    writeServicePublicNotesTeam(next);
  };

  const jumpToCurrent = () => {
    if (!currentItemId) return;
    followedLiveItemIdRef.current = currentItemId;
    setIsFollowingLive(true);
    scrollCurrentNearTop(currentItemId);
  };

  const { service } = snapshot;
  const isGeneralView = service.viewMode === "general";
  let statusKind: "manual" | "complete" | "upcoming" | "live" = "live";
  if (progress?.isManual) statusKind = "manual";
  else if (progress?.state === "complete") statusKind = "complete";
  else if (progress?.state === "upcoming") statusKind = "upcoming";
  const statusLabelByKind = {
    manual: "Live update",
    complete: "Service complete",
    upcoming: "Starts soon",
    live: "Live now",
  } as const;
  const statusBadgeClassNameByKind = {
    upcoming: theme === "light" ? "bg-sky-100 text-sky-700" : "bg-sky-400/10 text-sky-200",
    live: theme === "light" ? "bg-emerald-100 text-emerald-700" : "bg-emerald-400/10 text-emerald-200",
    manual: theme === "light" ? "bg-amber-100 text-amber-700" : "bg-amber-400/10 text-amber-200",
    complete: theme === "light" ? "bg-slate-200 text-slate-600" : "bg-neutral-700/80 text-neutral-300",
  } as const;
  const statusLabel = statusLabelByKind[statusKind];
  const statusBadgeClassName = statusBadgeClassNameByKind[statusKind];
  const showTeamNotesFilter = !isGeneralView && teamLabels.length > 0;
  const showRoleNotesFilter = !isGeneralView && roleOptions.length > 0;
  const churchPrimaryColor = normalizePublicBrandHex(
    String(snapshot.churchPrimaryColor || ""),
  );
  const churchSecondaryColor = normalizePublicBrandHex(
    String(snapshot.churchSecondaryColor || ""),
  );
  // Shared neutral surfaces on both views. Brand color #2 tints section titles
  // on both views when set; simple view also uses it for the church name.
  // Brand color #1 accents item borders.
  const chrome = theme === "light"
    ? {
      page: "bg-slate-50 text-slate-900",
      headerCard: "border-slate-200 bg-white",
      headerRule: "border-slate-200",
      churchName: "text-slate-600",
      meta: "text-slate-500",
      sectionTitle: "text-slate-600",
      list: "border-slate-200 bg-white",
      itemBorder: "border-slate-200",
      time: "text-slate-600",
      duration: "text-slate-400",
      title: "text-slate-900",
      credit: "text-slate-500",
      creditName: "text-slate-700",
      past: "bg-slate-50 text-slate-500",
      reconnecting: "text-slate-500",
    }
    : isGeneralView
      ? {
        page: "bg-neutral-950 text-neutral-100",
        headerCard: "border-neutral-700/80 bg-neutral-900/95",
        headerRule: "border-neutral-700/80",
        churchName: "text-neutral-100",
        meta: "text-neutral-400",
        sectionTitle: "text-neutral-100",
        list: "border-neutral-700 bg-neutral-900",
        itemBorder: "border-neutral-700/80",
        time: "text-neutral-300",
        duration: "text-neutral-500",
        title: "text-neutral-100",
        credit: "text-neutral-400",
        creditName: "text-neutral-300",
        past: "bg-neutral-950/40 text-neutral-400",
        reconnecting: "text-neutral-400",
      }
      : {
        page: "bg-neutral-950 text-neutral-100",
        headerCard: "border-neutral-700/80 bg-neutral-900/95",
        headerRule: "border-neutral-700/80",
        churchName: "text-neutral-400",
        meta: "text-neutral-400",
        sectionTitle: "text-neutral-400",
        list: "border-neutral-700 bg-neutral-900",
        itemBorder: "border-neutral-700/80",
        time: "text-neutral-300",
        duration: "text-neutral-500",
        title: "text-neutral-100",
        credit: "text-neutral-400",
        creditName: "text-neutral-300",
        past: "bg-neutral-950/40 text-neutral-400",
        reconnecting: "text-neutral-400",
      };
  const churchNameBrandStyle = isGeneralView && churchSecondaryColor
    ? { color: churchSecondaryColor }
    : undefined;
  const sectionTitleBrandStyle = churchSecondaryColor
    ? { color: churchSecondaryColor }
    : undefined;
  const servingTeams = !isGeneralView ? snapshot.servingTeams || [] : [];
  const hasServingTeams = servingTeams.length > 0;

  const body = (
    <>
      <div className={cn(
        embedded ? "px-0 pb-4 pt-0" : "mx-auto px-3 pb-24 pt-4 sm:px-5 sm:pb-28 sm:pt-6",
        hasServingTeams ? "max-w-6xl" : "max-w-3xl",
      )}>
        <div className={cn(hasServingTeams && "lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-4")}>
          <div className="min-w-0">
            <header className={cn(
              embedded ? "pb-3" : cn(
                "-mx-3 border-b px-3 pb-3 pt-1 sm:-mx-5 sm:px-5",
                theme === "light" ? "border-slate-200" : "border-neutral-800/90",
              ),
            )}>
              <div className={cn("rounded-xl p-3 shadow-lg sm:p-4", chrome.headerCard)}>
                <div className="flex items-start gap-3">
                  <ChurchLogoImg
                    src={snapshot.churchLogoUrl || ""}
                    alt=""
                    variant="board-attendee"
                    className="!mt-0 !size-11 !rounded-md sm:!size-12"
                  />
                  <div className="min-w-0 flex-1">
                    {snapshot.churchName ? (
                      <p
                        className={cn("text-xs font-medium", chrome.churchName)}
                        style={churchNameBrandStyle}
                      >
                        {snapshot.churchName}
                      </p>
                    ) : null}
                    <h1 className="text-lg font-bold leading-snug tracking-tight sm:text-xl">{service.title}</h1>
                    <p className={cn("mt-0.5 text-xs sm:text-sm", chrome.meta)}>
                      {formatServiceDate(service.startsAt, service.timezone)} · starts {formatServiceTime(Date.parse(service.startsAt), service.timezone)}
                    </p>
                  </div>
                  <Button
                    variant="none"
                    svg={theme === "dark" ? Sun : Moon}
                    iconSize="sm"
                    className={cn(
                      "shrink-0 rounded-full border p-2",
                      theme === "light"
                        ? "border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        : "border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-white",
                    )}
                    aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                    onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
                  />
                </div>

                <div className={cn("mt-3 flex flex-wrap items-center gap-2 border-t pt-3", chrome.headerRule)}>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                      statusBadgeClassName,
                    )}
                  >
                    <Radio className="size-3.5" aria-hidden="true" /> {statusLabel}
                  </span>
                  {showTeamNotesFilter || showRoleNotesFilter ? (
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-none">
                      <span className={cn("shrink-0 text-xs font-medium", theme === "light" ? "text-slate-500" : "text-neutral-400")}>
                        Show notes for
                      </span>
                      {showTeamNotesFilter ? (
                        <Select
                          label="Team notes"
                          hideLabel
                          className="min-w-[9.5rem] max-w-[14rem] flex-1 sm:flex-none"
                          selectClassName="min-h-0 py-1 text-xs"
                          labelFontSize="text-xs"
                          value={selectedTeam || "__everyone__"}
                          onChange={handleTeamNotesFilterChange}
                          textColor={theme === "light" ? "text-slate-900" : undefined}
                          backgroundColor={theme === "light" ? "bg-slate-50" : undefined}
                          contentBackgroundColor={theme === "light" ? "bg-white" : undefined}
                          contentTextColor={theme === "light" ? "text-slate-900" : undefined}
                          options={[
                            { value: "__everyone__", label: "All teams" },
                            ...teamLabels.map((team) => ({ value: team, label: team })),
                          ]}
                        />
                      ) : null}
                      {showRoleNotesFilter ? (
                        <ServicePlanRolePicker
                          value={selectedRole}
                          onValueChange={setSelectedRole}
                          options={roleOptions}
                          teamFilterStorageKey="worshipsyncServicePublicRoleTeamFilter"
                          lockedTeamName={selectedTeam || undefined}
                          ariaLabel="Filter role notes"
                          label="Role notes"
                          className="min-w-[9.5rem] max-w-[14rem] flex-1 sm:flex-none"
                        />
                      ) : null}
                    </div>
                  ) : null}
                  {connection === "reconnecting" ? (
                    <span className={cn("text-xs", chrome.reconnecting)} aria-live="polite">
                      Updating…
                    </span>
                  ) : null}
                </div>

                {progress?.current ? (
                  <div className={cn("mt-2 rounded-lg border px-3 py-2", theme === "light" ? "border-emerald-200 bg-emerald-50" : "border-emerald-500/25 bg-emerald-500/5")} aria-label="Live service item">
                    <p className={cn("text-[11px] font-bold uppercase tracking-[0.14em]", theme === "light" ? "text-emerald-700" : "text-emerald-300/90")}>Now</p>
                    <p className={cn("text-sm font-semibold", theme === "light" ? "text-emerald-950" : "text-neutral-50")}>{progress.current.item.title}</p>
                    {progress.next ? (
                      <p className={cn("mt-0.5 text-xs", chrome.meta)}>
                        Up next: <span className={cn("font-medium", chrome.title)}>{progress.next.item.title}</span>
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </header>

            {error ? (
              <p className="mt-3 text-sm text-amber-200" role="status">
                Showing the latest available service. Updates will reconnect automatically.
                {onRefresh ? (
                  <>
                    {" "}
                    <Button
                      variant="tertiary"
                      svg={RefreshCw}
                      iconSize="xs"
                      className="inline h-auto min-h-0 px-0 py-0 text-amber-100"
                      onClick={() => onRefresh()}
                    >
                      Refresh
                    </Button>
                  </>
                ) : null}
              </p>
            ) : null}

            <div className="mt-4 space-y-4">
              {service.sections.map((section) => (
                <section
                  key={section.id}
                  aria-labelledby={section.title ? `service-section-${section.id}` : undefined}
                >
                  {section.title ? (
                    <h2
                      id={`service-section-${section.id}`}
                      className={cn(
                        "mb-1.5 px-1 text-[11px] font-bold uppercase tracking-[0.14em]",
                        chrome.sectionTitle,
                      )}
                      style={sectionTitleBrandStyle}
                    >
                      {section.title}
                    </h2>
                  ) : null}
                  <ol className={cn("overflow-hidden rounded-xl border shadow-lg", chrome.list)}>
                    {section.items.map((item) => {
                      const timed = progress?.items.find((candidate) => candidate.item.id === item.id);
                      const isCurrent = progress?.current?.item.id === item.id;
                      const isPast = Boolean(timed && clientNow + serverOffsetMs >= timed.endsAtMs && !isCurrent);
                      const visibleAudienceNotes = !isGeneralView
                        ? visibleAudienceNotesForItem(item, selectedTeam, selectedRole)
                        : [];
                      const visibleMicrophoneAssignments = !isGeneralView
                        ? visibleMicrophoneAssignmentsForItem(item, selectedTeam, selectedRole)
                        : [];
                      const hasNotes = !isGeneralView && itemHasNotes(item, selectedTeam, selectedRole);
                      const notesExpanded = hasNotes && !collapsedNoteIds.has(item.id);
                      const durationLabel = item.durationSeconds > 0
                        ? formatServicePlanDuration(item)
                        : "";
                      return (
                        <li
                          key={item.id}
                          id={servicePublicItemDomId(item.id)}
                          className={cn(
                            "scroll-mt-16 border-b border-l-2 px-3 py-2 last:border-b-0 sm:px-3.5 sm:py-2.5",
                            chrome.itemBorder,
                            !isCurrent && !churchPrimaryColor && "border-l-transparent",
                            isCurrent && (theme === "light" ? "border-l-emerald-600 bg-emerald-50 ring-1 ring-inset ring-emerald-200" : "border-l-emerald-400/80 bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/20"),
                            isPast && chrome.past,
                          )}
                          style={
                            !isCurrent && churchPrimaryColor
                              ? { borderLeftColor: churchPrimaryColor }
                              : undefined
                          }
                        >
                          <div className="flex items-baseline gap-2.5 sm:gap-3">
                            <div className="w-[4.75rem] shrink-0 sm:w-[5.25rem]">
                              <time
                                className={cn(
                                  "block text-xs font-medium tabular-nums sm:text-sm",
                                  isCurrent ? (theme === "light" ? "text-emerald-700" : "text-emerald-300") : chrome.time,
                                )}
                              >
                                {timed ? formatServiceTime(timed.startsAtMs, service.timezone) : ""}
                              </time>
                              {durationLabel ? (
                                <p className={cn("mt-0.5 text-[11px] tabular-nums", chrome.duration)}>
                                  {durationLabel}
                                </p>
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <h3
                                  className={cn(
                                    "text-sm font-semibold leading-snug sm:text-[15px]",
                                    chrome.title,
                                  )}
                                >
                                  {item.title}
                                </h3>
                                {isCurrent ? (
                                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", theme === "light" ? "bg-emerald-100 text-emerald-700" : "bg-emerald-400/15 text-emerald-200")}>
                                    Live
                                  </span>
                                ) : null}
                                {item.creditName ? (
                                  <p className={cn("ml-auto text-xs", chrome.credit)}>
                                    Led by{" "}
                                    <span className={cn("font-medium", chrome.creditName)}>
                                      {item.creditName}
                                    </span>
                                  </p>
                                ) : null}
                              </div>

                              {hasNotes ? (
                                <div className="mt-1">
                                  <Button
                                    variant="tertiary"
                                    svg={ChevronDown}
                                    iconSize="xs"
                                    className={cn(
                                      "h-auto min-h-0 px-0 py-0 text-xs",
                                      theme === "light" ? "text-slate-500 hover:text-slate-900" : "text-neutral-400 hover:text-neutral-200",
                                      notesExpanded && "[&_svg]:rotate-180",
                                    )}
                                    aria-expanded={notesExpanded}
                                    onClick={() => toggleNotes(item.id)}
                                  >
                                    {selectedTeam || selectedRole ? "Filtered notes" : "Notes"}
                                  </Button>
                                  {notesExpanded ? (
                                    <div className={cn("mt-1.5 space-y-2 border-l pl-2.5", theme === "light" ? "border-slate-300 text-slate-900" : "border-neutral-600/70 text-white")}>
                                      {item.notes.blocks.length ? (
                                        <div>
                                          {visibleAudienceNotes.length || selectedTeam || selectedRole ? (
                                            <p className={cn("mb-0.5 text-[10px] font-semibold uppercase tracking-wide", theme === "light" ? "text-slate-500" : "text-neutral-500")}>
                                              Shared notes
                                            </p>
                                          ) : null}
                                          <ServiceFlowRichText
                                            document={item.notes}
                                            className={theme === "light" ? "text-slate-900" : undefined}
                                          />
                                        </div>
                                      ) : null}
                                      {visibleAudienceNotes.map((teamNote) => (
                                        <div key={`${teamNote.scope || "team"}:${teamNote.positionId || teamNote.label}`}>
                                          <p className={cn("mb-0.5 text-[10px] font-bold uppercase tracking-wide", theme === "light" ? "text-slate-500" : "text-neutral-500")}>
                                            {teamNote.label}{teamNote.scope === "role" ? " role" : ""} notes
                                          </p>
                                          <ServiceFlowRichText
                                            document={teamNote.notes}
                                            className={theme === "light" ? "text-slate-900" : undefined}
                                          />
                                        </div>
                                      ))}
                                      {visibleMicrophoneAssignments.length ? (
                                        <div>
                                          <p className={cn("mb-1 text-[10px] font-bold uppercase tracking-wide", theme === "light" ? "text-slate-500" : "text-neutral-500")}>
                                            Microphones
                                          </p>
                                          <div className="flex flex-wrap gap-1.5">
                                            {visibleMicrophoneAssignments.map((assignment) => (
                                              <ServicePlanMicrophoneChip
                                                key={assignment.microphone.id}
                                                microphone={assignment.microphone}
                                                className="gap-1.5 rounded-full px-2 py-1 text-xs font-medium"
                                                iconClassName="size-4"
                                                details={[
                                                  assignment.holderName || "",
                                                ]}
                                                theme={theme}
                                              />
                                            ))}
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
            </div>
          </div>
          {hasServingTeams ? (
            <div className="mt-4 self-start lg:sticky lg:top-4 lg:mt-0">
              <PublicServingTeamsPanel
                teams={servingTeams}
                secondaryColor={churchSecondaryColor}
                theme={theme}
              />
            </div>
          ) : null}
        </div>
      </div>

      {!embedded && currentItemId && !isFollowingLive ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center px-3 sm:bottom-6">
          <Button
            variant="cta"
            svg={LocateFixed}
            className="pointer-events-auto shadow-xl"
            onClick={jumpToCurrent}
          >
            Follow live
          </Button>
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <div
        className={cn(chrome.page, "rounded-xl")}
        onScroll={handlePageScroll}
        onWheel={pauseLiveFollow}
        onTouchMove={pauseLiveFollow}
        onPointerDown={notePointerScrollIntent}
        onKeyDown={handlePageKeyDown}
      >
        {body}
      </div>
    );
  }

  return (
    <main
      className={cn(publicPageScrollClassName, chrome.page)}
      onScroll={handlePageScroll}
      onWheel={pauseLiveFollow}
      onTouchMove={pauseLiveFollow}
      onPointerDown={notePointerScrollIntent}
      onKeyDown={handlePageKeyDown}
    >
      {body}
    </main>
  );
};

export default ServicePublicView;
