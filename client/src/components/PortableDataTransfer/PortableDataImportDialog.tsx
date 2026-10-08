import Spinner from "@/components/Spinner/Spinner";
import Select from "../Select/Select";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import Modal from "../Modal/Modal";
import Button from "@/components/Button/Button";
import {
  commitPortableImport,
  downloadPortableData,
  inspectPortableImport,
  previewPortableImport,
} from "../../api/auth";
import type { PortableDataType, PortableImportResolution, PortableImportRow, TeamRecord } from "../../api/authTypes";
import { downloadBlob, PORTABLE_DATA_TYPES, PORTABLE_FIELD_LABELS, PORTABLE_FIELD_ORDER } from "./portableDataTransfer";

export type PortableDataImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  churchId: string;
  type: PortableDataType;
  onImported?: () => void;
  teams?: TeamRecord[];
  destinationTeamId?: string;
};

type ImportInspection = {
  headers: string[];
  rowCount: number;
  columnCount: number;
  issues: Array<{ row: number; code: string; message: string }>;
  mapping: Record<string, string>;
};
type Preview = {
  rows: PortableImportRow[];
  issues: Array<{ row: number; code: string; message: string }>;
  summary: { total: number; create: number; update: number; review: number; invalid: number };
};

const buttonClass = "min-h-10 justify-start";
const relationshipChoiceKey = (row: number, field: string, referenceIndex = 0) => `${row}:${field}:${referenceIndex}`;

const PortableDataImportDialog = ({ open, onOpenChange, churchId, type, onImported, teams = [], destinationTeamId: initialTeamId }: PortableDataImportDialogProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [inspection, setInspection] = useState<ImportInspection | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rowChoices, setRowChoices] = useState<Record<number, string>>({});
  const [relationshipChoices, setRelationshipChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [commitResults, setCommitResults] = useState<Array<{ row: number; status: "created" | "updated" | "unchanged" | "failed"; message?: string; code?: string }>>([]);
  const [previewPage, setPreviewPage] = useState(0);
  const [destinationTeamId, setDestinationTeamId] = useState(initialTeamId || "");
  const [updateMode, setUpdateMode] = useState<"merge" | "replace">("merge");
  const [clearBlankScalars, setClearBlankScalars] = useState(false);
  const currentType = PORTABLE_DATA_TYPES.find((item) => item.id === type)!;
  const mappings = inspection?.mapping || {};
  const needsDestinationTeam = type === "members" && !mappings.teams;
  const activeTeams = teams.filter((team) => !team.archivedAt);
  useEffect(() => {
    if (open) setDestinationTeamId(initialTeamId || "");
  }, [open, initialTeamId]);
  const selectedRows = useMemo(() => (preview?.rows || []).filter((row) => {
    const choice = rowChoices[row.row] || (row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : "skip");
    const unresolvedChoice = row.issues.some((issue) => {
      if (issue.code === "required" && issue.field === "team") return true;
      if (issue.code === "missing_reference" && ["teams", "positions"].includes(issue.field)) return true;
      if (!issue.candidates?.length || relationshipChoices[relationshipChoiceKey(row.row, issue.field, issue.referenceIndex)]) return false;
      if (issue.code === "ambiguous_reference") return true;
      if (issue.code !== "foreign_or_unknown_reference_id") return false;
      return (type === "members" && ["teams", "positions"].includes(issue.field))
        || (type === "positions" && ["team", "teamId"].includes(issue.field))
        || (type === "services" && issue.field === "position")
        || (type === "schedules" && ["team", "teamId", "service", "serviceId", "position", "positionId", "person", "memberId"].includes(issue.field));
    });
    return (choice === "create" || choice.startsWith("update:")) && !unresolvedChoice;
  }), [preview, rowChoices, relationshipChoices, type]);

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setInspection(null);
      setPreview(null);
      setCsv("");
      setFileName("");
      setMessage("Choose a .csv file to continue.");
      return;
    }
    setBusy("inspect");
    setMessage("");
    try {
      const contents = await file.text();
      const result = await inspectPortableImport(churchId, type, contents);
      setFileName(file.name);
      setCsv(contents);
      setInspection(result);
      setPreview(null);
      setRowChoices({});
      setRelationshipChoices({});
      setCommitResults([]);
      if (result.issues.length) setMessage(result.issues.map((issue) => `Row ${issue.row}: ${issue.message}`).join(" "));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read this CSV. Check the file and try again.");
    } finally {
      setBusy(null);
    }
  };

  const handlePreview = async () => {
    if (!inspection || busy) return;
    if (needsDestinationTeam && !destinationTeamId) {
      setMessage("Choose a destination team before reviewing these members.");
      return;
    }
    setBusy("preview");
    setMessage("");
    try {
      const result = await previewPortableImport(churchId, type, csv, mappings, undefined, {
        ...(destinationTeamId ? { destinationTeamId } : {}), updateMode, clearBlankScalars,
      });
      const successfulRows = new Set(commitResults.filter((item) => item.status !== "failed").map((item) => item.row));
      setPreview(result);
      setPreviewPage(0);
      setRelationshipChoices({});
      setCommitResults((current) => current.filter((item) => item.status !== "failed"));
      setRowChoices(Object.fromEntries(result.rows.map((row) => [row.row, successfulRows.has(row.row) ? "skip" : row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : "skip"])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not validate this CSV. Check the file and try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleCommit = async () => {
    if (!preview || selectedRows.length === 0 || busy) return;
    setBusy("commit");
    setMessage("");
    try {
      const rows = selectedRows.map((row) => {
        const choice = rowChoices[row.row] || (row.action === "create" ? "create" : `update:${row.matchedId}`);
        const recordId = choice.startsWith("update:") ? choice.slice("update:".length) : "";
        const expectedStateHash = recordId === row.matchedId
          ? row.expectedStateHash
          : row.candidates.find((candidate) => candidate.id === recordId)?.stateHash;
        const resolutions: PortableImportResolution[] = row.issues.flatMap((issue) => {
          const referenceIndex = issue.referenceIndex ?? 0;
          const selectedId = relationshipChoices[relationshipChoiceKey(row.row, issue.field, referenceIndex)];
          return selectedId ? [{ field: issue.field, referenceIndex, selectedId }] : [];
        });
        return { row: row.row, action: (recordId ? "update" : "create") as "create" | "update", ...(recordId ? { recordId } : {}), record: row.record, resolutions, ...(expectedStateHash ? { expectedStateHash } : {}) };
      });
      const result = await commitPortableImport(churchId, type, rows, undefined, {
        ...(destinationTeamId ? { destinationTeamId } : {}), updateMode, clearBlankScalars,
      });
      const resultByRow = new Map(commitResults.map((item) => [item.row, item]));
      result.results.forEach((item) => resultByRow.set(item.row, item));
      const combinedResults = [...resultByRow.values()];
      setMessage("Import finished. Review the results below.");
      setCommitResults(combinedResults);
      if (result.results.some((item) => item.status === "created" || item.status === "updated")) onImported?.();
      setRowChoices((current) => {
        const next = { ...current };
        result.results.filter((item) => item.status !== "failed").forEach((item) => { next[item.row] = "skip"; });
        return next;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import these rows. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async (dataType: PortableDataType | "all", template = false) => {
    const key = `${template ? "template-" : "export-"}${dataType}`;
    setBusy(key);
    setMessage("");
    try {
      const result = await downloadPortableData(churchId, dataType, template, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      downloadBlob(result.blob, result.filename);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not download this file. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const downloadRecoveryRows = () => {
    if (!preview) return;
    const outcomes = new Map(commitResults.map((result) => [result.row, result]));
    const rows: Array<Record<string, string>> = preview.rows.flatMap((row): Array<Record<string, string>> => {
      const outcome = outcomes.get(row.row);
      const skipped = !outcome && (rowChoices[row.row] || "skip") === "skip";
      if (outcome?.status !== "failed" && !skipped) return [];
      return [{ ...(row.sourceValues || {}), "Import result": outcome?.status || "skipped", Reason: outcome?.message || (skipped ? "Skipped by operator." : "") }];
    });
    if (!rows.length) return;
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const safetyHeader = "__worshipsync_csv_encoding_v1";
    const canUseSafetyMarker = !headers.includes(safetyHeader);
    const exportHeaders = canUseSafetyMarker ? [...headers, safetyHeader] : headers;
    const csvRows = rows.map((row) => [...headers.map((header) => String(row[header] ?? "")), ...(canUseSafetyMarker ? ["spreadsheet-safe"] : [])]);
    const csvText = `\uFEFF${[exportHeaders, ...csvRows].map((cells) => cells.map((cell) => {
      const spreadsheetSafe = /^\s*[=+@-]/.test(cell) ? `'\\${cell}` : cell;
      return /[",\r\n]/.test(spreadsheetSafe) ? `"${spreadsheetSafe.replaceAll('"', '""')}"` : spreadsheetSafe;
    }).join(",")).join("\r\n")}\r\n`;
    downloadBlob(new Blob([csvText], { type: "text/csv;charset=utf-8" }), `${type}-import-recovery.csv`);
  };

  return (
    <Modal isOpen={open} onClose={() => onOpenChange(false)} busy={busy === "commit"}
      title={`Import ${currentType.label} from CSV`} size="lg"
      description="Choose a CSV, map its columns, review matches, then confirm the rows to import. Selecting a file never changes your data. Imports do not archive or restore records; skip rows marked Archived."
      surfaceClassName="rounded-lg border border-gray-700 bg-gray-900 text-white">
        <section className="space-y-4 text-white">
        <p className="text-sm text-gray-300">Step 1 · Setup</p>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={inputRef} className="sr-only" type="file" accept=".csv,text/csv" aria-label={`Choose ${currentType.label} CSV`} onChange={(event) => void handleFile(event.currentTarget.files?.[0])} />
          <Button type="button" svg={FileUp} className={buttonClass} onClick={() => inputRef.current?.click()} disabled={Boolean(busy)}>
            {busy === "inspect" ? "Reading CSV…" : `Choose ${currentType.label} CSV`}
          </Button>
          <Button type="button" variant="tertiary" onClick={() => void handleDownload(type, true)} disabled={Boolean(busy)}>
              {busy === `template-${type}` ? "Preparing template…" : "Download CSV template"}
          </Button>
          {fileName && <span className="text-sm text-gray-300">{fileName}</span>}
        </div>

        {type === "members" && <div className="grid gap-2 rounded-lg border border-gray-700 bg-gray-950/40 p-3 sm:grid-cols-2">
          {(needsDestinationTeam || (type === "members" && mappings.teams)) && <label className="grid gap-1 text-sm text-gray-200">{needsDestinationTeam ? "Destination team" : "Team for blank Teams cells"} <span className="text-cyan-300">{needsDestinationTeam ? "Required when the CSV has no Teams column" : "Required for rows without team values; portable IDs keep their mapped teams"}</span>
            <Select aria-label="Destination team" selectClassName="min-h-10 w-full rounded border border-gray-600 bg-gray-900 px-3 text-sm text-white" value={destinationTeamId} onChange={setDestinationTeamId} options={[{ value: "", label: "Choose a team" }, ...activeTeams.map((team) => ({ value: team.teamId, label: team.name }))]} />
          </label>}
          <label className="grid gap-1 text-sm text-gray-200">Update behavior
            <Select aria-label="Update behavior" selectClassName="min-h-10 w-full rounded border border-gray-600 bg-gray-900 px-3 text-sm text-white" value={updateMode} onChange={(value) => setUpdateMode(value === "replace" ? "replace" : "merge")} options={[{ value: "merge", label: "Merge existing information" }, { value: "replace", label: "Replace positions within the imported teams" }]} />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300 sm:col-span-2"><input type="checkbox" checked={clearBlankScalars} onChange={(event) => setClearBlankScalars(event.currentTarget.checked)} />Clear mapped scalar fields when cells are blank</label>
          <p className="text-xs text-gray-400 sm:col-span-2">Blank cells keep saved values by default. SMS consent stays unchanged. Timezone is shown for reference. Skill tiers need an area and level mapping before they can be applied.</p>
        </div>}

        {inspection && !preview && (
          <div className="space-y-4 rounded-lg border border-gray-700 bg-gray-950/40 p-4">
            <h4 className="font-semibold">Step 2 · Column mapping</h4>
            <p className="text-sm text-gray-200">{inspection.rowCount} {inspection.rowCount === 1 ? "row" : "rows"} · {inspection.columnCount} columns detected</p>
            <div className="space-y-2">
              {PORTABLE_FIELD_ORDER[type].map((field) => (
                <div key={field} className="grid gap-1 sm:grid-cols-[minmax(9rem,0.7fr)_minmax(0,1.3fr)] sm:items-center sm:gap-3">
                  <span className="text-sm text-gray-200">{PORTABLE_FIELD_LABELS[field] || field}{(type === "members" ? field === "name" ? !mappings.firstName || !mappings.lastName : ["firstName", "lastName"].includes(field) && !mappings.name : currentType.required.includes(field)) && <span className="ml-1 text-cyan-300">Required</span>}</span>
                  <Select aria-label={`Column for ${PORTABLE_FIELD_LABELS[field] || field}`} selectClassName="min-h-10 w-full rounded border border-gray-600 bg-gray-900 px-3 text-sm text-white" value={mappings[field] || ""} onChange={(value) => setInspection((current) => current ? { ...current, mapping: { ...current.mapping, [field]: value } } : current)} options={[{ value: "", label: "Ignore this field" }, ...inspection.headers.map((header) => ({ value: header, label: header }))]} />
                </div>
              ))}
            </div>
            {type === "members" && <p className="text-sm text-amber-200">Categories map to positions in the destination team. Email and phone are not used to match member identity.</p>}
            <p className="text-xs text-gray-400">For multiple names, use <span className="font-mono"> | </span>, semicolons, or separate lines. Commas split only when each part matches a known name.</p>
            <p className="text-sm text-gray-300">Unmapped columns: {inspection.headers.filter((header) => !Object.values(mappings).includes(header)).join(", ") || "None"}. Unmapped values are ignored.</p>
            <Button type="button" onClick={() => void handlePreview()} disabled={Boolean(busy) || (needsDestinationTeam && !destinationTeamId)}>{busy === "preview" ? "Checking rows…" : "Review import"}</Button>
          </div>
        )}

        {preview && (
          <div className="space-y-4 rounded-lg border border-gray-700 bg-gray-950/40 p-4">
            <div>
              <h4 className="font-semibold">Review</h4>
              <p className="text-sm text-gray-300">{preview.summary.total} {preview.summary.total === 1 ? "row" : "rows"} found</p>
              <p className="mt-1 text-sm text-gray-300">{preview.summary.create} new · {preview.summary.update} matched · {preview.summary.review} need review · {preview.summary.invalid} invalid · {preview.rows.filter((row) => (rowChoices[row.row] || (row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : "skip")) === "skip").length} skipped</p>
            </div>
            {commitResults.length > 0 && <div className="rounded border border-gray-700 p-3 text-sm" aria-live="polite">
              <h5 className="font-semibold">Step 4 · Results</h5>
              <p className="mt-1 text-gray-300">Created {commitResults.filter((item) => item.status === "created").length} · Updated {commitResults.filter((item) => item.status === "updated").length} · Unchanged {commitResults.filter((item) => item.status === "unchanged").length} · Failed {commitResults.filter((item) => item.status === "failed").length} · Skipped {Math.max(0, preview.summary.total - commitResults.length)}</p>
              {type === "members" && <Button type="button" variant="tertiary" className="mt-2" onClick={downloadRecoveryRows}>Download failed and skipped rows</Button>}
            </div>}
            {preview.issues.map((issue) => <p key={`${issue.row}-${issue.code}`} className="text-sm text-red-200">Row {issue.row}: {issue.message}</p>)}
            <div className="space-y-2">
              {preview.rows.slice(previewPage * 50, previewPage * 50 + 50).map((row) => {
                const selected = rowChoices[row.row] || (row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : "skip");
                const mustSkip = row.issues.some((issue) => (issue.code === "missing_reference" && ["teams", "positions"].includes(issue.field)) || (issue.code === "required" && issue.field === "team"));
                const fallbackTeamName = row.record.teamIds === undefined && row.record.positionIds === undefined
                  ? activeTeams.find((team) => team.teamId === destinationTeamId)?.name
                  : "";
                const createDetails = [["Email", row.record.email], ["Phone", row.record.phone], ["Teams", row.record.teams || fallbackTeamName], ["Positions", row.record.positions], ["Notes", row.record.notes]].filter(([, value]) => Boolean(value));
                return (
                  <div key={row.row} className="grid gap-2 rounded border border-gray-700 p-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Row {row.row}: {row.record.name || [row.record.firstName, row.record.lastName].filter(Boolean).join(" ") || row.record.person || "Untitled row"}</p>
                      {commitResults.filter((result) => result.row === row.row).map((result) => <p key={`result-${row.row}`} className={`mt-1 text-xs ${result.status === "failed" ? "text-red-200" : "text-green-200"}`}>{result.status === "failed" ? `Import failed: ${result.message || "Preview this file again."}` : result.status === "created" ? "Created." : result.status === "unchanged" ? "No changes." : "Updated."}</p>)}
                      {row.record.status !== undefined && <p className="mt-1 text-xs text-amber-200">Source status: {row.record.status || "blank"} · Member lifecycle is unchanged.</p>}
                      {row.record.smsOptIn !== undefined && <p className="mt-1 text-xs text-gray-300">Source SMS opt-in: {row.record.smsOptIn || "blank"} · WorshipSync consent is unchanged.</p>}
                      {row.record.timezone !== undefined && <p className="mt-1 text-xs text-gray-300">Source timezone: {row.record.timezone || "blank"} · Not imported.</p>}
                      {row.record.skillTiers !== undefined && <p className="mt-1 text-xs text-gray-300">Skill tiers: {row.record.skillTiers || "blank"} · Not applied; no area or level mapping is available.</p>}
                      {row.action === "create" && createDetails.length > 0 && <p className="mt-1 text-xs text-gray-200">New details: {createDetails.map(([label, value]) => `${label}: ${value}`).join(" · ")}</p>}
                      {(row.changes || []).map((change, index) => <p key={`change-${row.row}-${index}`} className="mt-1 text-xs text-gray-200">{change.field}: {change.before || "—"} → {change.after || "—"}</p>)}
                      {row.action === "update" && !(row.changes || []).length && <p className="mt-1 text-xs text-gray-300">No mapped changes. Existing memberships and qualifications stay as saved.</p>}
                      {row.action === "update" && (row.changes || []).some((change) => change.field === "Position" || change.field === "Team membership") && <p className="mt-1 text-xs text-gray-300">Other team memberships and positions are preserved.</p>}
                      {row.issues.map((issue, index) => <p key={`${issue.code}-${index}`} className={`mt-1 text-xs ${issue.code === "required" || issue.code === "missing_reference" || issue.code === "unresolved_reference" || issue.code === "not_found" || issue.code === "archived_match" ? "text-red-200" : "text-amber-200"}`}>{issue.message}</p>)}
                      {row.issues.filter((issue) => issue.candidates?.length && ["ambiguous_reference", "foreign_or_unknown_reference_id"].includes(issue.code)).map((issue) => { const fieldLabel = issue.field === "positions" ? "Position" : issue.field === "teams" ? "Team" : /^service\d+$/.test(issue.field) ? `Service ${Number(issue.field.slice(7)) + 1}` : PORTABLE_FIELD_LABELS[issue.field] || issue.field; const referenceIndex = issue.referenceIndex ?? 0; const choiceKey = relationshipChoiceKey(row.row, issue.field, referenceIndex); const description = issue.referenceValue ? `${fieldLabel}: ${issue.referenceValue}` : fieldLabel; return <div key={`resolve-${issue.field}-${referenceIndex}-${issue.code}`} className="mt-2 grid max-w-lg gap-1 text-xs text-gray-200"><span>{description}</span><Select aria-label={`Resolve ${description} for row ${row.row}`} selectClassName="min-h-9 rounded border border-gray-600 bg-gray-900 px-2 text-sm text-white" value={relationshipChoices[choiceKey] || ""} onChange={(value) => setRelationshipChoices((current) => ({ ...current, [choiceKey]: value }))} options={[{ value: "", label: "Choose a local match…" }, ...(issue.candidates || []).map((candidate) => ({ value: candidate.id, label: candidate.teamName ? `${candidate.name} · ${candidate.teamName}` : candidate.name }))]} /></div>; })}
                      {row.candidates.length > 0 && <p className="mt-1 text-xs text-gray-400">Several possible matches. Choose one or create a new record.</p>}
                    </div>
                    <Select aria-label={`Action for row ${row.row}`} selectClassName="min-h-10 w-full rounded border border-gray-600 bg-gray-900 px-3 text-sm text-white" value={selected} disabled={row.action === "invalid" || Boolean(busy)} onChange={(value) => setRowChoices((current) => ({ ...current, [row.row]: value }))} options={mustSkip ? [{ value: "skip", label: "Skip row" }] : [{ value: "skip", label: "Skip row" }, { value: "create", label: "Create new" }, ...(row.matchedId ? [{ value: `update:${row.matchedId}`, label: "Update matched record" }] : []), ...row.candidates.filter((candidate) => candidate.id !== row.matchedId).map((candidate) => ({ value: `update:${candidate.id}`, label: `Match ${candidate.name}` }))]} />
                  </div>
                );
              })}
              {preview.rows.length > 50 && <div className="flex items-center justify-between gap-3 text-sm text-gray-300"><span>Rows {previewPage * 50 + 1}–{Math.min((previewPage + 1) * 50, preview.rows.length)} of {preview.rows.length}</span><div className="flex gap-2"><Button type="button" variant="tertiary" onClick={() => setPreviewPage((page) => Math.max(0, page - 1))} disabled={previewPage === 0}>Previous</Button><Button type="button" variant="tertiary" onClick={() => setPreviewPage((page) => Math.min(Math.ceil(preview.rows.length / 50) - 1, page + 1))} disabled={(previewPage + 1) * 50 >= preview.rows.length}>Next</Button></div></div>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void handleCommit()} disabled={selectedRows.length === 0 || Boolean(busy)}>{busy === "commit" ? <><Spinner size="sm" className="mr-2 shrink-0" />Importing…</> : `Import ${selectedRows.length} ${selectedRows.length === 1 ? "row" : "rows"}`}</Button>
              <Button type="button" variant="tertiary" onClick={() => { setPreview(null); setRowChoices({}); }} disabled={Boolean(busy)}>Back to column mapping</Button>
            </div>
          </div>
        )}
        {message && <p role="status" className="text-sm text-amber-100">{message}</p>}
        </section>
    </Modal>
  );
};

export default PortableDataImportDialog;
