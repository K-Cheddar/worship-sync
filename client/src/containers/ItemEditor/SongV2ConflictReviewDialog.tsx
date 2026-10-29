import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../../components/Button/Button";
import Modal from "../../components/Modal/Modal";
import { formatSong } from "../../utils/overflow";
import {
  buildSongV2RevisionSelection,
  loadSongV2ConflictComparisonDocuments,
  loadSongV2ConflictRevisionOptions,
  resolveSongV2ConflictReview,
  SongV2ConflictReviewStaleError,
  type SongV2ConflictComparisonDocuments,
  type SongV2ConflictRevisionOptions,
} from "../../utils/songV2ReplicationConflicts";
import {
  buildSongV2ConflictDiffModel,
  buildSongV2SongDiffModel,
  type SongV2ConflictComparisonContext,
  type SongV2ConflictDiffModel,
  type SongV2DiffExcerptLine,
  type SongV2RevisionDocument,
} from "../../utils/buildSongV2ConflictDiffModel";
import { loadSongV2Snapshot, type SongV2Snapshot } from "../../utils/songPersistence";
import type { Arrangment, DBItem, ItemState } from "../../types";

type ManualLyrics = Record<string, Record<string, string>>;
type ConflictReviewState = {
  snapshot: SongV2Snapshot;
  versions: SongV2ConflictRevisionOptions[];
  comparisonDocuments: SongV2ConflictComparisonDocuments;
  choices: Record<string, string>;
  song: DBItem;
  sourceRevisions: Record<string, string>;
};

type SongV2ConflictReviewDialogProps = {
  db: PouchDB.Database;
  songId: string;
  snapshot?: SongV2Snapshot | null;
  isOpen: boolean;
  onClose: () => void;
  onResolved: (song: DBItem) => void;
  onConflictChanged: (snapshot: SongV2Snapshot) => void;
};

const versionLabel = (doc: SongV2RevisionDocument) => {
  if (doc.docType === "song-v2-root") return "Song details and arrangement list";
  if (doc.docType === "song-v2-arrangement") return `Arrangement: ${doc.name}`;
  return `Slide: ${doc.name}`;
};

const slideKey = (arrangementId: string, slideId: string) => `${arrangementId}:${slideId}`;

const sideForRoot = (
  root: NonNullable<SongV2Snapshot["root"]>,
  documents: SongV2ConflictComparisonDocuments,
  arrangementOverride?: SongV2RevisionDocument,
  slideOverride?: SongV2RevisionDocument,
) => {
  const arrangementsById = new Map(documents.arrangements.map(item => [item.arrangementId, item]));
  if (arrangementOverride?.docType === "song-v2-arrangement") {
    arrangementsById.set(arrangementOverride.arrangementId, arrangementOverride);
  }
  const arrangements = root.arrangementIds.flatMap(id => {
    const arrangement = arrangementsById.get(id);
    return arrangement ? [arrangement] : [];
  });
  const slidesById = new Map(documents.slides.map(item => [slideKey(item.arrangementId, item.id), item]));
  if (slideOverride?.docType === "song-v2-slide") {
    slidesById.set(slideKey(slideOverride.arrangementId, slideOverride.id), slideOverride);
  }
  const slides = arrangements.flatMap(arrangement => arrangement.slideIds.flatMap(id => {
    const slide = slidesById.get(slideKey(arrangement.arrangementId, id));
    return slide ? [slide] : [];
  }));
  const missingArrangementIds = root.arrangementIds.filter(id => !arrangementsById.has(id));
  const missingSlideIds = arrangements.flatMap(arrangement => arrangement.slideIds
    .filter(id => !slidesById.has(slideKey(arrangement.arrangementId, id)))
    .map(id => slideKey(arrangement.arrangementId, id)));
  return { arrangements, slides, missingArrangementIds, missingSlideIds };
};

const comparisonContextFor = (
  snapshot: SongV2Snapshot,
  documents: SongV2ConflictComparisonDocuments,
  option: SongV2RevisionDocument,
): SongV2ConflictComparisonContext => {
  const root = option.docType === "song-v2-root" ? option : snapshot.root;
  const current = {
    arrangements: snapshot.arrangements,
    slides: snapshot.slides,
    missingArrangementIds: [],
    missingSlideIds: [],
  };
  const alternative = sideForRoot(
    root,
    documents,
    option.docType === "song-v2-arrangement" ? option : undefined,
    option.docType === "song-v2-slide" ? option : undefined,
  );
  return { current, alternative };
};

const readConflictReview = async (
  db: PouchDB.Database,
  songId: string,
  snapshot?: SongV2Snapshot | null,
): Promise<ConflictReviewState> => {
  const reviewed = snapshot ?? await loadSongV2Snapshot(db, songId, true);
  const versions = await loadSongV2ConflictRevisionOptions(db, reviewed);
  const choices = Object.fromEntries(versions.map(({ conflict }) => [
    conflict.documentId, conflict.winningRevision,
  ]));
  const [comparisonDocuments, selection] = await Promise.all([
    loadSongV2ConflictComparisonDocuments(db, reviewed, versions),
    buildSongV2RevisionSelection(db, reviewed, versions, choices),
  ]);
  return {
    snapshot: reviewed,
    versions,
    comparisonDocuments,
    choices,
    song: selection.song,
    sourceRevisions: selection.sourceRevisions,
  };
};

const applyManualLyrics = (song: DBItem, manual: ManualLyrics): DBItem => {
  let next = JSON.parse(JSON.stringify(song)) as DBItem;
  for (const [index, arrangement] of next.arrangements.entries()) {
    const manualArrangement = manual[arrangement.id];
    if (!manualArrangement) continue;
    const formattedLyrics = arrangement.formattedLyrics.map(lyric => ({
      ...lyric,
      words: manualArrangement[lyric.id] ?? lyric.words,
    }));
    if (formattedLyrics.every((lyric, lyricIndex) =>
      lyric.words === arrangement.formattedLyrics[lyricIndex].words,
    )) continue;
    const formatted = formatSong({
      ...next,
      selectedArrangement: index,
      selectedSlide: 1,
      selectedBox: 1,
      arrangements: next.arrangements.map((candidate, candidateIndex) =>
        candidateIndex === index ? { ...candidate, formattedLyrics } : candidate,
      ),
    } as ItemState) as DBItem;
    next = {
      ...next,
      arrangements: next.arrangements.map((candidate, candidateIndex) =>
        candidateIndex === index ? formatted.arrangements[index] : candidate,
      ),
    };
  }
  return next;
};

/** Applies the pending text to canonical lyrics without generating slide pages. */
const applyManualTextDraft = (song: DBItem, manual: ManualLyrics): DBItem => ({
  ...song,
  arrangements: song.arrangements.map(arrangement => ({
    ...arrangement,
    formattedLyrics: arrangement.formattedLyrics.map(lyric => ({
      ...lyric,
      words: manual[arrangement.id]?.[lyric.id] ?? lyric.words,
    })),
  })),
});

const changedManualEntries = (song: DBItem | null, manual: ManualLyrics) => {
  if (!song) return [];
  const arrangements = new Map(song.arrangements.map(arrangement => [arrangement.id, arrangement]));
  return Object.entries(manual).flatMap(([arrangementId, lyrics]) => {
    const arrangement = arrangements.get(arrangementId);
    return Object.entries(lyrics).flatMap(([lyricId, words]) => {
      const lyric = arrangement?.formattedLyrics.find(item => item.id === lyricId);
      return lyric && lyric.words !== words ? [{ arrangementId, lyricId, name: lyric.name }] : [];
    });
  });
};

const missingManualEntries = (song: DBItem | null, manual: ManualLyrics) => {
  if (!song) return [];
  const arrangements = new Map(song.arrangements.map(arrangement => [arrangement.id, arrangement]));
  return Object.entries(manual).flatMap(([arrangementId, lyrics]) => Object.keys(lyrics).flatMap(lyricId => {
    const arrangement = arrangements.get(arrangementId);
    if (arrangement?.formattedLyrics.some(item => item.id === lyricId)) return [];
    return [{ arrangementId, lyricId }];
  }));
};

const renderTextSide = (lines: SongV2DiffExcerptLine[]) => lines.map((line, index) => {
  if (!("segments" in line)) {
    return <span key={`ellipsis-${index}`} aria-label="Unchanged lines omitted">…</span>;
  }
  return line.segments.map((segment, segmentIndex) => {
    const key = `${index}-${segmentIndex}`;
    if (segment.kind === "removed") return <del key={key} aria-label={`Removed: ${segment.text}`}>{segment.text}</del>;
    if (segment.kind === "added") return <ins key={key} aria-label={`Added: ${segment.text}`}>{segment.text}</ins>;
    return <span key={key}>{segment.text}</span>;
  });
});

const DiffSections = ({ model }: { model: SongV2ConflictDiffModel }) => {
  const visibleSections = model.sections;
  if (!visibleSections.length) return null;
  return (
    <div className="space-y-3">
      {visibleSections.map(section => (
        <section key={`${section.id}:${section.name}:${section.status}`} className="rounded-md bg-gray-950/60 p-3">
          <h5 className="text-sm font-semibold text-gray-100">{section.name}</h5>
          <div className="mt-2 space-y-2 text-xs">
            {section.current.hasText ? (
              <div>
                <p className="mb-1 text-gray-400">Currently saved</p>
                <pre className="whitespace-pre-wrap break-words font-sans text-gray-200">{renderTextSide(section.current.excerpt)}</pre>
              </div>
            ) : null}
            {section.alternative.hasText ? (
              <div>
                <p className="mb-1 text-gray-400">This version</p>
                <pre className="whitespace-pre-wrap break-words font-sans text-gray-200">{renderTextSide(section.alternative.excerpt)}</pre>
              </div>
            ) : section.status === "removed" ? (
              <p className="text-gray-400">No lyrics in this version.</p>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
};

const orderedNames = (names: string[]) => {
  const totals = new Map<string, number>();
  names.forEach(name => totals.set(name, (totals.get(name) ?? 0) + 1));
  return names.map((name, index) => totals.get(name)! > 1 ? `${name} (position ${index + 1})` : name);
};

const outcomeLines = (model: SongV2ConflictDiffModel, hasManualEdits: boolean) => {
  if (model.identicalContent && !hasManualEdits) return ["Keep the currently saved song content. No authored content changes were found."];
  const lines: string[] = [];
  const displayedLyricsMissing = model.changes.some(item => item.summary.includes("its lyrics are not present"));
  const uncertainSlideContent = model.changes.some(item => item.summary.includes("Could not verify"));
  if (model.lyricsIdentical) {
    lines.push("Keep the currently saved lyrics.");
  } else {
    for (const section of model.sections) {
      if (section.status === "changed") lines.push(`Use the changed lyrics in ${section.name}.`);
      else if (section.status === "added") lines.push(`Add lyrics in ${section.name}.`);
      else lines.push(`Remove lyrics from ${section.name}.`);
    }
  }
  if (displayedLyricsMissing) lines.push("Lyrics from a removed slide are missing in the selected version.");
  if (uncertainSlideContent) lines.push("Some removed slide content could not be verified; treat its absence as uncertain.");
  if (!model.lyricsIdentical && !model.sections.length && !displayedLyricsMissing && !uncertainSlideContent) {
    lines.push("The selected arrangements contain different lyrics; review the selected lyric changes below.");
  }
  lines.push(...model.changes.map(item => item.summary));
  if (hasManualEdits) lines.push("Apply your edited lyrics to the selected version before saving.");
  return [...new Set(lines)];
};

const SongV2ConflictReviewDialog = ({
  db,
  songId,
  snapshot,
  isOpen,
  onClose,
  onResolved,
  onConflictChanged,
}: SongV2ConflictReviewDialogProps) => {
  const [reviewedSnapshot, setReviewedSnapshot] = useState<SongV2Snapshot | null>(null);
  const [revisionOptions, setRevisionOptions] = useState<SongV2ConflictRevisionOptions[]>([]);
  const [comparisonDocuments, setComparisonDocuments] = useState<SongV2ConflictComparisonDocuments | null>(null);
  const [selectedRevisions, setSelectedRevisions] = useState<Record<string, string>>({});
  const [viewedRevisions, setViewedRevisions] = useState<Record<string, string>>({});
  const [draftSong, setDraftSong] = useState<DBItem | null>(null);
  const [sourceRevisions, setSourceRevisions] = useState<Record<string, string>>({});
  const [manualLyrics, setManualLyrics] = useState<ManualLyrics>({});
  const [isManualEditing, setIsManualEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChoosing, setIsChoosing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diagnosticMessage, setDiagnosticMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const setReview = (review: ConflictReviewState) => {
    setReviewedSnapshot(review.snapshot);
    setRevisionOptions(review.versions);
    setComparisonDocuments(review.comparisonDocuments);
    setSelectedRevisions(review.choices);
    setViewedRevisions(Object.fromEntries(review.versions.map(entry => [
      entry.conflict.documentId,
      entry.options[1]?.revision ?? entry.conflict.winningRevision,
    ])));
    setDraftSong(review.song);
    setSourceRevisions(review.sourceRevisions);
  };

  useEffect(() => {
    setManualLyrics({});
    setIsManualEditing(false);
  }, [db, songId]);

  useEffect(() => {
    if (!isOpen) return;
    const sequence = ++requestSequence.current;
    let cancelled = false;
    const isCurrent = () => !cancelled && requestSequence.current === sequence;
    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      setDiagnosticMessage(null);
      setRevisionOptions([]);
      setComparisonDocuments(null);
      setSelectedRevisions({});
      setViewedRevisions({});
      setDraftSong(null);
      try {
        const review = await readConflictReview(db, songId, snapshot);
        if (!isCurrent()) return;
        setReview(review);
      } catch (error) {
        if (!isCurrent()) return;
        setErrorMessage(error instanceof SongV2ConflictReviewStaleError
          ? "The saved versions changed. Close this review and open it again to load the latest versions."
          : "Could not load the saved versions. Check the connection and try again.");
      } finally {
        if (isCurrent()) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      requestSequence.current += 1;
    };
  }, [db, isOpen, snapshot, songId]);

  const comparisons = useMemo(() => {
    if (!reviewedSnapshot || !comparisonDocuments) return new Map<string, Map<string, SongV2ConflictDiffModel>>();
    const result = new Map<string, Map<string, SongV2ConflictDiffModel>>();
    for (const entry of revisionOptions) {
      const current = entry.options[0]?.document;
      if (!current) continue;
      const alternatives = new Map<string, SongV2ConflictDiffModel>();
      for (const option of entry.options.slice(1)) {
        const context = comparisonContextFor(reviewedSnapshot, comparisonDocuments, option.document);
        alternatives.set(option.revision, buildSongV2ConflictDiffModel(current, option.document, context));
      }
      result.set(entry.conflict.documentId, alternatives);
    }
    return result;
  }, [comparisonDocuments, reviewedSnapshot, revisionOptions]);

  const manualArrangementIds = useMemo(() => {
    if (!draftSong) return [] as Arrangment[];
    const affected = new Set<string>();
    for (const entry of revisionOptions) {
      const document = entry.options[0]?.document;
      if (document?.docType === "song-v2-root") {
        draftSong.arrangements.forEach(arrangement => affected.add(arrangement.id));
      } else if (document?.docType === "song-v2-arrangement" || document?.docType === "song-v2-slide") {
        affected.add(document.arrangementId);
      }
    }
    return draftSong.arrangements.filter(arrangement => affected.has(arrangement.id) && arrangement.formattedLyrics.length);
  }, [draftSong, revisionOptions]);

  const hasMeaningfulLyricDifferences = [...comparisons.values()].some(options => [...options.values()].some(model =>
    model.lyricsIdentical === false || model.sections.length > 0,
  ));
  const manualChanges = changedManualEntries(draftSong, manualLyrics);
  const missingManual = missingManualEntries(draftSong, manualLyrics);
  const impactSong = useMemo(() => draftSong ? applyManualTextDraft(draftSong, manualLyrics) : null, [draftSong, manualLyrics]);
  const selectedOutcome = useMemo(() => reviewedSnapshot && impactSong
    ? buildSongV2SongDiffModel(reviewedSnapshot.hydrated, impactSong)
    : null, [impactSong, reviewedSnapshot]);

  const chooseRevision = async (documentId: string, revision: string) => {
    if (!reviewedSnapshot || isChoosing || selectedRevisions[documentId] === revision) return;
    const sequence = ++requestSequence.current;
    const choices = { ...selectedRevisions, [documentId]: revision };
    setIsChoosing(true);
    setErrorMessage(null);
    try {
      const selection = await buildSongV2RevisionSelection(db, reviewedSnapshot, revisionOptions, choices);
      if (requestSequence.current !== sequence) return;
      setSelectedRevisions(choices);
      setDraftSong(selection.song);
      setSourceRevisions(selection.sourceRevisions);
    } catch (error) {
      if (requestSequence.current !== sequence) return;
      setErrorMessage(error instanceof SongV2ConflictReviewStaleError
        ? "A saved version changed while you were reviewing. Reload the review before saving."
        : "Could not load that saved version. Check the connection and try again.");
    } finally {
      if (requestSequence.current === sequence) setIsChoosing(false);
    }
  };

  const discardManualEntry = (arrangementId: string, lyricId: string) => {
    setManualLyrics(previous => {
      const next = { ...previous };
      const arrangement = { ...next[arrangementId] };
      delete arrangement[lyricId];
      if (Object.keys(arrangement).length) next[arrangementId] = arrangement;
      else delete next[arrangementId];
      return next;
    });
  };

  const saveResolution = async () => {
    if (!reviewedSnapshot || !draftSong || isSaving || isLoading || isChoosing || missingManual.length) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const manualSong = applyManualLyrics(draftSong, manualLyrics);
      const result = await resolveSongV2ConflictReview(
        db,
        reviewedSnapshot,
        manualSong,
        reviewedSnapshot.conflicts ?? [],
        sourceRevisions,
      );
      if (result.conflictsRetired) {
        onResolved(result.song);
        onClose();
        return;
      }
      const latest = await loadSongV2Snapshot(db, songId, true);
      if (!latest.conflicts?.length) {
        onResolved(latest.hydrated);
        onClose();
        return;
      }
      const review = await readConflictReview(db, songId, latest);
      setReview(review);
      onConflictChanged(review.snapshot);
      setErrorMessage("A newer saved version arrived during review. Compare the latest versions before saving again.");
    } catch (error) {
      if (error instanceof SongV2ConflictReviewStaleError) {
        const latest = await loadSongV2Snapshot(db, songId, true).catch(() => null);
        if (latest) {
          if (!latest.conflicts?.length) {
            onResolved(latest.hydrated);
            onClose();
            return;
          }
          const review = await readConflictReview(db, songId, latest).catch(() => null);
          if (review) {
            setReview(review);
            onConflictChanged(review.snapshot);
          }
        }
        setErrorMessage("The song changed while you were reviewing. Compare the latest saved versions before saving again.");
      } else {
        setErrorMessage("Could not save the resolution. Your saved versions are still available; try again.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const copyDiagnostics = async () => {
    const details = revisionOptions.flatMap(entry => {
      const label = entry.options[0]?.document ? versionLabel(entry.options[0].document) : "Saved song document";
      return [
        `${label} (${entry.conflict.documentId})`,
        `Currently saved revision: ${entry.conflict.winningRevision}`,
        ...entry.conflict.revisions.map((revision, index) => `Alternative ${index + 1} revision: ${revision}`),
      ];
    }).join("\n");
    try {
      await navigator.clipboard.writeText(details);
      setDiagnosticMessage("Diagnostic information copied.");
    } catch {
      setDiagnosticMessage("Could not copy diagnostic information from this window.");
    }
  };

  const getManualName = (arrangementId: string, lyricId: string) => {
    const saved = reviewedSnapshot?.hydrated.arrangements.find(item => item.id === arrangementId)
      ?.formattedLyrics.find(item => item.id === lyricId);
    if (saved) return saved.name;
    for (const entry of revisionOptions) {
      for (const option of entry.options) {
        if (option.document.docType !== "song-v2-arrangement" || option.document.arrangementId !== arrangementId) continue;
        const lyric = option.document.formattedLyrics.find(item => item.id === lyricId);
        if (lyric) return lyric.name;
      }
    }
    return "a lyric section";
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Review saved song versions"
      description="Compare each alternative with the currently saved song, choose what to keep, and review the result before saving."
      size="2xl"
      busy={isSaving}
      contentClassName="space-y-4"
    >
      <p className="text-sm text-gray-200">
        Each alternative is compared with the currently saved version. Choose what to keep separately from the version you inspect.
      </p>
      {isLoading ? <p role="status" className="text-sm text-gray-300">Loading saved versions…</p> : null}
      {isChoosing ? <p role="status" className="text-sm text-gray-300">Loading selected version…</p> : null}

      {revisionOptions.map(entry => {
        const currentDocument = entry.options[0]?.document;
        const label = currentDocument ? versionLabel(currentDocument) : "Saved song details";
        const selectedRevision = selectedRevisions[entry.conflict.documentId];
        const viewedRevision = viewedRevisions[entry.conflict.documentId] ?? entry.options[1]?.revision;
        const viewedOption = entry.options.find(option => option.revision === viewedRevision);
        const viewedModel = viewedRevision
          ? comparisons.get(entry.conflict.documentId)?.get(viewedRevision)
          : undefined;
        return (
          <section key={entry.conflict.documentId} className="space-y-3 border-t border-white/15 pt-4">
            <h3 className="font-semibold text-white">{label}</h3>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-gray-300">Choose a version to keep</legend>
              <label className="flex items-start gap-3 rounded-md border border-cyan-300/50 bg-gray-900/70 p-3 text-sm text-white">
                <input
                  type="radio"
                  name={`song-v2-keep-${entry.conflict.documentId}`}
                  aria-label={`Keep currently saved version for ${label}`}
                  checked={selectedRevision === entry.conflict.winningRevision}
                  onChange={() => void chooseRevision(entry.conflict.documentId, entry.conflict.winningRevision)}
                  disabled={isLoading || isChoosing || isSaving}
                  className="mt-1 shrink-0"
                />
                <span className="min-w-0">
                  <span className="font-medium">Currently saved version</span>
                  <span className="mt-0.5 block text-xs text-gray-400">Comparison reference{selectedRevision === entry.conflict.winningRevision ? " · Selected to keep" : ""}</span>
                </span>
              </label>
              {entry.options.slice(1).map((option, index) => {
                const alternativeLabel = `Alternative ${index + 1}`;
                const isSelected = selectedRevision === option.revision;
                const isViewed = viewedRevision === option.revision;
                return (
                  <div key={option.revision} role="group" aria-label={alternativeLabel} className={`flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between ${isSelected ? "border-cyan-300/60 bg-gray-900/70" : "border-white/15 bg-gray-900/40"}`}>
                    <label className="flex min-w-0 items-start gap-3 text-sm text-white">
                      <input
                        type="radio"
                        name={`song-v2-keep-${entry.conflict.documentId}`}
                        aria-label={`Keep ${alternativeLabel} for ${label}`}
                        checked={isSelected}
                        onChange={() => void chooseRevision(entry.conflict.documentId, option.revision)}
                        disabled={isLoading || isChoosing || isSaving}
                        className="mt-1 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{alternativeLabel}</span>
                        {isSelected ? <span className="mt-0.5 block text-xs text-cyan-100">Selected to keep</span> : null}
                      </span>
                    </label>
                    <Button
                      variant="textLink"
                      className="shrink-0 self-start text-cyan-200 sm:self-center"
                      onClick={() => setViewedRevisions(previous => ({ ...previous, [entry.conflict.documentId]: option.revision }))}
                      disabled={isLoading || isSaving}
                      aria-pressed={isViewed}
                      aria-label={`View differences for ${alternativeLabel} of ${label}`}
                    >
                      {isViewed ? "Viewing differences" : "View differences"}
                    </Button>
                  </div>
                );
              })}
            </fieldset>
            {viewedOption && viewedModel ? (
              <div className="space-y-3 rounded-md border border-white/15 bg-gray-900/40 p-3" aria-label={`Differences for ${label}`}>
                <div>
                  <h4 className="font-medium text-white">{`Viewing ${entry.options.indexOf(viewedOption) === 1 ? "Alternative 1" : `Alternative ${entry.options.indexOf(viewedOption)}`} against the currently saved version`}</h4>
                  {viewedModel.lyricsIdentical === true ? (
                    <p className="mt-1 text-sm text-gray-200">Lyrics are identical.</p>
                  ) : viewedModel.lyricsIdentical === false && !viewedModel.sections.length ? (
                    <p className="mt-1 text-sm text-gray-200">This version contains different lyrics. Review the selected outcome below.</p>
                  ) : viewedModel.lyricsIdentical === null ? (
                    <p className="mt-1 text-sm text-gray-200">Lyrics could not be compared from this saved document alone. Review the selected outcome below.</p>
                  ) : null}
                </div>
                {viewedModel.sections.length ? (
                  <div className="space-y-2">
                    <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Changed lyrics</h5>
                    <DiffSections model={viewedModel} />
                  </div>
                ) : null}
                {viewedModel.changes.length ? (
                  <div className="space-y-1">
                    <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Other changes</h5>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-gray-200">
                      {viewedModel.changes.map((item, index) => <li key={`${item.category}:${index}`}>{item.summary}</li>)}
                    </ul>
                  </div>
                ) : null}
                {viewedModel.identicalContent ? <p className="text-sm text-gray-300">No authored content differences.</p> : null}
              </div>
            ) : null}
          </section>
        );
      })}

      {selectedOutcome && draftSong ? (
        <section className="space-y-3 rounded-md border border-cyan-300/30 bg-cyan-950/20 p-3" aria-labelledby="song-v2-selected-outcome">
          <h3 id="song-v2-selected-outcome" className="font-semibold text-white">Your selected version will:</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-100">
            {outcomeLines(selectedOutcome, manualChanges.length > 0).map((line, index) => <li key={`${index}:${line}`}>{line}</li>)}
          </ul>
          {manualChanges.length ? <p className="text-xs text-gray-300">Your edited lyrics will be formatted when you save; page breaks may change.</p> : null}
          <details className="rounded bg-black/20 p-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-100">Review selected section and slide order</summary>
            <div className="mt-3 space-y-4">
              {draftSong.arrangements.map(arrangement => (
                <section key={arrangement.id} className="space-y-2">
                  <h4 className="text-sm font-semibold text-gray-100">{arrangement.name}</h4>
                  <p className="break-words text-xs text-gray-300">
                    <span className="font-medium text-gray-200">Sections:</span>{" "}
                    {orderedNames(arrangement.songOrder.map(section => section.name)).join(" → ") || "None"}
                  </p>
                  <p className="break-words text-xs text-gray-300">
                    <span className="font-medium text-gray-200">Slides that will remain:</span>{" "}
                    {orderedNames(arrangement.slides.map(slide => slide.name)).join(" → ") || "None"}
                  </p>
                </section>
              ))}
            </div>
          </details>
          {selectedOutcome.sections.length ? (
            <details className="rounded bg-black/20 p-3">
              <summary className="cursor-pointer text-sm font-medium text-gray-100">Review selected lyric changes</summary>
              <div className="mt-3"><DiffSections model={selectedOutcome} /></div>
            </details>
          ) : null}
        </section>
      ) : null}

      {(hasMeaningfulLyricDifferences || Object.keys(manualLyrics).length > 0) ? (
        <div className="border-t border-white/15 pt-3">
          <Button variant="textLink" onClick={() => setIsManualEditing(open => !open)} disabled={isLoading || isChoosing || isSaving}>
            {isManualEditing ? "Hide lyric editor" : Object.keys(manualLyrics).length ? "Review lyric edits" : "Edit final lyrics"}
          </Button>
          {missingManual.length ? (
            <div role="alert" className="mt-3 space-y-2 rounded-md border border-amber-300/40 bg-amber-950/30 p-3 text-sm text-amber-100">
              <p>Some manual edits belong to sections missing from the selected version. Choose a version with those sections or discard each edit before saving.</p>
              {missingManual.map(entry => (
                <div key={`${entry.arrangementId}:${entry.lyricId}`} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{getManualName(entry.arrangementId, entry.lyricId)}</span>
                  <Button variant="textLink" className="text-amber-100" onClick={() => discardManualEntry(entry.arrangementId, entry.lyricId)}>
                    Discard this edit
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          {isManualEditing ? (
            <div className="mt-3 space-y-4">
              <p className="text-xs text-gray-300">Edit lyrics in the selected version. Your edits stay in the draft when you inspect or select another saved version.</p>
              {manualChanges.length ? <p className="text-xs text-cyan-100">Manual edits remain in your draft and will be applied when you save.</p> : null}
              <div className="space-y-5">
                {manualArrangementIds.map(arrangement => (
                  <section key={arrangement.id} className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-100">{arrangement.name}</h4>
                    {arrangement.formattedLyrics.map(lyric => {
                      const hasEdit = manualLyrics[arrangement.id]?.[lyric.id] !== undefined;
                      return (
                        <label key={lyric.id} className="block space-y-1 text-sm text-gray-200">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span>{lyric.name}</span>
                            {hasEdit ? <Button variant="textLink" className="text-xs text-gray-300" onClick={() => discardManualEntry(arrangement.id, lyric.id)}>Discard edit</Button> : null}
                          </span>
                          <textarea
                            aria-label={`${arrangement.name} ${lyric.name} lyrics`}
                            value={manualLyrics[arrangement.id]?.[lyric.id] ?? lyric.words}
                            onChange={event => setManualLyrics(previous => ({
                              ...previous,
                              [arrangement.id]: {
                                ...previous[arrangement.id],
                                [lyric.id]: event.target.value,
                              },
                            }))}
                            rows={4}
                            disabled={isLoading || isChoosing || isSaving}
                            className="min-h-20 w-full resize-y rounded border border-gray-600 bg-gray-950 p-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
                          />
                        </label>
                      );
                    })}
                  </section>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="border-t border-white/15 pt-3">
        <summary className="cursor-pointer text-sm text-gray-300">Support information</summary>
        <div className="mt-2 space-y-2">
          <p className="text-xs text-gray-400">Copy document and revision identifiers for troubleshooting.</p>
          <Button variant="textLink" className="text-cyan-200" onClick={() => void copyDiagnostics()} disabled={!revisionOptions.length || isLoading || isSaving}>
            Copy diagnostic information
          </Button>
          {diagnosticMessage ? <p role="status" className="text-xs text-gray-300">{diagnosticMessage}</p> : null}
        </div>
      </details>

      {errorMessage ? <p role="alert" className="text-sm text-amber-200">{errorMessage}</p> : null}
      <div className="flex flex-col-reverse justify-end gap-2 border-t border-white/15 pt-4 sm:flex-row">
        <Button variant="tertiary" onClick={onClose} disabled={isSaving}>Close</Button>
        <Button
          variant="primary"
          onClick={() => void saveResolution()}
          disabled={isLoading || isChoosing || isSaving || missingManual.length > 0 || !reviewedSnapshot || !draftSong || !(reviewedSnapshot.conflicts?.length)}
          isLoading={isSaving}
        >
          Save resolution
        </Button>
      </div>
    </Modal>
  );
};

export default SongV2ConflictReviewDialog;
