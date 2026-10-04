import { useEffect, useState } from "react";
import Modal from "../Modal/Modal";
import Button from "../Button/Button";
import { getApiBasePath } from "../../utils/environment";

type ReleaseNote = {
  id: string;
  date: string;
  type: "new" | "improved" | "fixed";
  title: string;
  description: string;
};

type ReleaseNotesResponse = { notes: ReleaseNote[] };

interface WhatsNewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const typeLabels: Record<ReleaseNote["type"], string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
};

const typeStyles: Record<ReleaseNote["type"], string> = {
  new: "bg-emerald-500/15 text-emerald-200",
  improved: "bg-sky-500/15 text-sky-200",
  fixed: "bg-amber-500/15 text-amber-200",
};

const formatReleaseDate = (date: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));

const WhatsNewModal = ({ isOpen, onClose }: WhatsNewModalProps) => {
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsLoading(true);
    setHasError(false);

    void (async () => {
      try {
        const response = await fetch(`${getApiBasePath()}api/release-notes`);
        if (!response.ok) throw new Error("Failed to load release notes");
        const data = (await response.json()) as ReleaseNotesResponse;
        if (!Array.isArray(data.notes)) throw new Error("Invalid release notes response");
        if (!cancelled) setNotes(data.notes);
      } catch (error) {
        console.error("Failed to load release notes:", error);
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, retryCount]);

  const groups = notes.reduce<{ date: string; notes: ReleaseNote[] }[]>(
    (result, note) => {
      const lastGroup = result[result.length - 1];
      if (lastGroup?.date === note.date) {
        lastGroup.notes.push(note);
      } else {
        result.push({ date: note.date, notes: [note] });
      }
      return result;
    },
    [],
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="What's New" size="md">
      {isLoading ? (
        <div role="status" className="py-8 text-center">
          <div className="mx-auto size-8 animate-spin rounded-full border-b-2 border-white" />
          <p className="mt-2 text-gray-300">Loading updates...</p>
        </div>
      ) : hasError ? (
        <div className="py-8 text-center" role="alert">
          <p className="text-gray-200">Couldn’t load updates. Check your connection and try again.</p>
          <Button
            className="mt-4"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            Try again
          </Button>
        </div>
      ) : notes.length === 0 ? (
        <p className="py-8 text-center text-gray-300">No updates yet.</p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.date} aria-label={formatReleaseDate(group.date)}>
              <h2 className="mb-3 border-b border-gray-700 pb-2 text-sm font-semibold text-gray-300">
                <time dateTime={group.date}>{formatReleaseDate(group.date)}</time>
              </h2>
              <ul className="space-y-4">
                {group.notes.map((note) => (
                  <li key={note.id} className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-white">{note.title}</h3>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${typeStyles[note.type]}`}>
                        {typeLabels[note.type]}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-300">{note.description}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
};

export default WhatsNewModal;
