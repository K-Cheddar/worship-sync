import { useRef, useState } from "react";
import { ArrowUpDown, Download, EllipsisVertical, Eye, Pencil, Trash2 } from "lucide-react";
import Button from "./Button/Button";
import Checkbox from "./Checkbox/Checkbox";
import ResourceFileIcon from "./ResourceFileIcon";
import { downloadResourceEntry } from "./ResourcePreview";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./ui/DropdownMenu";
import type { ResourceLibraryEntry } from "../types/churchResource";
import type { ResourceSortKey, SortDirection } from "../utils/resourceLibraryPresentation";
import { resourceEntryFileVisual, resourceEntryName } from "../utils/churchResourceCatalog";
import { entryKey, entrySize, entrySource, entryUpdatedAt, errorMessage, formatEntrySize } from "../utils/resourceLibraryPresentation";

const sorts: [ResourceSortKey, string][] = [["name", "Name"], ["type", "Type"], ["size", "Size"], ["updated", "Updated"], ["source", "Source"]];

export const ResourceMobileControls = ({ sortKey, sortDirection, onSort, canSelect, selecting, onSelect, onSelectAll, allSelected, selectedCount, onDeleteSelected, onCancel }: {
  sortKey: ResourceSortKey | null; sortDirection: SortDirection | null;
  onSort: (key: ResourceSortKey | null, direction: SortDirection | null) => void;
  canSelect: boolean; selecting: boolean; onSelect: () => void; onSelectAll: () => void; allSelected: boolean;
  selectedCount: number; onDeleteSelected: () => void; onCancel: () => void;
}) => (
  <div className="flex flex-wrap items-center gap-2 border-b border-gray-700 px-3 py-2">
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" variant="tertiary" svg={ArrowUpDown} className="min-h-[44px]" aria-label="Sort resources">{sortKey ? `${sorts.find(([key]) => key === sortKey)?.[1]} ${sortDirection === "asc" ? "↑" : "↓"}` : "Default order"}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={sortKey ? `${sortKey}:${sortDirection}` : "default"} onValueChange={(value) => {
          if (value === "default") { onSort(null, null); return; }
          const [key, direction] = value.split(":") as [ResourceSortKey, SortDirection];
          onSort(key, direction);
        }}>
          <DropdownMenuRadioItem value="default">Default order</DropdownMenuRadioItem>
          {sorts.flatMap(([key, label]) => (["asc", "desc"] as const).map((direction) => <DropdownMenuRadioItem key={`${key}:${direction}`} value={`${key}:${direction}`}>{label} {direction === "asc" ? "ascending" : "descending"}</DropdownMenuRadioItem>))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    {canSelect && !selecting ? <Button type="button" variant="tertiary" className="ml-auto min-h-[44px]" onClick={onSelect}>Select</Button> : null}
    {selecting ? <>
      <Button type="button" variant="tertiary" className="min-h-[44px]" onClick={onSelectAll}>{allSelected ? "Deselect all" : "Select all"}</Button>
      <Button type="button" variant="tertiary" className="min-h-[44px]" onClick={onCancel}>Cancel selection</Button>
      <Button type="button" variant="destructive" className="min-h-[44px]" disabled={!selectedCount} onClick={onDeleteSelected}>Delete selected ({selectedCount})</Button>
    </> : null}
  </div>
);

const ResourceRowMenu = ({ entry, churchId, canEdit, onPreview, onRename, onDelete }: {
  entry: ResourceLibraryEntry; churchId: string; canEdit: boolean;
  onPreview: () => void; onRename: () => void; onDelete: () => void;
}) => {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const pendingAction = useRef<(() => void) | null>(null);
  const canManage = canEdit && entry.source === "church-resource";
  const canDownload = entry.source === "song-audio" || entry.resource.sourceType !== "external";
  const deletionIncomplete = entry.source === "church-resource" && entry.resource.deletionStatus === "deleting";
  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setError("");
    try { await downloadResourceEntry(churchId, entry); }
    catch (downloadError) { setError(errorMessage(downloadError, "The download could not be started.")); }
    finally { setDownloading(false); }
  };
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button type="button" variant="tertiary" svg={EllipsisVertical} className="h-[44px] min-h-[44px] w-[44px] min-w-[44px] shrink-0" aria-label={`Actions for ${resourceEntryName(entry)}`} /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" onCloseAutoFocus={() => {
      // Release the menu focus scope before mounting a preview or confirmation dialog.
      const action = pendingAction.current;
      pendingAction.current = null;
      action?.();
    }}>
      <DropdownMenuItem disabled={downloading} onSelect={() => { pendingAction.current = onPreview; }}><Eye />Preview</DropdownMenuItem>
      {canDownload ? <DropdownMenuItem disabled={downloading || deletionIncomplete} onSelect={(event) => { event.preventDefault(); void download(); }}><Download />{downloading ? "Downloading…" : "Download"}</DropdownMenuItem> : null}
      {canManage ? <>
        <DropdownMenuItem disabled={downloading || deletionIncomplete} onSelect={() => { pendingAction.current = onRename; }}><Pencil />Rename</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled={downloading} onSelect={() => { pendingAction.current = onDelete; }}><Trash2 />{deletionIncomplete ? "Retry deletion" : "Delete"}</DropdownMenuItem>
      </> : null}
      {error ? <p role="alert" className="max-w-64 px-2 py-1 text-sm text-red-300">{error}</p> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
};

const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const ResourceMobileName = ({ name, metadata, recentLabel }: { name: string; metadata: string; recentLabel?: string }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <button type="button" aria-label={`Toggle full name for ${name}`} aria-expanded={expanded} title={expanded ? undefined : name} onClick={() => setExpanded((current) => !current)} className="min-h-[44px] min-w-0 flex-1 cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:bg-cyan-500/15">
      <span className={`block text-sm font-semibold text-gray-100 ${expanded ? "whitespace-normal break-all" : "truncate"}`}>{name}</span>
      <span className="block truncate text-xs text-gray-400" title={metadata}>{metadata}</span>
      {recentLabel ? <span className="text-xs font-medium text-green-300">{recentLabel}</span> : null}
    </button>
  );
};

const ResourceMobileList = ({ entries, churchId, canEdit, selecting, selectedKeys, recentKeys, previewKey, onToggle, onPreview, onRename, onDelete }: {
  entries: ResourceLibraryEntry[]; churchId: string; canEdit: boolean; selecting: boolean;
  selectedKeys: Set<string>; recentKeys: Set<string>; previewKey: string | null;
  onToggle: (entry: ResourceLibraryEntry) => void;
  onPreview: (entry: ResourceLibraryEntry) => void;
  onRename: (entry: ResourceLibraryEntry) => void;
  onDelete: (entry: ResourceLibraryEntry) => void;
}) => (
  <ul aria-label="Resources" className="min-h-0 flex-1 divide-y divide-gray-700 overflow-y-auto overflow-x-hidden pb-4">
    {entries.map((entry) => {
      const key = entryKey(entry);
      const visual = resourceEntryFileVisual(entry);
      const recent = recentKeys.has(key);
      const selected = selectedKeys.has(key);
      const external = entry.source === "church-resource" && entry.resource.sourceType === "external";
      const metadata = [visual.label, entrySize(entry) === null || entry.source === "song-audio" ? entrySource(entry) : formatEntrySize(entry), shortDate(entryUpdatedAt(entry))];
      return <li key={key} className={`flex min-w-0 items-center gap-1 px-2 py-0 ${recent ? "bg-green-500/10" : selected || previewKey === key ? "bg-cyan-500/10" : "hover:bg-cyan-500/5"}`}>
        {selecting && canEdit && entry.source === "church-resource" ? <Checkbox label={`Select ${resourceEntryName(entry)}`} hideLabel checked={selected} onCheckedChange={() => onToggle(entry)} className="flex size-[44px] shrink-0 items-center justify-center" /> : null}
        <button type="button" aria-label={`Preview ${resourceEntryName(entry)}`} aria-pressed={previewKey === key} onClick={() => onPreview(entry)} className="flex size-[44px] shrink-0 cursor-pointer items-center justify-center rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:bg-cyan-500/15">
          <ResourceFileIcon visual={visual} />
        </button>
        <ResourceMobileName key={resourceEntryName(entry)} name={resourceEntryName(entry)} metadata={metadata.join(" · ")} recentLabel={recent ? external ? "Added" : "Uploaded" : undefined} />
        <ResourceRowMenu entry={entry} churchId={churchId} canEdit={canEdit} onPreview={() => onPreview(entry)} onRename={() => onRename(entry)} onDelete={() => onDelete(entry)} />
      </li>;
    })}
  </ul>
);

export const ResourceMobileSkeleton = () => <div role="region" aria-label="Loading resources" aria-busy="true" className="min-h-0 flex-1 overflow-hidden">
  <span className="sr-only" role="status">Loading resources...</span>
  {Array.from({ length: 5 }, (_, index) => <div key={index} aria-hidden="true" className="flex items-center gap-3 border-b border-gray-700 px-3 py-0"><div className="size-[44px] shrink-0 animate-pulse rounded-lg bg-gray-800" /><div className="min-w-0 flex-1 space-y-2"><div className="h-4 w-4/5 animate-pulse rounded bg-gray-700" /><div className="h-3 w-2/3 animate-pulse rounded bg-gray-800" /></div></div>)}
</div>;

export default ResourceMobileList;
