import { useMemo, useRef, useState } from "react";
import { Download, FileUp, LoaderCircle } from "lucide-react";
import Button from "../../../components/Button/Button";
import { useAccountPage } from "../AccountPageContext";
import {
  commitPortableImport,
  downloadPortableData,
  inspectPortableImport,
  previewPortableImport,
} from "../../../api/auth";
import type { PortableImportResolution } from "../../../api/authTypes";
import type { PortableDataType, PortableImportRow } from "../../../api/authTypes";

const DATA_TYPES: Array<{ id: PortableDataType; label: string; required: string[] }> = [
  { id: "members", label: "Members", required: ["firstName", "lastName"] },
  { id: "teams", label: "Teams", required: ["name"] },
  { id: "positions", label: "Positions", required: ["name", "team"] },
  { id: "services", label: "Services", required: ["name", "recurrence"] },
  { id: "schedules", label: "Schedules", required: ["name", "team", "service", "date"] },
];
const LABELS: Record<string, string> = {
  firstName: "First name", lastName: "Last name", title: "Title", email: "Email", phone: "Phone", teams: "Teams", positions: "Positions", notes: "Notes", servingFrequency: "Serving frequency", archived: "Archived", memberId: "WorshipSync Member ID", teamIds: "WorshipSync Team IDs", positionIds: "WorshipSync Position IDs",
  name: "Name / person", description: "Description", usesMicrophones: "Uses microphones", usesIems: "Uses IEMs", team: "Team", group: "Group", order: "Order", positionId: "WorshipSync Position ID", teamId: "WorshipSync Team ID",
  recurrence: "Recurrence", time: "Time", date: "Date", daysOfWeek: "Days of week", startDate: "Start date", endDate: "End date", weekOrdinal: "Week ordinal", weekday: "Weekday", combinedGroup: "Combined group", position: "Position", requiredSlots: "Required slots", serviceId: "WorshipSync Service ID",
  startTime: "Start time", slot: "Slot", person: "Person", assignmentType: "Assignment type", guest: "Guest", scheduleId: "WorshipSync Schedule ID", occurrenceId: "WorshipSync Occurrence ID",
};
const FIELD_ORDER: Record<PortableDataType, string[]> = {
  members: ["firstName", "lastName", "name", "title", "email", "phone", "teams", "positions", "notes", "servingFrequency", "archived", "memberId", "teamIds", "positionIds"],
  teams: ["name", "description", "usesMicrophones", "usesIems", "archived", "teamId"],
  positions: ["name", "team", "description", "group", "order", "archived", "positionId", "teamId"],
  services: ["name", "recurrence", "time", "date", "daysOfWeek", "startDate", "endDate", "weekOrdinal", "weekday", "combinedGroup", "position", "requiredSlots", "archived", "serviceId", "positionId"],
  schedules: ["name", "startDate", "endDate", "service", "date", "startTime", "team", "position", "slot", "person", "email", "assignmentType", "guest", "scheduleId", "occurrenceId", "serviceId", "teamId", "positionId", "memberId"],
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

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const buttonClass = "min-h-10 justify-start";
const relationshipChoiceKey = (row: number, field: string, referenceIndex = 0) => `${row}:${field}:${referenceIndex}`;

const AccountDataTransferWorkspace = ({ churchId }: { churchId: string }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<PortableDataType>("members");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [inspection, setInspection] = useState<ImportInspection | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rowChoices, setRowChoices] = useState<Record<number, string>>({});
  const [relationshipChoices, setRelationshipChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [commitResults, setCommitResults] = useState<Array<{ row: number; status: "created" | "updated" | "failed"; message?: string; code?: string }>>([]);
  const [previewPage, setPreviewPage] = useState(0);
  const currentType = DATA_TYPES.find((item) => item.id === type)!;
  const mappings = inspection?.mapping || {};
  const selectedRows = useMemo(() => (preview?.rows || []).filter((row) => {
    const choice = rowChoices[row.row] || (row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : "skip");
    const unresolvedChoice = row.issues.some((issue) => {
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

  const resetImport = (nextType = type) => {
    setType(nextType);
    setFileName("");
    setCsv("");
    setInspection(null);
    setPreview(null);
    setRowChoices({});
    setRelationshipChoices({});
    setMessage("");
    setCommitResults([]);
    setPreviewPage(0);
    if (inputRef.current) inputRef.current.value = "";
  };

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
    setBusy("preview");
    setMessage("");
    try {
      const result = await previewPortableImport(churchId, type, csv, mappings);
      setPreview(result);
      setPreviewPage(0);
      setRelationshipChoices({});
      setRowChoices(Object.fromEntries(result.rows.map((row) => [row.row, row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : "skip"])));
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
        const resolutions: PortableImportResolution[] = row.issues.flatMap((issue) => {
          const referenceIndex = issue.referenceIndex ?? 0;
          const selectedId = relationshipChoices[relationshipChoiceKey(row.row, issue.field, referenceIndex)];
          return selectedId ? [{ field: issue.field, referenceIndex, selectedId }] : [];
        });
        return { row: row.row, action: (recordId ? "update" : "create") as "create" | "update", ...(recordId ? { recordId } : {}), record: row.record, resolutions };
      });
      const result = await commitPortableImport(churchId, type, rows);
      const resultByRow = new Map(commitResults.map((item) => [item.row, item]));
      result.results.forEach((item) => resultByRow.set(item.row, item));
      const combinedResults = [...resultByRow.values()];
      const counts = {
        created: combinedResults.filter((item) => item.status === "created").length,
        updated: combinedResults.filter((item) => item.status === "updated").length,
        failed: combinedResults.filter((item) => item.status === "failed").length,
      };
      setMessage(`Imported ${counts.created} · Updated ${counts.updated} · Failed ${counts.failed} · Skipped ${Math.max(0, preview.summary.total - combinedResults.length)}.`);
      setCommitResults(combinedResults);
      setRowChoices((current) => {
        const next = { ...current };
        result.results.filter((item) => item.status !== "failed").forEach((item) => { next[item.row] = "skip"; });
        return next;
      });
      if (result.summary.failed === 0) {
        setPreview(null);
        setInspection(null);
        setCsv("");
        setFileName("");
        if (inputRef.current) inputRef.current.value = "";
      }
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
      download(result.blob, result.filename);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not download this file. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 text-white">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold">Data transfer</h2>
        <p className="max-w-3xl text-sm text-gray-300">Import data from another platform or export WorshipSync data as standard CSV files. Imports do not archive or restore records; skip rows marked Archived.</p>
      </header>

      <section className="space-y-4 border-t border-gray-700 pt-5" aria-labelledby="data-transfer-import-title">
        <div>
          <h3 id="data-transfer-import-title" className="text-lg font-semibold">Import</h3>
          <p className="mt-1 text-sm text-gray-400">Choose a CSV, map its columns, review matches, then confirm the rows to import. Selecting a file never changes your data.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose data to import">
          {DATA_TYPES.map((item) => <Button key={item.id} type="button" variant={type === item.id ? "primary" : "tertiary"} onClick={() => resetImport(item.id)} disabled={Boolean(busy)}>{item.label}</Button>)}
        </div>
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

        {inspection && !preview && (
          <div className="space-y-4 rounded-lg border border-gray-700 bg-gray-950/40 p-4">
            <p className="text-sm text-gray-200">{inspection.rowCount} {inspection.rowCount === 1 ? "row" : "rows"} · {inspection.columnCount} columns detected</p>
            <div className="space-y-2">
              {FIELD_ORDER[type].map((field) => (
                <label key={field} className="grid gap-1 sm:grid-cols-[minmax(9rem,0.7fr)_minmax(0,1.3fr)] sm:items-center sm:gap-3">
                  <span className="text-sm text-gray-200">{LABELS[field] || field}{(type === "members" ? field === "name" ? !mappings.firstName || !mappings.lastName : ["firstName", "lastName"].includes(field) && !mappings.name : currentType.required.includes(field)) && <span className="ml-1 text-cyan-300">Required</span>}</span>
                  <select className="min-h-10 w-full rounded border border-gray-600 bg-gray-900 px-3 text-sm text-white" value={mappings[field] || ""} onChange={(event) => setInspection((current) => current ? { ...current, mapping: { ...current.mapping, [field]: event.target.value } } : current)}>
                    <option value="">Ignore this field</option>
                    {inspection.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {type === "members" && <p className="text-sm text-amber-200">Import teams and positions first to keep member relationships. Email addresses are contact details and won’t match member identity.</p>}
            <p className="text-xs text-gray-400">Use <span className="font-mono"> | </span> between multiple team, position, or service names in one cell.</p>
            <Button type="button" onClick={() => void handlePreview()} disabled={Boolean(busy)}>{busy === "preview" ? "Checking rows…" : "Review import"}</Button>
          </div>
        )}

        {preview && (
          <div className="space-y-4 rounded-lg border border-gray-700 bg-gray-950/40 p-4">
            <div>
              <h4 className="font-semibold">{preview.summary.total} {preview.summary.total === 1 ? "row" : "rows"} found</h4>
              <p className="mt-1 text-sm text-gray-300">{preview.summary.create} new · {preview.summary.update} matched · {preview.summary.review} need review · {preview.summary.invalid} invalid</p>
            </div>
            {preview.issues.map((issue) => <p key={`${issue.row}-${issue.code}`} className="text-sm text-red-200">Row {issue.row}: {issue.message}</p>)}
            <div className="space-y-2">
              {preview.rows.slice(previewPage * 50, previewPage * 50 + 50).map((row) => {
                const selected = rowChoices[row.row] || (row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : "skip");
                return (
                  <div key={row.row} className="grid gap-2 rounded border border-gray-700 p-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Row {row.row}: {row.record.name || [row.record.firstName, row.record.lastName].filter(Boolean).join(" ") || row.record.person || "Untitled row"}</p>
                      {commitResults.filter((result) => result.row === row.row).map((result) => <p key={`result-${row.row}`} className={`mt-1 text-xs ${result.status === "failed" ? "text-red-200" : "text-green-200"}`}>{result.status === "failed" ? `Import failed: ${result.message || "Preview this file again."}` : result.status === "created" ? "Imported." : "Updated."}</p>)}
                      {row.issues.map((issue, index) => <p key={`${issue.code}-${index}`} className={`mt-1 text-xs ${issue.code === "required" || issue.code === "missing_reference" || issue.code === "unresolved_reference" || issue.code === "not_found" || issue.code === "archived_match" ? "text-red-200" : "text-amber-200"}`}>{issue.message}</p>)}
                      {row.issues.filter((issue) => issue.candidates?.length && ["ambiguous_reference", "foreign_or_unknown_reference_id"].includes(issue.code)).map((issue) => { const fieldLabel = /^service\d+$/.test(issue.field) ? `Service ${Number(issue.field.slice(7)) + 1}` : LABELS[issue.field] || issue.field; const referenceIndex = issue.referenceIndex ?? 0; const choiceKey = relationshipChoiceKey(row.row, issue.field, referenceIndex); const description = issue.referenceValue ? `${fieldLabel.replace(/s$/, "")}: ${issue.referenceValue}` : fieldLabel; return <label key={`resolve-${issue.field}-${referenceIndex}-${issue.code}`} className="mt-2 grid max-w-lg gap-1 text-xs text-gray-200"><span>{description}</span><select aria-label={`Resolve ${description} for row ${row.row}`} className="min-h-9 rounded border border-gray-600 bg-gray-900 px-2 text-sm text-white" value={relationshipChoices[choiceKey] || ""} onChange={(event) => setRelationshipChoices((current) => ({ ...current, [choiceKey]: event.target.value }))}><option value="">Choose a local match…</option>{(issue.candidates || []).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>; })}
                      {row.candidates.length > 0 && <p className="mt-1 text-xs text-gray-400">Several possible matches. Choose one or create a new record.</p>}
                    </div>
                    <select aria-label={`Action for row ${row.row}`} className="min-h-10 w-full rounded border border-gray-600 bg-gray-900 px-3 text-sm text-white" value={selected} disabled={row.action === "invalid" || Boolean(busy)} onChange={(event) => setRowChoices((current) => ({ ...current, [row.row]: event.target.value }))}>
                      <option value="skip">Skip row</option>
                      <option value="create">Create new</option>
                      {row.matchedId && <option value={`update:${row.matchedId}`}>Update matched record</option>}
                      {row.candidates.map((candidate) => <option key={candidate.id} value={`update:${candidate.id}`}>Match {candidate.name}</option>)}
                    </select>
                  </div>
                );
              })}
              {preview.rows.length > 50 && <div className="flex items-center justify-between gap-3 text-sm text-gray-300"><span>Rows {previewPage * 50 + 1}–{Math.min((previewPage + 1) * 50, preview.rows.length)} of {preview.rows.length}</span><div className="flex gap-2"><Button type="button" variant="tertiary" onClick={() => setPreviewPage((page) => Math.max(0, page - 1))} disabled={previewPage === 0}>Previous</Button><Button type="button" variant="tertiary" onClick={() => setPreviewPage((page) => Math.min(Math.ceil(preview.rows.length / 50) - 1, page + 1))} disabled={(previewPage + 1) * 50 >= preview.rows.length}>Next</Button></div></div>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void handleCommit()} disabled={selectedRows.length === 0 || Boolean(busy)}>{busy === "commit" ? <><LoaderCircle className="mr-2 size-4 animate-spin" />Importing…</> : `Import ${selectedRows.length} ${selectedRows.length === 1 ? "row" : "rows"}`}</Button>
              <Button type="button" variant="tertiary" onClick={() => { setPreview(null); setRowChoices({}); }} disabled={Boolean(busy)}>Back to column mapping</Button>
            </div>
          </div>
        )}
        {message && <p role="status" className="text-sm text-amber-100">{message}</p>}
      </section>

      <section className="space-y-4 border-t border-gray-700 pt-5" aria-labelledby="data-transfer-export-title">
        <div>
          <h3 id="data-transfer-export-title" className="text-lg font-semibold">Export</h3>
          <p className="mt-1 text-sm text-gray-400">Download readable CSV files for another platform or spreadsheet. Export all creates a ZIP with one CSV per data type.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {DATA_TYPES.map((item) => <Button key={item.id} type="button" variant="tertiary" svg={Download} className={buttonClass} disabled={Boolean(busy)} onClick={() => void handleDownload(item.id)}>{busy === `export-${item.id}` ? `Preparing ${item.label.toLowerCase()}…` : `${item.label} CSV`}</Button>)}
          <Button type="button" svg={Download} className={buttonClass} disabled={Boolean(busy)} onClick={() => void handleDownload("all")}>{busy === "export-all" ? "Preparing export…" : "Export all"}</Button>
        </div>
      </section>
    </div>
  );
};

const AccountDataTransferPage = () => {
  const { churchId } = useAccountPage();
  return <AccountDataTransferWorkspace key={churchId} churchId={churchId} />;
};

export default AccountDataTransferPage;
