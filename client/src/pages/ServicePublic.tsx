import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LocateFixed, Radio, RefreshCw } from "lucide-react";
import { useParams } from "react-router-dom";
import Button from "../components/Button/Button";
import { ChurchLogoImg } from "../components/ChurchLogoImg";
import Spinner from "../components/Spinner/Spinner";
import Select from "../components/Select/Select";
import ServicePlanRolePicker from "../components/ServicePlanRolePicker";
import ServiceFlowRichText from "../components/ServiceFlowRichText/ServiceFlowRichText";
import { getServiceFlowProgress } from "../services/serviceFlowProgress";
import type { PublicServiceFlowItem } from "../services/serviceFlowTypes";
import { usePublicServiceFlow } from "../services/usePublicServiceFlow";
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

/** Ignore scroll events from our own smooth scroll so they do not pause follow. */
const PROGRAMMATIC_SCROLL_SUPPRESS_MS = 1000;

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

const pageShellClassName = cn(publicPageScrollClassName, "bg-neutral-950 text-neutral-100");

const ServicePublic = () => {
  const { shareId = "" } = useParams();
  const { snapshot, error, loading, connection, revoked, refresh } = usePublicServiceFlow(shareId);
  const [clientNow, setClientNow] = useState(() => Date.now());
  const [selectedTeam, setSelectedTeam] = useState(() => readServicePublicNotesTeam());
  const [selectedRole, setSelectedRole] = useState("");
  const [collapsedNoteIds, setCollapsedNoteIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isFollowingLive, setIsFollowingLive] = useState(true);
  const followedLiveItemIdRef = useRef<string | null>(null);
  const suppressFollowPauseUntilRef = useRef(0);

  useEffect(() => {
    const interval = window.setInterval(() => setClientNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const serverOffsetMs = useMemo(() => (snapshot ? snapshot.serverNowMs - Date.now() : 0), [snapshot]);
  const progress = useMemo(
    () => snapshot ? getServiceFlowProgress(snapshot.service, clientNow + serverOffsetMs) : null,
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
    if (Date.now() < suppressFollowPauseUntilRef.current) return;
    pauseLiveFollow();
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
    if (!snapshot || snapshot.service.viewMode === "general") return [];
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
    if (!snapshot || snapshot.service.viewMode === "general") return [];
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

  if (loading && !snapshot) {
    return (
      <main className={cn(pageShellClassName, "flex items-center justify-center p-6")}>
        <div className="flex items-center gap-3" aria-live="polite">
          <Spinner width="24px" borderWidth="3px" /> Loading service…
        </div>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className={cn(pageShellClassName, "flex items-center justify-center p-6")}>
        <div className="max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-6 text-center shadow-xl">
          <h1 className="text-xl font-semibold">
            {revoked ? "This service is no longer shared" : "Service unavailable"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-300">
            {revoked
              ? "The link has been turned off or the service was removed. Ask your team for a new link."
              : error || "This service is not available."}
          </p>
          <Button variant="cta" svg={RefreshCw} className="mt-5" onClick={() => void refresh(true)}>Try again</Button>
        </div>
      </main>
    );
  }

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
    upcoming: "bg-sky-400/10 text-sky-200",
    live: "bg-emerald-400/10 text-emerald-200",
    manual: "bg-amber-400/10 text-amber-200",
    complete: "bg-neutral-700/80 text-neutral-300",
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
  const chrome = isGeneralView
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

  return (
    <main
      className={cn(publicPageScrollClassName, chrome.page)}
      onScroll={handlePageScroll}
      onWheel={pauseLiveFollow}
      onTouchMove={pauseLiveFollow}
    >
      <div className="mx-auto max-w-3xl px-3 pb-24 pt-4 sm:px-5 sm:pb-28 sm:pt-6">
        <header className="-mx-3 border-b border-neutral-800/90 px-3 pb-3 pt-1 sm:-mx-5 sm:px-5">
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
                  <span className="shrink-0 text-xs font-medium text-neutral-400">
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
              <div className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2" aria-label="Current service item">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-300/90">Now</p>
                <p className="text-sm font-semibold text-neutral-50">{progress.current.item.title}</p>
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
                        "scroll-mt-3 border-b border-l-2 px-3 py-2 last:border-b-0 sm:px-3.5 sm:py-2.5",
                        chrome.itemBorder,
                        !isCurrent && !churchPrimaryColor && "border-l-transparent",
                        isCurrent && "border-l-emerald-400/80 bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/20",
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
                              isCurrent ? "text-emerald-300" : chrome.time,
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
                              <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                                Current
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
                                  "h-auto min-h-0 px-0 py-0 text-xs text-neutral-400 hover:text-neutral-200",
                                  notesExpanded && "[&_svg]:rotate-180",
                                )}
                                aria-expanded={notesExpanded}
                                onClick={() => toggleNotes(item.id)}
                              >
                                {selectedTeam || selectedRole ? "Filtered notes" : "Notes"}
                              </Button>
                              {notesExpanded ? (
                                <div className="mt-1.5 space-y-2 border-l border-neutral-600/70 pl-2.5 text-white">
                                  {item.notes.blocks.length ? (
                                    <div>
                                      {visibleAudienceNotes.length || selectedTeam || selectedRole ? (
                                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                                          Shared notes
                                        </p>
                                      ) : null}
                                      <ServiceFlowRichText document={item.notes} />
                                    </div>
                                  ) : null}
                                  {visibleAudienceNotes.map((teamNote) => (
                                    <div key={`${teamNote.scope || "team"}:${teamNote.positionId || teamNote.label}`}>
                                      <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
                                        {teamNote.label}{teamNote.scope === "role" ? " role" : ""} notes
                                      </p>
                                      <ServiceFlowRichText document={teamNote.notes} />
                                    </div>
                                  ))}
                                  {visibleMicrophoneAssignments.length ? (
                                    <div>
                                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
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
                                              assignment.microphone.type,
                                              assignment.holderName || "",
                                            ]}
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

      {currentItemId ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center px-3 sm:bottom-6">
          <Button
            variant="cta"
            svg={LocateFixed}
            className="pointer-events-auto shadow-xl"
            onClick={jumpToCurrent}
          >
            Go to current
          </Button>
        </div>
      ) : null}
    </main>
  );
};

export default ServicePublic;
