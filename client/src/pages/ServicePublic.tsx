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
  if (!selectedTeam) return false;
  return Boolean(item.teamNotes?.some((note) => note.label === selectedTeam));
};

const ServicePublic = () => {
  const { shareId = "" } = useParams();
  const { snapshot, error, loading, connection, revoked, refresh } = usePublicServiceFlow(shareId);
  const [clientNow, setClientNow] = useState(() => Date.now());
  const [selectedTeam, setSelectedTeam] = useState("");
  const [expandedNoteIds, setExpandedNoteIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const interval = window.setInterval(() => setClientNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const serverOffsetMs = useMemo(() => (snapshot ? snapshot.serverNowMs - Date.now() : 0), [snapshot]);
  const progress = useMemo(
    () => snapshot ? getServiceFlowProgress(snapshot.service, clientNow + serverOffsetMs) : null,
    [clientNow, serverOffsetMs, snapshot],
  );
  const currentItemId = progress?.current?.item.id;

  useEffect(() => {
    if (!currentItemId) return;
    setExpandedNoteIds((prev) => {
      if (prev.has(currentItemId)) return prev;
      const next = new Set(prev);
      next.add(currentItemId);
      return next;
    });
  }, [currentItemId]);

  const toggleNotes = (itemId: string) => {
    setExpandedNoteIds((prev) => {
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
    if (selectedTeam && !teamLabels.includes(selectedTeam)) setSelectedTeam("");
  }, [selectedTeam, teamLabels]);

  const jumpToCurrent = () => {
    if (!progress?.current) return;
    document.getElementById(`service-item-${progress.current.item.id}`)?.scrollIntoView({
      behavior: "smooth", block: "center",
    });
  };

  if (loading && !snapshot) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100"><div className="flex items-center gap-3" aria-live="polite"><Spinner width="24px" borderWidth="3px" /> Loading service…</div></main>;
  }

  if (!snapshot) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-xl">
          <h1 className="text-xl font-semibold">
            {revoked ? "This service is no longer shared" : "Service unavailable"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
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
  const statusLabel = progress?.isManual ? "Live update" : progress?.state === "complete" ? "Service complete" : progress?.state === "upcoming" ? "Starts soon" : "Live now";

  return (
    <main className="min-h-screen overflow-y-auto bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-3 pb-10 pt-4 sm:px-5 sm:pb-12 sm:pt-6">
        <header className="sticky top-0 z-20 -mx-3 border-b border-slate-800/90 bg-slate-950/95 px-3 pb-3 pt-1 backdrop-blur-sm sm:-mx-5 sm:px-5">
          <div className="rounded-xl border border-slate-700/80 bg-slate-900/95 p-3 shadow-lg sm:p-4">
            <div className="flex items-start gap-3">
              <ChurchLogoImg
                src={snapshot.churchLogoUrl || ""}
                alt=""
                variant="board-attendee"
                className="!mt-0 !size-11 !rounded-md sm:!size-12"
              />
              <div className="min-w-0 flex-1">
                {snapshot.churchName ? <p className="text-xs font-medium text-cyan-300">{snapshot.churchName}</p> : null}
                <h1 className="text-lg font-bold leading-snug tracking-tight sm:text-xl">{service.title}</h1>
                <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">
                  {formatServiceDate(service.startsAt, service.timezone)} · starts {formatServiceTime(Date.parse(service.startsAt), service.timezone)}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-700/80 pt-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-400/10 px-2.5 py-1 text-xs font-medium text-cyan-200">
                <Radio className="size-3.5" aria-hidden="true" /> {statusLabel}
              </span>
              {connection === "reconnecting" ? <span className="text-xs text-slate-400" aria-live="polite">Updating…</span> : null}
              {progress?.current ? (
                <Button variant="tertiary" svg={ChevronDown} className="ml-auto text-xs" onClick={jumpToCurrent}>
                  Jump to current
                </Button>
              ) : null}
            </div>

            {progress?.current ? (
              <div className="mt-2 rounded-lg border border-cyan-400/35 bg-cyan-400/10 px-3 py-2" aria-label="Current service item">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-200">Now</p>
                <p className="text-sm font-semibold text-slate-50">{progress.current.item.title}</p>
                {progress.next ? (
                  <p className="mt-0.5 text-xs text-slate-300">
                    Up next: <span className="font-medium text-slate-100">{progress.next.item.title}</span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        {!isGeneralView && teamLabels.length ? (
          <div className="mt-3 max-w-xs">
            <Select
              label="View notes for"
              value={selectedTeam || "__everyone__"}
              onChange={(value) => setSelectedTeam(value === "__everyone__" ? "" : value)}
              options={[
                { value: "__everyone__", label: "Everyone" },
                ...teamLabels.map((team) => ({ value: team, label: team })),
              ]}
            />
          </div>
        ) : null}

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
                  className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400"
                >
                  {section.title}
                </h2>
              ) : null}
              <ol className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-lg">
                {section.items.map((item) => {
                  const timed = progress?.items.find((candidate) => candidate.item.id === item.id);
                  const isCurrent = progress?.current?.item.id === item.id;
                  const isPast = Boolean(timed && clientNow + serverOffsetMs >= timed.endsAtMs && !isCurrent);
                  const teamNote = selectedTeam
                    ? item.teamNotes?.find((note) => note.label === selectedTeam)
                    : null;
                  const hasNotes = !isGeneralView && itemHasNotes(item, selectedTeam);
                  const notesExpanded = expandedNoteIds.has(item.id);
                  return (
                    <li
                      key={item.id}
                      id={`service-item-${item.id}`}
                      className={cn(
                        "border-b border-slate-700/80 px-3 py-2 last:border-b-0 sm:px-3.5 sm:py-2.5",
                        isCurrent && "bg-cyan-400/10 ring-1 ring-inset ring-cyan-400/45",
                        isPast && "bg-slate-950/35 text-slate-400",
                      )}
                    >
                      <div className="flex items-baseline gap-2.5 sm:gap-3">
                        <time className="w-[4.75rem] shrink-0 text-xs font-medium tabular-nums text-slate-400 sm:w-[5.25rem] sm:text-sm">
                          {timed ? formatServiceTime(timed.startsAtMs, service.timezone) : ""}
                        </time>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <h3 className="text-sm font-semibold leading-snug text-slate-100 sm:text-[15px]">
                              {item.title}
                            </h3>
                            {isCurrent ? (
                              <span className="rounded bg-cyan-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                                Current
                              </span>
                            ) : null}
                          </div>

                          {isGeneralView && item.creditName ? (
                            <p className="mt-0.5 text-xs text-slate-400">
                              Led by <span className="font-medium text-slate-300">{item.creditName}</span>
                            </p>
                          ) : null}

                          {hasNotes ? (
                            <div className="mt-1">
                              <Button
                                variant="tertiary"
                                svg={ChevronDown}
                                iconSize="xs"
                                className={cn(
                                  "h-auto min-h-0 px-0 py-0 text-xs text-slate-400 hover:text-slate-200",
                                  notesExpanded && "[&_svg]:rotate-180",
                                )}
                                aria-expanded={notesExpanded}
                                onClick={() => toggleNotes(item.id)}
                              >
                                {selectedTeam ? `${selectedTeam} notes` : "Notes"}
                              </Button>
                              {notesExpanded ? (
                                <div className="mt-1.5 space-y-2 border-l border-slate-600/70 pl-2.5">
                                  {item.notes.blocks.length ? (
                                    <div>
                                      {selectedTeam ? (
                                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                          Shared notes
                                        </p>
                                      ) : null}
                                      <ServiceFlowRichText document={item.notes} />
                                    </div>
                                  ) : null}
                                  {selectedTeam && teamNote ? (
                                    <div>
                                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200">
                                        {selectedTeam} notes
                                      </p>
                                      <ServiceFlowRichText document={teamNote.notes} />
                                    </div>
                                  ) : null}
                                  {selectedTeam && !teamNote ? (
                                    <p className="text-xs text-slate-500">No {selectedTeam} notes for this item.</p>
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
