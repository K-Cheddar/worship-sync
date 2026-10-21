import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import TextArea from "../../components/TextArea/TextArea";
import { createSections, updateFormattedSections } from "../../utils/itemUtil";
import {
  readSongTxtFile,
  type SongTxtImport as TxtDraft,
} from "../../utils/songTxtImport";

export default function SongTxtImport({
  hasDraft,
  onApply,
}: {
  hasDraft: boolean;
  onApply: (draft: TxtDraft) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const request = useRef(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<TxtDraft | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [showSections, setShowSections] = useState(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const lyrics = draft?.lyrics;
  const sections = useMemo(
    () =>
      showSections && lyrics
        ? updateFormattedSections(createSections({ unformattedLyrics: lyrics }))
        : null,
    [showSections, lyrics],
  );
  const cancel = () => {
    request.current++;
    setPending(false);
    setDraft(null);
    setConfirmReplace(false);
    setShowSections(false);
    setError("");
  };
  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept=".txt,text/plain"
        className="hidden"
        aria-label="TXT song file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const id = ++request.current;
          setPending(true);
          setError("");
          setDraft(null);
          setConfirmReplace(false);
          try {
            const result = await readSongTxtFile(file);
            if (active.current && id === request.current) setDraft(result);
          } catch (reason) {
            if (active.current && id === request.current)
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Could not read this TXT file. Try another file.",
              );
          } finally {
            if (active.current && id === request.current) setPending(false);
          }
        }}
      />
      <Button
        variant="primary"
        className="w-full justify-center"
        disabled={pending}
        onClick={() => input.current?.click()}
      >
        {pending ? "Reading TXT..." : "Import TXT"}
      </Button>
      {pending && (
        <Button variant="tertiary" onClick={cancel}>
          Cancel TXT import
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {draft && (
        <section
          aria-label="Review TXT import"
          className="space-y-2 rounded-md border border-white/10 p-3"
        >
          <p className="text-sm font-semibold">Review TXT import</p>
          {draft.warnings.map((warning) => (
            <p key={warning} className="text-sm text-amber-200">
              {warning}
            </p>
          ))}
          <Input
            label="Imported song name"
            value={draft.title}
            onChange={(value) => setDraft({ ...draft, title: String(value) })}
          />
          {(
            [
              ["artistName", "Imported artist"],
              ["ccliSongNumber", "CCLI song number"],
            ] as const
          ).map(([field, label]) => (
            <Input
              key={field}
              label={label}
              value={draft.metadata[field] ?? ""}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  metadata: { ...draft.metadata, [field]: String(value) },
                })
              }
            />
          ))}
          {(
            [
              ["authors", "Songwriters"],
              ["copyright", "Copyright"],
              ["publisher", "Publisher"],
            ] as const
          ).map(([field, label]) => (
            <TextArea
              key={field}
              label={label}
              value={draft.metadata[field] ?? ""}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  metadata: { ...draft.metadata, [field]: String(value) },
                })
              }
            />
          ))}
          <TextArea
            label="Imported lyrics"
            value={draft.lyrics}
            onChange={(value) => setDraft({ ...draft, lyrics: String(value) })}
          />
          <details
            onToggle={(event) => setShowSections(event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm">
              Formatted sections
            </summary>
            {sections?.songOrder.map((entry, index) => {
              const section = sections.formattedLyrics.find(
                (part) => part.name === entry.name,
              );
              return (
                <div key={index} className="py-2">
                  <p className="text-sm font-semibold">{section?.name}</p>
                  <p className="whitespace-pre-wrap text-sm">
                    {section?.words}
                  </p>
                </div>
              );
            })}
          </details>
          {confirmReplace && hasDraft && (
            <p role="alert" className="text-sm text-amber-200">
              Applying this TXT will replace the current song name, artist,
              album, metadata, and lyrics. Your song has not been saved.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!draft.title.trim() || !draft.lyrics.trim()}
              onClick={() => {
                if (hasDraft && !confirmReplace) {
                  setConfirmReplace(true);
                  return;
                }
                onApply({
                  ...draft,
                  metadata: { ...draft.metadata, trackName: draft.title },
                });
                cancel();
              }}
            >
              {confirmReplace && hasDraft
                ? "Replace current draft with TXT"
                : "Apply TXT to draft"}
            </Button>
            <Button variant="tertiary" onClick={cancel}>
              Cancel TXT import
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
