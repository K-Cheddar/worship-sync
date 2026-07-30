import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Radio, RefreshCw } from "lucide-react";
import { useParams } from "react-router-dom";
import Button from "../components/Button/Button";
import { ChurchLogoImg } from "../components/ChurchLogoImg";
import Spinner from "../components/Spinner/Spinner";
import Select from "../components/Select/Select";
import ServiceFlowRichText from "../components/ServiceFlowRichText/ServiceFlowRichText";
import { getServiceFlowProgress } from "../services/serviceFlowProgress";
import type { PublicServiceFlowItem } from "../services/serviceFlowTypes";
import { usePublicServiceFlow } from "../services/usePublicServiceFlow";
import { cn } from "../utils/cnHelper";
import { formatServicePlanDuration } from "./Services/servicePlanDuration";
import {
  readServicePublicNotesTeam,
  writeServicePublicNotesTeam,
} from "./servicePublicNotesTeam";
import { publicPageScrollClassName } from "./Teams/teamsStyles";

const formatServiceDate = (value: string, timezone: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: timezone,
  }).format(new Date(value));

const formatServiceTime = (value: number, timezone: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric", minute: "2-digit", timeZone: timezone,
  }).format(new Date(value));

const itemHasNotes = (item: PublicServiceFlowItem, selectedTeam: string) => {
  if (item.notes.blocks.length) return true;
  if (selectedTeam) {
    return Boolean(item.teamNotes?.some((note) => note.label === selectedTeam));
  }
  return Boolean(item.teamNotes?.length);
};

const visibleTeamNotesForItem = (
  item: PublicServiceFlowItem,
  selectedTeam: string,
) => {
  const teamNotes = item.teamNotes || [];
  if (!selectedTeam) return teamNotes;
  return teamNotes.filter((note) => note.label === selectedTeam);
};

const pageShellClassName = cn(publicPageScrollClassName, "bg-neutral-950 text-neutral-100");

const ServicePublic = () => {
  const { shareId = "" } = useParams();
  const { snapshot, error, loading, connection, revoked, refresh } = usePublicServiceFlow(shareId);
  const [clientNow, setClientNow] = useState(() => Date.now());
  const [selectedTeam, setSelectedTeam] = useState(() => readServicePublicNotesTeam());
  const [collapsedNoteIds, setCollapsedNoteIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const interval = window.setInterval(() => setClientNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const serverOffsetMs = useMemo(() => (snapshot ? snapshot.serverNowMs - Date.now() : 0), [snapshot]);
  const progress = useMemo(
    () => snapshot ? getServiceFlowProgress(snapshot.service, clientNow + serverOffsetMs) : null,
    [clientNow, serverOffsetMs, snapshot],
  );

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
        section.items.flatMap((item) => (item.teamNotes || []).map((teamNote) => teamNote.label)),
      ),
    )).sort((left, right) => left.localeCompare(right));
  }, [snapshot]);

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

  const handleTeamNotesFilterChange = (value: string) => {
    const next = value === "__everyone__" ? "" : value;
    setSelectedTeam(next);
    writeServicePublicNotesTeam(next);
  };

  const jumpToCurrent = () => {
    if (!progress?.current) return;
    document.getElementById(`service-item-${progress.current.item.id}`)?.scrollIntoView({
      behavior: "smooth", block: "center",
    });
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

  return (
    <main className={pageShellClassName}>
      <div className="mx-auto max-w-3xl px-3 pb-10 pt-4 sm:px-5 sm:pb-12 sm:pt-6">
        <header className="-mx-3 border-b border-neutral-800/90 px-3 pb-3 pt-1 sm:-mx-5 sm:px-5">
          <div className="rounded-xl border border-neutral-700/80 bg-neutral-900/95 p-3 shadow-lg sm:p-4">
            <div className="flex items-start gap-3">
              <ChurchLogoImg
                src={snapshot.churchLogoUrl || ""}
                alt=""
                variant="board-attendee"
                className="!mt-0 !size-11 !rounded-md sm:!size-12"
              />
              <div className="min-w-0 flex-1">
                {snapshot.churchName ? <p className="text-xs font-medium text-neutral-400">{snapshot.churchName}</p> : null}
                <h1 className="text-lg font-bold leading-snug tracking-tight sm:text-xl">{service.title}</h1>
                <p className="mt-0.5 text-xs text-neutral-400 sm:text-sm">
                  {formatServiceDate(service.startsAt, service.timezone)} · starts {formatServiceTime(Date.parse(service.startsAt), service.timezone)}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-700/80 pt-3">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  statusBadgeClassName,
                )}
              >
                <Radio className="size-3.5" aria-hidden="true" /> {statusLabel}
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
              {connection === "reconnecting" ? <span className="text-xs text-neutral-400" aria-live="polite">Updating…</span> : null}
              {progress?.current ? (
                <Button variant="tertiary" svg={ChevronDown} className="ml-auto text-xs" onClick={jumpToCurrent}>
                  Jump to current
                </Button>
              ) : null}
            </div>

            {progress?.current ? (
              <div className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2" aria-label="Current service item">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-300/90">Now</p>
                <p className="text-sm font-semibold text-neutral-50">{progress.current.item.title}</p>
                {progress.next ? (
                  <p className="mt-0.5 text-xs text-neutral-300">
                    Up next: <span className="font-medium text-neutral-100">{progress.next.item.title}</span>
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
            <section key={section.id} aria-labelledby={`service-section-${section.id}`}>
              {section.title ? (
                <h2
                  id={`service-section-${section.id}`}
                  className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400"
                >
                  {section.title}
                </h2>
              ) : null}
              <ol className="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-lg">
                {section.items.map((item) => {
                  const timed = progress?.items.find((candidate) => candidate.item.id === item.id);
                  const isCurrent = progress?.current?.item.id === item.id;
                  const isPast = Boolean(timed && clientNow + serverOffsetMs >= timed.endsAtMs && !isCurrent);
                  const visibleTeamNotes = !isGeneralView
                    ? visibleTeamNotesForItem(item, selectedTeam)
                    : [];
                  const hasNotes = !isGeneralView && itemHasNotes(item, selectedTeam);
                  const notesExpanded = hasNotes && !collapsedNoteIds.has(item.id);
                  const durationLabel = item.durationSeconds > 0
                    ? formatServicePlanDuration(item)
                    : "";
                  return (
                    <li
                      key={item.id}
                      id={`service-item-${item.id}`}
                      className={cn(
                        "border-b border-l-2 border-l-transparent border-neutral-700/80 px-3 py-2 last:border-b-0 sm:px-3.5 sm:py-2.5",
                        isCurrent && "border-l-emerald-400/80 bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/20",
                        isPast && "bg-neutral-950/40 text-neutral-400",
                      )}
                    >
                      <div className="flex items-baseline gap-2.5 sm:gap-3">
                        <div className="w-[4.75rem] shrink-0 sm:w-[5.25rem]">
                          <time
                            className={cn(
                              "block text-xs font-medium tabular-nums sm:text-sm",
                              isCurrent ? "text-emerald-300" : "text-neutral-300",
                            )}
                          >
                            {timed ? formatServiceTime(timed.startsAtMs, service.timezone) : ""}
                          </time>
                          {durationLabel ? (
                            <p className="mt-0.5 text-[11px] tabular-nums text-neutral-500">{durationLabel}</p>
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <h3 className="text-sm font-semibold leading-snug text-neutral-100 sm:text-[15px]">
                              {item.title}
                            </h3>
                            {isCurrent ? (
                              <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                                Current
                              </span>
                            ) : null}
                            {item.creditName ? (
                              <p className="ml-auto text-xs text-neutral-400">
                                Led by <span className="font-medium text-neutral-300">{item.creditName}</span>
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
                                {selectedTeam ? `${selectedTeam} notes` : "Notes"}
                              </Button>
                              {notesExpanded ? (
                                <div className="mt-1.5 space-y-2 border-l border-neutral-600/70 pl-2.5 text-white">
                                  {item.notes.blocks.length ? (
                                    <div>
                                      {visibleTeamNotes.length || selectedTeam ? (
                                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                                          Shared notes
                                        </p>
                                      ) : null}
                                      <ServiceFlowRichText document={item.notes} />
                                    </div>
                                  ) : null}
                                  {visibleTeamNotes.map((teamNote) => (
                                    <div key={teamNote.label}>
                                      <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
                                        {teamNote.label} notes
                                      </p>
                                      <ServiceFlowRichText document={teamNote.notes} />
                                    </div>
                                  ))}
                                  {selectedTeam && visibleTeamNotes.length === 0 ? (
                                    <p className="text-xs text-neutral-500">
                                      No {selectedTeam} notes for this item.
                                    </p>
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
    </main>
  );
};

export default ServicePublic;
