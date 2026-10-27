import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../../components/Button/Button";
import Modal from "../../components/Modal/Modal";
import { formatSong } from "../../utils/overflow";
import {
  buildSongV2RevisionSelection,
  loadSongV2ConflictRevisionOptions,
  resolveSongV2ConflictReview,
  SongV2ConflictReviewStaleError,
  type SongV2ConflictRevisionOptions,
} from "../../utils/songV2ReplicationConflicts";
import { loadSongV2Snapshot, type SongV2Snapshot } from "../../utils/songPersistence";
import type { DBItem, ItemState, SongV2ArrangementDocument, SongV2RootDocument, SongV2SlideDocument } from "../../types";

type RevisionDocument = SongV2RootDocument | SongV2ArrangementDocument | SongV2SlideDocument;
type ManualLyrics = Record<string, Record<string, string>>;
type ConflictReviewState = {
  snapshot: SongV2Snapshot;
  versions: SongV2ConflictRevisionOptions[];
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

const documentContent = (doc: RevisionDocument) => Object.fromEntries(
  Object.entries(doc).filter(([key]) => ![
    "_rev", "_revisions", "_conflicts", "createdAt", "createdBy", "updatedAt", "updatedBy",
  ].includes(key)),
);

const versionLabel = (doc: RevisionDocument) => {
  if (doc.docType === "song-v2-root") return "Song details and arrangement list";
  if (doc.docType === "song-v2-arrangement") return `Arrangement: ${doc.name}`;
  return `Slide: ${doc.name}`;
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
  const selection = await buildSongV2RevisionSelection(db, reviewed, versions, choices);
  return {
    snapshot: reviewed,
    versions,
    choices,
    song: selection.song,
    sourceRevisions: selection.sourceRevisions,
  };
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
  const [selectedRevisions, setSelectedRevisions] = useState<Record<string, string>>({});
  const [draftSong, setDraftSong] = useState<DBItem | null>(null);
  const [sourceRevisions, setSourceRevisions] = useState<Record<string, string>>({});
  const [manualLyrics, setManualLyrics] = useState<ManualLyrics>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isChoosing, setIsChoosing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    const sequence = ++requestSequence.current;
    let cancelled = false;
    const isCurrent = () => !cancelled && requestSequence.current === sequence;
    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      setRevisionOptions([]);
      setSelectedRevisions({});
      setDraftSong(null);
      try {
        const review = await readConflictReview(db, songId, snapshot);
        if (!isCurrent()) return;
        setReviewedSnapshot(review.snapshot);
        setRevisionOptions(review.versions);
        setSelectedRevisions(review.choices);
        setDraftSong(review.song);
        setSourceRevisions(review.sourceRevisions);
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

  const manualArrangementIds = useMemo(() => {
    if (!draftSong) return [];
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

  const chooseRevision = async (documentId: string, revision: string) => {
    if (!reviewedSnapshot || isChoosing) return;
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

  const saveResolution = async () => {
    if (!reviewedSnapshot || !draftSong || isSaving || isLoading || isChoosing) return;
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
      setReviewedSnapshot(review.snapshot);
      setRevisionOptions(review.versions);
      setSelectedRevisions(review.choices);
      setDraftSong(review.song);
      setSourceRevisions(review.sourceRevisions);
      setManualLyrics({});
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
            setReviewedSnapshot(review.snapshot);
            setRevisionOptions(review.versions);
            setSelectedRevisions(review.choices);
            setDraftSong(review.song);
            setSourceRevisions(review.sourceRevisions);
            setManualLyrics({});
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Review saved song versions"
      description="Compare each saved version, choose what to keep, and save the resolution."
      size="2xl"
      busy={isSaving}
      contentClassName="space-y-4"
    >
      <p className="text-sm text-gray-200">
        Compare the saved contents below. Your choice is saved only when you select Save resolution.
      </p>
      {isLoading ? <p role="status" className="text-sm text-gray-300">Loading saved versions…</p> : null}
      {isChoosing ? <p role="status" className="text-sm text-gray-300">Loading selected version…</p> : null}
      {revisionOptions.map(entry => {
        const firstDocument = entry.options[0]?.document;
        const label = firstDocument ? versionLabel(firstDocument) : entry.conflict.documentId;
        return (
          <section key={entry.conflict.documentId} className="space-y-2 border-t border-white/15 pt-4">
            <h3 className="font-semibold text-white">{label}</h3>
            <p className="break-all text-xs text-gray-400">{entry.conflict.documentId}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              {entry.options.map((option, index) => {
                const optionLabel = index === 0 ? "Current saved version" : `Competing saved version ${index}`;
                const radioLabel = `${optionLabel}, revision ${option.revision}`;
                return (
                  <label key={option.revision} className="min-w-0 space-y-2 rounded-md border border-white/15 bg-gray-900/60 p-3">
                    <span className="flex items-start gap-2 text-sm text-white">
                      <input
                        type="radio"
                        name={`song-v2-conflict-${entry.conflict.documentId}`}
                        aria-label={radioLabel}
                        checked={selectedRevisions[entry.conflict.documentId] === option.revision}
                        onChange={() => void chooseRevision(entry.conflict.documentId, option.revision)}
                        disabled={isLoading || isChoosing || isSaving}
                        className="mt-1"
                      />
                      <span>{optionLabel}<span className="block break-all font-mono text-xs text-gray-400">{option.revision}</span></span>
                    </span>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 text-xs text-gray-200">
                      {JSON.stringify(documentContent(option.document), null, 2)}
                    </pre>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}

      {manualArrangementIds.length ? (
        <details className="border-t border-white/15 pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-white">Manually reconcile lyrics</summary>
          <p className="mt-2 text-xs text-gray-300">Edit canonical lyrics here. Saving formats the slides from these words and keeps the selected slide identities where they still apply.</p>
          <div className="mt-3 space-y-5">
            {manualArrangementIds.map(arrangement => (
              <section key={arrangement.id} className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-100">{arrangement.name}</h3>
                {arrangement.formattedLyrics.map(lyric => (
                  <label key={lyric.id} className="block space-y-1 text-sm text-gray-200">
                    <span>{lyric.name}</span>
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
                ))}
              </section>
            ))}
          </div>
        </details>
      ) : null}

      {errorMessage ? <p role="alert" className="text-sm text-amber-200">{errorMessage}</p> : null}
      <div className="flex justify-end gap-2 border-t border-white/15 pt-4">
        <Button variant="tertiary" onClick={onClose} disabled={isSaving}>Close</Button>
        <Button
          variant="primary"
          onClick={() => void saveResolution()}
          disabled={isLoading || isChoosing || isSaving || !reviewedSnapshot || !draftSong || !(reviewedSnapshot.conflicts?.length)}
          isLoading={isSaving}
        >
          Save resolution
        </Button>
      </div>
    </Modal>
  );
};

export default SongV2ConflictReviewDialog;
