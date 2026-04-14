export type LyricsImportQueryEntry = {
  label: string;
  value: string;
};

export const buildLyricsImportQueryEntries = (options: {
  primaryLabel: string;
  primaryValue: string;
  artist?: string;
  album?: string;
}): LyricsImportQueryEntry[] => {
  const entries: LyricsImportQueryEntry[] = [];
  const primary = options.primaryValue.trim();
  if (primary) {
    entries.push({ label: options.primaryLabel, value: primary });
  }
  const artist = options.artist?.trim();
  if (artist) {
    entries.push({ label: "Artist", value: artist });
  }
  const album = options.album?.trim();
  if (album) {
    entries.push({ label: "Album", value: album });
  }
  return entries;
};

type LyricsImportQuerySummaryProps = {
  entries: LyricsImportQueryEntry[];
};

export const LyricsImportQuerySummary = ({
  entries,
}: LyricsImportQuerySummaryProps) => {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md bg-neutral-950/35 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Your search
      </p>
      <dl className="flex flex-col gap-1.5 text-sm">
        {entries.map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <dt className="shrink-0 text-neutral-400">{label}</dt>
            <dd className="min-w-0 wrap-break-word text-neutral-100">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
