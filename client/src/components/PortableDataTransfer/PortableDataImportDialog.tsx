import Spinner from "@/components/Spinner/Spinner";
import Select from "../Select/Select";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, CircleAlert, FileUp, Link2, Minus, Plus } from "lucide-react";
import Modal from "../Modal/Modal";
import Button from "@/components/Button/Button";
import Input from "@/components/Input/Input";
import {
  commitPortableImport,
  downloadPortableData,
  inspectPortableImport,
  previewPortableImport,
} from "../../api/auth";
import type { PortableDataType, PortableImportIssue, PortableImportResolution, PortableImportRow, PortablePositionAction, PortableTeamAction, TeamRecord } from "../../api/authTypes";
import { downloadBlob, PORTABLE_DATA_TYPES, PORTABLE_FIELD_LABELS, PORTABLE_FIELD_ORDER } from "./portableDataTransfer";
import { useToast } from "../../context/toastContext";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type PortableDataImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  churchId: string;
  type: PortableDataType;
  onImported?: () => void | Promise<void>;
  teams?: TeamRecord[];
  destinationTeamId?: string;
};

type ImportInspection = {
  headers: string[];
  rowCount: number;
  columnCount: number;
  issues: Array<{ row: number; code: string; message: string }>;
  mapping: Record<string, string>;
  columnStats: Record<string, { nonBlank: number; blank: number }>;
};
type Preview = {
  rows: PortableImportRow[];
  issues: Array<{ row: number; code: string; message: string }>;
  summary: { total: number; create: number; update: number; review: number; invalid: number };
  previewToken?: string;
  previewCsvHash?: string;
};

type MemberReviewFilter = "all" | "new" | "updates" | "review" | "skipped";

const isUnresolvedMemberReference = (row: PortableImportRow, choices: Record<string, string>) => row.issues.some((issue) => {
  if (issue.code === "required" || (issue.code === "missing_reference" && ["teams", "positions"].includes(issue.field))) return true;
  if (["unresolved_reference", "not_found", "archived_match"].includes(issue.code)) return true;
  if (!issue.candidates?.length || !["ambiguous_reference", "foreign_or_unknown_reference_id"].includes(issue.code)) return false;
  return !choices[relationshipChoiceKey(row.row, issue.field, issue.referenceIndex)];
});


const memberReviewStatus = (row: PortableImportRow, selected: string) => {
  if (row.action === "invalid") return "Needs your review";
  if (row.action === "review" && selected === "review") return "Needs your review";
  if (selected === "skip") return "Skip member";
  if (selected.startsWith("update:")) return (row.changes || []).length ? "Update member" : "Already up to date";
  return "Add as new member";
};

const memberIssueMessage = (issue: PortableImportIssue) => {
  const field = issue.field === "positions" ? "position" : issue.field === "teams" ? "team" : PORTABLE_FIELD_LABELS[issue.field]?.toLowerCase() || "information";
  if (issue.code === "required") return "Choose a " + field + " before importing this member.";
  if (issue.code === "missing_reference") return issue.referenceValue
    ? "“" + issue.referenceValue + "” isn't set up in this church yet. Choose a match or add it."
    : "Choose a " + field + " before importing this member.";
  if (issue.code === "ambiguous_reference") return "We found more than one possible " + field + ". Choose the one you mean.";
  if (issue.code === "foreign_or_unknown_reference_id") return "Choose a local " + field + " for this member.";
  if (issue.code === "unresolved_reference" || issue.code === "not_found") return "We couldn't find this " + field + ". Check the CSV information or skip this member.";
  if (issue.code === "archived_match") return "This member is archived and can't be updated from this import.";
  return issue.message;
};

const summarizeMemberChanges = (changes: NonNullable<PortableImportRow["changes"]>) => {
  const summaries: string[] = [];
  const positions = changes.filter((change) => /^positions?$/i.test(change.field));
  const teams = changes.filter((change) => /^teams?$/i.test(change.field));
  const positionAdds = positions.filter((change) => !change.before && change.after).map((change) => change.after);
  const positionRemovals = positions.filter((change) => change.before && !change.after).map((change) => change.before);
  const positionReplacements = positions.filter((change) => change.before && change.after);
  if (positionAdds.length === 1) summaries.push(`Add ${positionAdds[0]}`);
  if (positionAdds.length > 1) summaries.push(`Add ${positionAdds.length} positions: ${positionAdds.join(", ")}`);
  if (positionRemovals.length === 1) summaries.push(`Remove ${positionRemovals[0]}`);
  if (positionRemovals.length > 1) summaries.push(`Remove ${positionRemovals.length} positions: ${positionRemovals.join(", ")}`);
  positionReplacements.forEach((change) => summaries.push(`Change ${change.before} to ${change.after}`));
  const teamAdds = teams.filter((change) => !change.before && change.after).map((change) => change.after);
  const teamRemovals = teams.filter((change) => change.before && !change.after).map((change) => change.before);
  if (teamAdds.length === 1) summaries.push("Add to " + teamAdds[0]);
  if (teamAdds.length > 1) summaries.push("Add to " + teamAdds.length + " teams: " + teamAdds.join(", "));
  if (teamRemovals.length === 1) summaries.push("Remove from " + teamRemovals[0]);
  if (teamRemovals.length > 1) summaries.push("Remove from " + teamRemovals.length + " teams: " + teamRemovals.join(", "));
  changes.filter((change) => !/^positions?$/i.test(change.field) && !/^teams?$/i.test(change.field)).forEach((change) => {
    const field = change.field.toLowerCase() === "phone" ? "Phone number" : change.field;
    summaries.push(!change.before && change.after
      ? `Add ${field}: ${change.after}`
      : change.before && !change.after
        ? `Remove ${field}`
        : `Change ${field}: ${change.before} to ${change.after}`);
  });
  return summaries;
};

type MemberReviewCardProps = {
  row: PortableImportRow;
  selected: string;
  onActionChange: (value: string) => void;
  disabled: boolean;
  alreadyCompleted: boolean;
  result?: { status: "created" | "updated" | "unchanged" | "failed"; message?: string };
  actionOpen: boolean;
  onToggleAction: () => void;
  relationshipChoices: Record<string, string>;
  onRelationshipChange: (key: string, value: string) => void;
  teamNames: string[];
  positionNames: string[];
  replaceMode: boolean;
  hasCsvTeamAssignments: boolean;
};

const MemberReviewCard = ({ row, selected, onActionChange, disabled, alreadyCompleted, result, actionOpen, onToggleAction, relationshipChoices, onRelationshipChange, teamNames, positionNames, replaceMode, hasCsvTeamAssignments }: MemberReviewCardProps) => {
  const name = row.record.name || [row.record.firstName, row.record.lastName].filter(Boolean).join(" ") || "Member from row " + row.row;
  const needsReview = row.action === "invalid" || (row.action === "review" && selected === "review") || isUnresolvedMemberReference(row, relationshipChoices);
  const status = result?.status === "created" ? "Added" : result?.status === "updated" ? "Updated" : result?.status === "unchanged" ? "Already up to date" : result?.status === "failed" || needsReview ? "Needs your review" : memberReviewStatus(row, selected);
  const statusClass = status === "Already up to date" || status === "Skip member" ? "text-gray-400" : status === "Needs your review" ? "text-amber-200" : status === "Update member" ? "text-cyan-200" : "text-emerald-200";
  const selectedCandidate = selected.startsWith("update:") ? row.candidates.find((candidate) => "update:" + candidate.id === selected) : undefined;
  const actionOptions = [
    { value: "skip", label: alreadyCompleted ? "Completed (excluded from retry)" : "Skip member" },
    ...(row.action === "review" ? [{ value: "review", label: "Choose an action" }] : []),
    { value: "create", label: "Add as new member" },
    ...(row.matchedId ? [{ value: "update:" + row.matchedId, label: "Update this member" }] : []),
    ...row.candidates.filter((candidate) => candidate.id !== row.matchedId).map((candidate) => ({ value: "update:" + candidate.id, label: "Update " + candidate.name })),
  ];
  const changes = row.changes || [];
  const positionRemovals = changes.filter((change) => change.field.toLowerCase() === "position" && change.before && !change.after).map((change) => change.before);
  return (
    <article className={"rounded-md border p-3 " + (status === "Already up to date" || status === "Skip member" ? "border-gray-800 bg-gray-900/35" : needsReview ? "border-amber-700/70 bg-amber-950/15" : "border-gray-700 bg-gray-900/55")}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-gray-100">{name}<span className={"ml-2 font-medium " + statusClass}>— {status}</span></h3>
          {result?.status === "failed" && <p className="mt-1 text-sm text-red-200">Could not import: {result.message || "Review this file and try again."}</p>}
          {selectedCandidate && <p className="mt-1 text-xs text-gray-300">Updating {selectedCandidate.name}</p>}
          {selected === "create" && row.action === "review" && <p className="mt-1 text-sm text-gray-200">Adding as a new member.</p>}
          {selected.startsWith("update:") && changes.length === 0 && <p className="mt-1 text-sm text-gray-300">No changes are needed.</p>}
          {selected.startsWith("update:") && summarizeMemberChanges(changes).length > 0 && <ul className="mt-2 space-y-1 text-sm text-gray-200">
            {summarizeMemberChanges(changes).map((summary) => <li key={summary} className="break-words">{summary}</li>)}
          </ul>}
          {selected === "create" && <div className="mt-1 break-words text-sm text-gray-300">
            {teamNames.length > 0 && <p>{teamNames.join(", ")}{positionNames.length > 0 ? " · " + positionNames.length + (positionNames.length === 1 ? " position" : " positions") : ""}</p>}
            {positionNames.length > 0 && <p className="mt-1 text-gray-200">{positionNames.join(", ")}</p>}
            {row.record.phone && <p className="mt-1">Phone: {row.record.phone}</p>}
            {row.record.email && <p className="mt-1">Email: {row.record.email}</p>}
          </div>}
          {replaceMode && positionRemovals.length > 0 && <p className="mt-2 rounded border border-amber-700/70 bg-amber-950/25 p-2 text-sm font-medium text-amber-100">Existing positions will be removed: {positionRemovals.join(", ")}. Only positions in {hasCsvTeamAssignments ? "the imported teams" : "the selected team"} are affected.</p>}
        </div>
        {!needsReview && !alreadyCompleted && !disabled && <div className="shrink-0">
          {!actionOpen ? <Button type="button" variant="tertiary" className="min-h-10 px-2" onClick={onToggleAction}>Change</Button> : <Select aria-label={"Action for " + name} selectClassName="min-h-10 w-44 max-w-[45vw] rounded border border-gray-600 bg-gray-900 px-2 text-sm text-white" value={selected} onChange={onActionChange} options={actionOptions} />}
        </div>}
      </div>
      {needsReview && <div className="mt-3 rounded-md border border-amber-700/70 bg-gray-950/65 p-3">
        <p className="text-sm font-medium text-amber-100">{row.candidates.length > 0 ? "We found more than one possible member." : row.action === "invalid" ? "This member cannot be imported yet." : "This information needs your review."}</p>
        <p className="mt-1 text-sm text-gray-200">{row.candidates.length > 0 ? "Choose which member to update, or add a new member." : "Choose an available action or skip this member."}</p>
        <Select aria-label={(row.candidates.length > 0 ? "Choose which member to update or add for " : "Choose an action for ") + name} selectClassName="mt-2 min-h-11 w-full rounded border border-gray-600 bg-gray-900 px-3 text-sm text-white" value={selected} onChange={onActionChange} disabled={disabled || alreadyCompleted || row.action === "invalid"} options={actionOptions} />
      </div>}
      {row.issues.map((issue, index) => <p key={issue.code + "-" + index} className="mt-2 text-sm text-amber-100">{memberIssueMessage(issue)}</p>)}
      {row.issues.filter((issue) => issue.candidates?.length && ["ambiguous_reference", "foreign_or_unknown_reference_id"].includes(issue.code)).map((issue) => {
        const fieldLabel = issue.field === "positions" ? "Position" : issue.field === "teams" ? "Team" : PORTABLE_FIELD_LABELS[issue.field] || issue.field;
        const referenceIndex = issue.referenceIndex ?? 0;
        const key = relationshipChoiceKey(row.row, issue.field, referenceIndex);
        const description = issue.referenceValue ? fieldLabel + ": " + issue.referenceValue : fieldLabel;
        return <div key={"resolve-" + issue.field + "-" + referenceIndex + "-" + issue.code} className="mt-2 grid gap-1 text-sm text-gray-200"><span>{description}</span><Select aria-label={"Choose a local " + fieldLabel.toLowerCase() + " for " + name} selectClassName="min-h-10 w-full rounded border border-gray-600 bg-gray-900 px-2 text-sm text-white" value={relationshipChoices[key] || ""} onChange={(value) => onRelationshipChange(key, value)} options={[{ value: "", label: "Choose a match" }, ...(issue.candidates || []).map((candidate) => ({ value: candidate.id, label: candidate.teamName ? candidate.name + " · " + candidate.teamName : candidate.name }))]} /></div>;
      })}
      <details className="mt-3 rounded border border-gray-700/70 px-2.5 py-2 text-sm text-gray-300" open={needsReview || undefined}>
        <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">More details</summary>
        {changes.length > 0 && <div className="mt-2"><h4 className="font-medium text-gray-200">Field changes</h4><dl className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">{changes.map((change, index) => <Fragment key={change.field + "-" + index}><dt>{change.field}</dt><dd className="break-words">{change.before || "No saved value"} → {change.after || "Remove"}</dd></Fragment>)}</dl></div>}
        {row.sourceValues && Object.keys(row.sourceValues).length > 0 && <div className="mt-2"><h4 className="font-medium text-gray-200">Original CSV information</h4><dl className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">{Object.entries(row.sourceValues).filter(([, value]) => String(value || "").trim()).map(([label, value]) => <Fragment key={row.row + "-" + label}><dt>{label}</dt><dd className="break-words">{value}</dd></Fragment>)}</dl></div>}
        {selected.startsWith("update:") && <p className="mt-2 text-xs text-gray-400">Other team memberships and positions outside this import are preserved.</p>}
      </details>
    </article>
  );
};

const relationshipChoiceKey = (row: number, field: string, referenceIndex = 0) => `${row}:${field}:${referenceIndex}`;
const positionChoiceKey = (teamId: string, sourceValue: string) => JSON.stringify([teamId.trim(), sourceValue.trim().normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ")]);
const teamChoiceKey = (sourceValue: string) => sourceValue.trim().normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
const teamDestinationLabel = (team: { name: string; isNew?: boolean; ignored?: boolean }) =>
  `${team.name} (${team.ignored ? "ignored team" : team.isNew ? "new" : "existing"})`;
const positionIssueChoiceKey = (issue: PortableImportIssue) => {
  const ownerKey = issue.teamId || (issue.teamOptions || []).map((option) => option.teamId).sort().join(",");
  return positionChoiceKey(ownerKey, issue.referenceValue || "");
};
const positionIssueGroups = (rows: PortableImportRow[]) => {
  const groups = new Map<string, {
    teamId: string;
    teamName: string;
    teamIsNew?: boolean;
    sourceValue: string;
    memberRows: Set<number>;
    options: Map<string, { id: string; name: string; teamId?: string; teamName?: string }>;
    teamOptions: Map<string, { teamId: string; name: string; isNew?: boolean; ignored?: boolean }>;
  }>();
  rows.forEach((row) => row.issues.filter((issue) => issue.field === "positions"
    && (issue.teamId || issue.teamOptions?.length)
    && ["missing_reference", "ambiguous_reference", "foreign_or_unknown_reference_id"].includes(issue.code)).forEach((issue) => {
    const key = positionIssueChoiceKey(issue);
    const group = groups.get(key) || {
      teamId: issue.teamId || "",
      teamName: issue.teamName || "Choose the owning team",
      teamIsNew: issue.teamIsNew,
      sourceValue: issue.referenceValue || "",
      memberRows: new Set<number>(),
      options: new Map(),
      teamOptions: new Map(),
    };
    group.memberRows.add(row.row);
    (issue.teamOptions || []).forEach((option) => group.teamOptions.set(option.teamId, option));
    (issue.positionOptions || issue.candidates || []).forEach((option) => group.options.set(option.id, {
      id: option.id,
      name: option.name,
      teamId: option.teamId,
      teamName: option.teamName,
    }));
    groups.set(key, group);
  }));
  return [...groups.entries()].map(([key, group]) => ({
    ...group,
    key,
    options: [...group.options.values()],
    teamOptions: [...group.teamOptions.values()],
  }));
};

const PortableDataImportDialog = ({ open, onOpenChange, churchId, type, onImported, teams = [], destinationTeamId: initialTeamId }: PortableDataImportDialogProps) => {
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const inspectionRequestRef = useRef(0);
  const previewGenerationRef = useRef(0);
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [inspection, setInspection] = useState<ImportInspection | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rowChoices, setRowChoices] = useState<Record<number, string>>({});
  const [relationshipChoices, setRelationshipChoices] = useState<Record<string, string>>({});
  const [positionChoices, setPositionChoices] = useState<Record<string, { action: "match" | "create" | "ignore" | ""; positionId: string; name: string; teamId: string }>>({});
  const [positionFieldErrors, setPositionFieldErrors] = useState<Record<string, { field: "owner" | "action" | "position" | "name"; message: string }>>({});
  const [teamChoices, setTeamChoices] = useState<Record<string, { action: "match" | "create" | "ignore" | ""; teamId: string; name: string }>>({});
  const [approvedTeamActions, setApprovedTeamActions] = useState<PortableTeamAction[]>([]);
  const [approvedTeamRows, setApprovedTeamRows] = useState<Record<string, number[]>>({});
  const [teamStep, setTeamStep] = useState(false);
  const [teamResolutionPreview, setTeamResolutionPreview] = useState<Preview | null>(null);
  const [approvedPositionActions, setApprovedPositionActions] = useState<PortablePositionAction[]>([]);
  const [approvedPositionRows, setApprovedPositionRows] = useState<Record<string, number[]>>({});
  const [positionStep, setPositionStep] = useState(false);
  const [positionResolutionPreview, setPositionResolutionPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"attention" | "error" | "success">("attention");
  const [commitResults, setCommitResults] = useState<Array<{ row: number; status: "created" | "updated" | "unchanged" | "failed"; message?: string; code?: string }>>([]);
  const [explicitSkips, setExplicitSkips] = useState<Record<number, boolean>>({});
  const [createdPositionCount, setCreatedPositionCount] = useState(0);
  const [createdTeamCount, setCreatedTeamCount] = useState(0);
  const [previewPage, setPreviewPage] = useState(0);
  const [memberReviewFilter, setMemberReviewFilter] = useState<MemberReviewFilter>("all");
  const [changingMemberAction, setChangingMemberAction] = useState<number | null>(null);
  const [destinationTeamId, setDestinationTeamId] = useState(initialTeamId || "");
  const [updateMode, setUpdateMode] = useState<"merge" | "replace">("merge");
  const [clearBlankScalars, setClearBlankScalars] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const currentType = PORTABLE_DATA_TYPES.find((item) => item.id === type)!;
  const mappings = inspection?.mapping || {};
  const missingRequiredFields = currentType.required.filter((field) => !mappings[field]);
  const mappedTeamsColumn = mappings.teams;
  const missingTeamCount = inspection
    ? mappedTeamsColumn
      ? inspection.columnStats[mappedTeamsColumn]?.blank ?? inspection.rowCount
      : inspection.rowCount
    : 0;
  const needsDestinationTeam = type === "members" && missingTeamCount > 0;
  const hasCsvTeamAssignments = Boolean(mappedTeamsColumn && inspection?.columnStats[mappedTeamsColumn]?.nonBlank);
  const importDestinationTeamId = needsDestinationTeam ? destinationTeamId : "";
  const activeTeams = teams.filter((team) => !team.archivedAt);
  const teamGroups = (() => {
    const groups = new Map<string, { sourceValue: string; memberRows: Set<number>; options: Map<string, string> }>();
    (teamResolutionPreview?.rows || preview?.rows || []).forEach((row) => row.issues.filter((issue) => issue.field === "teams" && ["missing_reference", "ambiguous_reference", "foreign_or_unknown_reference_id"].includes(issue.code)).forEach((issue) => {
      const sourceValue = issue.referenceValue || "";
      const key = teamChoiceKey(sourceValue);
      const group = groups.get(key) || { sourceValue, memberRows: new Set<number>(), options: new Map<string, string>() };
      group.memberRows.add(row.row);
      (issue.candidates || []).forEach((option) => group.options.set(option.id, option.name));
      groups.set(key, group);
    }));
    return [...groups.entries()].map(([key, group]) => ({ ...group, key, options: [...group.options].map(([id, name]) => ({ id, name })) }));
  })();
  const positionGroups = positionIssueGroups(preview?.rows || []);
  const invalidatePreview = () => {
    previewGenerationRef.current += 1;
    setPreview(null);
    setRowChoices({});
    setRelationshipChoices({});
    setPositionChoices({});
    setPositionFieldErrors({});
    setTeamChoices({});
    setApprovedTeamActions([]);
    setApprovedTeamRows({});
    setTeamStep(false);
    setTeamResolutionPreview(null);
    setApprovedPositionActions([]);
    setApprovedPositionRows({});
    setPositionStep(false);
    setPositionResolutionPreview(null);
    setCommitResults([]);
    setExplicitSkips({});
    setCreatedPositionCount(0);
    setCreatedTeamCount(0);
    setMemberReviewFilter("all");
    setChangingMemberAction(null);
  };
  useEffect(() => {
    if (!open) {
      inspectionRequestRef.current += 1;
      previewGenerationRef.current += 1;
      return;
    }
    setDestinationTeamId(initialTeamId || "");
    setPreview(null);
    setRowChoices({});
    setRelationshipChoices({});
    setPositionChoices({});
    setPositionFieldErrors({});
    setTeamChoices({});
    setApprovedTeamActions([]);
    setApprovedTeamRows({});
    setTeamStep(false);
    setTeamResolutionPreview(null);
    setApprovedPositionActions([]);
    setApprovedPositionRows({});
    setPositionStep(false);
    setPositionResolutionPreview(null);
    setCommitResults([]);
    setExplicitSkips({});
    setCreatedPositionCount(0);
    setCreatedTeamCount(0);
    setMemberReviewFilter("all");
    setChangingMemberAction(null);
    setBusy(null);
  }, [open, initialTeamId]);
  const selectedRows = useMemo(() => (preview?.rows || []).filter((row) => {
    const choice = rowChoices[row.row] || (row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : row.action === "review" ? "review" : "skip");
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
  const selectedCreateCount = selectedRows.filter((row) => !(rowChoices[row.row] || (row.action === "update" ? `update:${row.matchedId}` : "create")).startsWith("update:")).length;
  const selectedUpdateRows = selectedRows.filter((row) => (rowChoices[row.row] || (row.action === "update" ? `update:${row.matchedId}` : "create")).startsWith("update:"));
  const unchangedCount = selectedUpdateRows.filter((row) => !(row.changes || []).length).length;
  const selectedUpdateCount = selectedUpdateRows.length - unchangedCount;
  const skippedCount = (preview?.rows || []).filter((row) => !commitResults.some((result) => result.row === row.row && result.status !== "failed") && (explicitSkips[row.row] || (rowChoices[row.row] === "skip" && row.action !== "invalid"))).length;
  const memberReviewCounts = (preview?.rows || []).reduce((counts, row) => {
    const selected = rowChoices[row.row] || (row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : row.action === "review" ? "review" : "skip");
    const outcome = commitResults.find((result) => result.row === row.row);
    if (outcome && outcome.status !== "failed") return counts;
    if (outcome?.status === "failed") { counts.review += 1; return counts; }
    if (row.action === "invalid" || (row.action === "review" && selected === "review") || isUnresolvedMemberReference(row, relationshipChoices)) counts.review += 1;
    else if (selected === "skip") counts.skipped += 1;
    else if (selected.startsWith("update:")) {
      if ((row.changes || []).length) counts.updates += 1;
    } else if (selected === "create") counts.new += 1;
    return counts;
  }, { new: 0, updates: 0, review: 0, skipped: 0 });
  const filteredMemberRows = (preview?.rows || []).filter((row) => {
    const selected = rowChoices[row.row] || (row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : row.action === "review" ? "review" : "skip");
    const outcome = commitResults.find((result) => result.row === row.row);
    if (outcome && outcome.status !== "failed" && memberReviewFilter !== "all") return false;
    const needsReview = outcome?.status === "failed" || row.action === "invalid" || (row.action === "review" && selected === "review") || isUnresolvedMemberReference(row, relationshipChoices);
    if (memberReviewFilter === "new") return !needsReview && selected === "create";
    if (memberReviewFilter === "updates") return !needsReview && selected.startsWith("update:") && Boolean(row.changes?.length);
    if (memberReviewFilter === "review") return needsReview;
    if (memberReviewFilter === "skipped") return !needsReview && selected === "skip";
    return true;
  });
  const reviewRows = type === "members" ? filteredMemberRows : preview?.rows || [];
  const visibleReviewRows = reviewRows.slice(previewPage * 50, previewPage * 50 + 50);
  const activePositionActions = approvedPositionActions.filter((action) => selectedRows.some((row) => approvedPositionRows[positionChoiceKey(action.teamId, action.sourceValue)]?.includes(row.row)));
  const activeTeamActions = approvedTeamActions.filter((action) => selectedRows.some((row) => approvedTeamRows[teamChoiceKey(action.sourceValue)]?.includes(row.row)));
  const plannedPositionRemovals = selectedRows.reduce((count, row) => count + (row.changes || []).filter((change) => change.field === "Position" && change.before && !change.after).length, 0);
  const ignoredSourceFields = preview ? [
    ["Skill tiers", preview.rows.some((row) => Boolean(row.record.skillTiers?.trim()))],
    ["Timezone", preview.rows.some((row) => Boolean(row.record.timezone?.trim()))],
    ["SMS Opt-In", preview.rows.some((row) => Boolean(row.record.smsOptIn?.trim()))],
  ].filter(([, included]) => included).map(([label]) => label as string) : [];

  const handleFile = async (file?: File) => {
    if (!file) return;
    const requestId = ++inspectionRequestRef.current;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setInspection(null);
      invalidatePreview();
      setCsv("");
      setFileName("");
      setMappingOpen(false);
      setBusy(null);
      setMessage("Choose a .csv file to continue.");
      setMessageType("error");
      return;
    }
    invalidatePreview();
    setInspection(null);
    setFileName(file.name);
    setBusy("inspect");
    setMessage("");
    setMessageType("attention");
    try {
      const contents = await file.text();
      const result = await inspectPortableImport(churchId, type, contents);
      if (requestId !== inspectionRequestRef.current) return;
      setCsv(contents);
      setInspection(result);
      setMappingOpen(false);
      invalidatePreview();
      setRowChoices({});
      setRelationshipChoices({});
      setCommitResults([]);
      if (result.issues.length) {
        setMessage(result.issues.map((issue) => `Row ${issue.row}: ${issue.message}`).join(" "));
        setMessageType("attention");
      }
    } catch (error) {
      if (requestId !== inspectionRequestRef.current) return;
      setMessage(error instanceof Error ? error.message : "Could not read this CSV. Check the file and try again.");
      setMessageType("error");
    } finally {
      if (requestId === inspectionRequestRef.current) setBusy(null);
    }
  };

  const handlePreview = async () => {
    if (!inspection || busy) return;
    if (needsDestinationTeam && !destinationTeamId) {
      setMessage("Select a team before reviewing these members.");
      setMessageType("attention");
      return;
    }
    const previewGeneration = previewGenerationRef.current;
    const recheckingStalePreview = commitResults.some((item) => item.status === "failed" && item.code === "stale_preview");
    setBusy("preview");
    setMessage(recheckingStalePreview ? "This preview is stale. Review the refreshed changes before retrying." : "");
    setMessageType("attention");
    try {
      const result = await previewPortableImport(churchId, type, csv, mappings, undefined, {
        ...(importDestinationTeamId ? { destinationTeamId: importDestinationTeamId } : {}), updateMode, clearBlankScalars,
        ...(approvedTeamActions.length ? { teamActions: approvedTeamActions } : {}),
        ...(approvedPositionActions.length ? { positionActions: approvedPositionActions } : {}),
      });
      if (previewGeneration !== previewGenerationRef.current) return;
      const successfulRows = new Set(commitResults.filter((item) => item.status !== "failed").map((item) => item.row));
      setPreview(result);
      setPreviewPage(0);
      setRelationshipChoices({});
      const initialPositionChoices: typeof positionChoices = {};
      positionIssueGroups(result.rows).forEach((group) => {
        initialPositionChoices[group.key] = { action: "", positionId: "", name: group.sourceValue, teamId: group.teamId };
      });
      const nextPositionChoices = { ...initialPositionChoices };
      positionIssueGroups(result.rows).forEach((group) => {
        const previous = positionChoices[group.key];
        if (!previous) return;
        const ownerOptions = group.teamOptions.length ? group.teamOptions : group.teamId
          ? [{ teamId: group.teamId, name: group.teamName, isNew: group.teamIsNew }]
          : [];
        const selectedTeamId = previous.teamId || group.teamId || (ownerOptions.length === 1 ? ownerOptions[0].teamId : "");
        if (ownerOptions.length && !ownerOptions.some((option) => option.teamId === selectedTeamId)) return;
        const scopedOptions = group.options.filter((option) => !option.teamId || option.teamId === selectedTeamId);
        if (previous.action === "match" && !scopedOptions.some((option) => option.id === previous.positionId)) return;
        nextPositionChoices[group.key] = previous;
      });
      if (Object.keys(initialPositionChoices).length || !approvedPositionActions.length) setPositionChoices(nextPositionChoices);
      const initialTeamChoices: typeof teamChoices = {};
      const initialTeamRows: Record<string, number[]> = {};
      result.rows.forEach((row) => row.issues.filter((issue) => issue.field === "teams" && issue.referenceValue).forEach((issue) => {
        const key = teamChoiceKey(issue.referenceValue!);
        initialTeamChoices[key] = initialTeamChoices[key] || { action: "", teamId: "", name: issue.referenceValue! };
        initialTeamRows[key] = [...new Set([...(initialTeamRows[key] || []), row.row])];
      }));
      const nextTeamChoices = { ...initialTeamChoices };
      Object.entries(initialTeamChoices).forEach(([key, initial]) => {
        const previous = teamChoices[key];
        if (!previous) return;
        nextTeamChoices[key] = previous;
      });
      setTeamChoices(Object.keys(initialTeamChoices).length || !approvedTeamActions.length
        ? nextTeamChoices
        : teamChoices);
      if (Object.keys(initialTeamRows).length || !approvedTeamActions.length) setApprovedTeamRows(initialTeamRows);
      const needsTeamResolution = Object.keys(initialTeamChoices).length > 0;
      const needsPositionResolution = Object.keys(initialPositionChoices).length > 0;
      if (!approvedTeamActions.length) setTeamResolutionPreview(needsTeamResolution ? result : null);
      setTeamStep(needsTeamResolution);
      setPositionStep(!needsTeamResolution && needsPositionResolution);
      if (!approvedPositionActions.length && needsPositionResolution) setPositionResolutionPreview(result);
      // Keep the exact decisions that were signed into this successful preview.
      // Filtering them here would make the next commit disagree with its token.
      setCommitResults((current) => current.filter((item) => item.status !== "failed"));
      setExplicitSkips({});
      setRowChoices(Object.fromEntries(result.rows.map((row) => [row.row, successfulRows.has(row.row) ? "skip" : row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : row.action === "review" ? "review" : "skip"])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not validate this CSV. Check the file and try again.");
      setMessageType("error");
    } finally {
      if (previewGeneration === previewGenerationRef.current) setBusy(null);
    }
  };

  const updateTeamChoice = (key: string, choice: typeof teamChoices[string]) => {
    setTeamChoices((current) => ({ ...current, [key]: choice }));
    setApprovedTeamActions([]);
    setApprovedTeamRows({});
    setPositionFieldErrors({});
    setApprovedPositionActions([]);
    setApprovedPositionRows({});
    setPositionResolutionPreview(null);
    setPositionStep(false);
  };

  const handleApplyTeamActions = async () => {
    if (!preview || busy) return;
    const previewGeneration = previewGenerationRef.current;
    const actions: PortableTeamAction[] = [];
    for (const group of teamGroups) {
      const choice = teamChoices[group.key];
      if (!choice?.action || (choice.action === "match" && !choice.teamId) || (choice.action === "create" && !choice.name.trim())) {
        setMessage(`Choose how to handle team ${group.sourceValue}.`);
        setMessageType("attention");
        return;
      }
      actions.push({ sourceValue: group.sourceValue, action: choice.action, ...(choice.action === "match" ? { teamId: choice.teamId } : {}), ...(choice.action === "create" ? { name: choice.name.trim() } : {}) });
    }
    setBusy("team-preview");
    setMessage("");
    setMessageType("attention");
    try {
      const result = await previewPortableImport(churchId, type, csv, mappings, undefined, {
        ...(importDestinationTeamId ? { destinationTeamId: importDestinationTeamId } : {}), updateMode, clearBlankScalars, teamActions: actions,
      });
      if (previewGeneration !== previewGenerationRef.current) return;
      setApprovedTeamActions(actions);
      setApprovedTeamRows(Object.fromEntries(teamGroups.map((group) => [group.key, [...group.memberRows]])));
      setPreview(result);
      setPreviewPage(0);
      setRelationshipChoices({});
      const initialPositionChoices: typeof positionChoices = {};
      positionIssueGroups(result.rows).forEach((group) => {
        const initial = { action: "" as const, positionId: "", name: group.sourceValue, teamId: group.teamId };
        const previous = positionChoices[group.key];
        const ownerOptions = group.teamOptions.length ? group.teamOptions : group.teamId
          ? [{ teamId: group.teamId, name: group.teamName, isNew: group.teamIsNew }]
          : [];
        const selectedTeamId = previous?.teamId || group.teamId || (ownerOptions.length === 1 ? ownerOptions[0].teamId : "");
        const ownerStillEligible = !previous || !ownerOptions.length || ownerOptions.some((option) => option.teamId === selectedTeamId);
        const scopedOptions = group.options.filter((option) => !option.teamId || option.teamId === selectedTeamId);
        const positionStillEligible = previous?.action !== "match" || scopedOptions.some((option) => option.id === previous.positionId);
        initialPositionChoices[group.key] = previous && ownerStillEligible && positionStillEligible
          ? previous
          : initial;
      });
      setPositionChoices(initialPositionChoices);
      setApprovedPositionActions([]);
      setApprovedPositionRows({});
      const hasPositionIssues = Object.keys(initialPositionChoices).length > 0;
      setPositionResolutionPreview(hasPositionIssues ? result : null);
      setTeamStep(false);
      setPositionStep(hasPositionIssues);
      setRowChoices(Object.fromEntries(result.rows.map((row) => [row.row, row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : row.action === "review" ? "review" : "skip"])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not apply these team decisions. Review the file again.");
      setMessageType("error");
    } finally {
      if (previewGeneration === previewGenerationRef.current) setBusy(null);
    }
  };

  const handleApplyPositionActions = async () => {
    if (!preview || busy) return;
    const previewGeneration = previewGenerationRef.current;
    const actions: PortablePositionAction[] = [];
    const fieldErrors: typeof positionFieldErrors = {};
    for (const group of positionGroups) {
      const choice = positionChoices[group.key];
      const selectedTeamId = choice?.teamId || group.teamId || (group.teamOptions.length === 1 ? group.teamOptions[0].teamId : "");
      const ownerOptions = group.teamOptions.length ? group.teamOptions : group.teamId ? [{ teamId: group.teamId, name: group.teamName }] : [];
      const selectedOwner = ownerOptions.find((option) => option.teamId === selectedTeamId);
      if (!selectedTeamId || !selectedOwner) fieldErrors[group.key] = { field: "owner", message: ownerOptions.length ? "Choose the team that owns this position." : "No eligible team is available. Go back and resolve a team first." };
      else if (!choice?.action) fieldErrors[group.key] = { field: "action", message: "Choose how to handle this position." };
      else if (choice.action === "match" && !choice.positionId) fieldErrors[group.key] = { field: "position", message: "Choose an existing position." };
      else if (choice.action === "create" && !choice.name.trim()) fieldErrors[group.key] = { field: "name", message: "Enter a name for the new position." };
      if (fieldErrors[group.key]) continue;
      const selectedTeamName = selectedOwner?.name;
      actions.push({ teamId: selectedTeamId, ...(selectedTeamName && selectedTeamName !== "Choose the owning team" ? { teamName: selectedTeamName } : {}), sourceValue: group.sourceValue, action: choice.action as "match" | "create" | "ignore", ...(choice.action === "match" ? { positionId: choice.positionId, name: group.options.find((option) => option.id === choice.positionId)?.name } : {}), ...(choice.action === "create" ? { name: choice.name.trim() } : {}) });
    }
    setPositionFieldErrors(fieldErrors);
    const firstError = Object.entries(fieldErrors)[0];
    if (firstError) {
      setMessage(firstError[1].message);
      setMessageType("error");
      return;
    }
    setBusy("position-preview");
    setMessage("");
    setMessageType("attention");
    try {
      const result = await previewPortableImport(churchId, type, csv, mappings, undefined, {
        ...(importDestinationTeamId ? { destinationTeamId: importDestinationTeamId } : {}), updateMode, clearBlankScalars, positionActions: actions,
        ...(approvedTeamActions.length ? { teamActions: approvedTeamActions } : {}),
      });
      if (previewGeneration !== previewGenerationRef.current) return;
      setApprovedPositionActions(actions);
      setApprovedPositionRows(Object.fromEntries(actions.map((action) => [positionChoiceKey(action.teamId, action.sourceValue), [...(positionGroups.find((group) => group.sourceValue === action.sourceValue && (group.teamId === action.teamId || group.teamOptions.some((option) => option.teamId === action.teamId)))?.memberRows || [])]])));
      setPreview(result);
      setPreviewPage(0);
      setPositionStep(false);
      setRowChoices(Object.fromEntries(result.rows.map((row) => [row.row, row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : row.action === "review" ? "review" : "skip"])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not apply these position decisions. Review the file again.");
      setMessageType("error");
    } finally {
      if (previewGeneration === previewGenerationRef.current) setBusy(null);
    }
  };

  const handleBackToTeams = () => {
    if (!teamResolutionPreview) return;
    previewGenerationRef.current += 1;
    setBusy(null);
    setPreview(teamResolutionPreview);
    setTeamStep(true);
    setPositionStep(false);
    setApprovedPositionActions([]);
    setApprovedPositionRows({});
    setPositionFieldErrors({});
  };

  const handleBackToPositions = () => {
    if (!positionResolutionPreview) return;
    previewGenerationRef.current += 1;
    setBusy(null);
    setPreview(positionResolutionPreview);
    setTeamStep(false);
    setPositionStep(true);
    setApprovedPositionActions([]);
    setApprovedPositionRows({});
  };

  const returnToSetup = () => {
    previewGenerationRef.current += 1;
    setBusy(null);
    setPreview(null);
    setRowChoices({});
    setRelationshipChoices({});
    setPositionChoices({});
    setApprovedPositionActions([]);
    setApprovedPositionRows({});
    setPositionStep(false);
    setPositionResolutionPreview(null);
  };

  const handleCommit = async () => {
    if (!preview || selectedRows.length === 0 || busy) return;
    setBusy("commit");
    setMessage("");
    setMessageType("attention");
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
        ...(importDestinationTeamId ? { destinationTeamId: importDestinationTeamId } : {}), updateMode, clearBlankScalars,
        ...(type === "members" ? { previewCsvHash: preview.previewCsvHash, mapping: mappings } : {}),
        ...(preview.previewToken ? { previewToken: preview.previewToken } : {}),
        ...(approvedTeamActions.length ? { teamActions: approvedTeamActions } : {}),
        ...(approvedPositionActions.length ? { positionActions: approvedPositionActions } : {}),
      });
      const resultByRow = new Map(commitResults.map((item) => [item.row, item]));
      result.results.forEach((item) => resultByRow.set(item.row, item));
      const combinedResults = [...resultByRow.values()];
      let refreshFailed = false;
      if (result.results.some((item) => item.status === "created" || item.status === "updated") || (result.summary.teamsCreated || 0) > 0 || (result.summary.positionsCreated || 0) > 0) {
        try {
          await onImported?.();
        } catch {
          refreshFailed = true;
        }
      }
      setCommitResults(combinedResults);
      setCreatedPositionCount((count) => Math.max(count, result.summary.positionsCreated || 0));
      setCreatedTeamCount((count) => Math.max(count, result.summary.teamsCreated || 0));
      setRowChoices((current) => {
        const next = { ...current };
        result.results.filter((item) => item.status !== "failed").forEach((item) => { next[item.row] = "skip"; });
        return next;
      });
      const hasFailures = combinedResults.some((item) => item.status === "failed") || !result.success;
      const hasCompletedRows = combinedResults.some((item) => item.status !== "failed")
        || (result.summary.teamsCreated || 0) > 0
        || (result.summary.positionsCreated || 0) > 0;
      const teamsCreatedForImport = Math.max(createdTeamCount, result.summary.teamsCreated || 0);
      const positionsCreatedForImport = Math.max(createdPositionCount, result.summary.positionsCreated || 0);
      const createdDependencySummary = [
        teamsCreatedForImport ? `${teamsCreatedForImport} ${teamsCreatedForImport === 1 ? "team" : "teams"}` : "",
        positionsCreatedForImport ? `${positionsCreatedForImport} ${positionsCreatedForImport === 1 ? "position" : "positions"}` : "",
      ].filter(Boolean).join(" and ");
      const resultMessage = hasFailures
        ? hasCompletedRows
          ? `Import partially completed.${createdDependencySummary ? ` ${createdDependencySummary} created for this import.` : ""} Review the failed rows below.`
          : "Import failed. Review the results and try again."
        : `Import finished. Review the results below.${refreshFailed ? " The data was saved, but this page could not refresh. Reload to see the latest data." : ""}`;
      setMessage(resultMessage);
      setMessageType(hasFailures ? (hasCompletedRows ? "attention" : "error") : "success");
      const completedRows = new Set(combinedResults.filter((item) => item.status !== "failed").map((item) => item.row));
      const allRowsResolved = preview.rows.every((row) => completedRows.has(row.row) || explicitSkips[row.row] || (rowChoices[row.row] === "skip" && row.action !== "invalid"));
      if (!hasFailures && allRowsResolved) {
        const created = combinedResults.filter((item) => item.status === "created").length;
        const updated = combinedResults.filter((item) => item.status === "updated").length;
        const unchanged = combinedResults.filter((item) => item.status === "unchanged").length;
        const skipped = skippedCount;
        const entity = currentType.label;
        const counts = [created ? `${created} added` : "", updated ? `${updated} updated` : "", unchanged ? `${unchanged} unchanged` : "", skipped ? `${skipped} skipped` : "", teamsCreatedForImport ? `${teamsCreatedForImport} ${teamsCreatedForImport === 1 ? "team" : "teams"} created for this import` : "", positionsCreatedForImport ? `${positionsCreatedForImport} ${positionsCreatedForImport === 1 ? "position" : "positions"} created for this import` : ""].filter(Boolean).join(" · ");
        const title = created && !updated && !unchanged && !skipped ? `${entity} imported successfully` : created || updated || skipped ? "Import completed" : "No changes needed";
        const summary = title === "No changes needed" ? `All ${unchanged} ${entity.toLowerCase()} are already up to date.` : counts;
        showToast(refreshFailed ? `${title}. ${summary}. The page could not refresh; reload to see changes.` : `${title}. ${summary}.`, refreshFailed ? "warning" : "success");
        onOpenChange(false);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import these rows. Check the connection and try again.");
      setMessageType("error");
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async (dataType: PortableDataType | "all", template = false) => {
    const key = `${template ? "template-" : "export-"}${dataType}`;
    setBusy(key);
    setMessage("");
    setMessageType("attention");
    try {
      const result = await downloadPortableData(churchId, dataType, template, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      downloadBlob(result.blob, result.filename);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not download this file. Check the connection and try again.");
      setMessageType("error");
    } finally {
      setBusy(null);
    }
  };

  const downloadRecoveryRows = () => {
    if (!preview) return;
    const outcomes = new Map(commitResults.map((result) => [result.row, result]));
    const rows: Array<Record<string, string>> = preview.rows.flatMap((row): Array<Record<string, string>> => {
      const outcome = outcomes.get(row.row);
      const skipped = !outcome && (explicitSkips[row.row] || (rowChoices[row.row] === "skip" && row.action !== "invalid"));
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

  const activeStep = !inspection ? 1 : preview && !teamStep && !positionStep && commitResults.length > 0 ? 4 : preview && !teamStep && !positionStep ? 3 : 2;
  const stepLabel = activeStep === 1 ? "Choose file" : activeStep === 2 ? "Match information" : activeStep === 3 ? "Review" : "Finish";
  const eligibleFailedRows = selectedRows.filter((row) => commitResults.some((result) => result.row === row.row && result.status === "failed")).length;
  const requiresRepreview = commitResults.some((result) => result.status === "failed" && result.code === "stale_preview");
  const importableCount = type === "members" ? selectedCreateCount + selectedUpdateCount : selectedRows.length;
  const commitButtonLabel = eligibleFailedRows === selectedRows.length && eligibleFailedRows > 0
    ? `Retry ${eligibleFailedRows} failed ${eligibleFailedRows === 1 ? "row" : "rows"}`
    : updateMode === "replace" && selectedRows.some((row) => (row.changes || []).some((change) => change.field === "Position" && change.before && !change.after))
      ? `Replace positions and import ${selectedRows.length} ${selectedRows.length === 1 ? "member" : "members"}`
      : type === "members" ? (selectedCreateCount === 0 && selectedUpdateCount === 0 && unchangedCount > 0 ? "Finish review" : `Import ${importableCount} ${selectedUpdateCount > 0 ? importableCount === 1 ? "change" : "changes" : importableCount === 1 ? "member" : "members"}`) : `Import ${selectedRows.length} ${selectedRows.length === 1 ? "row" : "rows"}`;

  return (
    <Modal isOpen={open} onClose={() => onOpenChange(false)} busy={busy === "commit"}
      title={type === "members" ? "Import members" : `Import ${currentType.label} from CSV`} size="lg"
      description={type === "members" ? "Add new members or update existing ones using a CSV file. You'll review changes before importing." : "Choose a CSV, map its columns, review matches, then confirm the rows to import. Selecting a file never changes your data. Imports do not archive or restore records; skip rows marked Archived."}
      descriptionId={type === "members" ? "member-import-intro" : undefined}
      surfaceClassName="rounded-lg border border-gray-700 bg-gray-900 text-white"
      contentPadding="p-0"
      contentClassName="flex flex-col overflow-hidden">
      <section className="flex min-h-0 flex-1 flex-col text-white">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {type === "members" && <nav aria-label="Import progress" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
            {["Choose file", "Match information", "Review", "Finish"].map((label, index) => <Fragment key={label}>
              {index > 0 && <span aria-hidden="true" className="text-gray-600">›</span>}
              <span aria-current={activeStep === index + 1 ? "step" : undefined} className={activeStep === index + 1 ? "font-semibold text-cyan-200" : ""}>{label}</span>
            </Fragment>)}
          </nav>}
          {type === "members" && <p id="member-import-intro" className="text-sm text-gray-300">Add new members or update existing ones using a CSV file. You'll review changes before importing.</p>}
          <div className={`rounded-lg ${inspection ? "bg-gray-800/60 p-3" : "border border-gray-700 bg-gray-950/40 p-4"}`}>
            {inspection ? <div className="flex flex-wrap items-center justify-between gap-3" aria-live="polite">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-100">CSV ready</p>
                  <p className="break-all text-sm text-gray-200">{fileName}</p>
                  <p className="text-xs text-gray-400">{inspection.rowCount} {type === "members" ? (inspection.rowCount === 1 ? "member" : "members") : (inspection.rowCount === 1 ? "row" : "rows")} · {inspection.columnCount} columns</p>
                </div>
              </div>
              <Button type="button" variant="tertiary" className="shrink-0" onClick={() => inputRef.current?.click()} disabled={Boolean(busy)}>Choose a different file</Button>
            </div> : <>
              <div className="mb-3">
                <p className="text-sm font-semibold text-gray-100">Choose a CSV file</p>
                <p className="mt-1 text-sm text-gray-400">Select a file containing the {type === "members" ? "members" : currentType.label.toLowerCase()} you'd like to import.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="cta" svg={FileUp} onClick={() => inputRef.current?.click()} disabled={Boolean(busy)}>
                  {busy === "inspect" ? "Reading CSV..." : "Choose a CSV file"}
                </Button>
                <Button type="button" variant="tertiary" onClick={() => void handleDownload(type, true)} disabled={Boolean(busy)}>
                  {busy === `template-${type}` ? "Preparing template..." : "Download CSV template"}
                </Button>
              </div>
            </>}
            <input ref={inputRef} className="sr-only" type="file" accept=".csv,text/csv" aria-label="Choose a CSV file" onChange={(event) => { void handleFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
          </div>

        {type === "members" && inspection && !preview && <div className="space-y-4 rounded-lg bg-gray-900/40 p-3">
          <h3 className="text-sm font-semibold text-gray-200">Team and import options</h3>
          {needsDestinationTeam ? <div className="space-y-2">
            <p className="text-sm font-medium text-gray-100">Which team are these members joining?</p>
            <p className="text-sm text-gray-300">We'll add members without a team in the CSV to the selected team and match their categories to its positions.{hasCsvTeamAssignments ? " Team assignments already listed in the CSV will stay as they are." : ""}</p>
            <Select aria-label="Which team are these members joining?" selectClassName="min-h-10 w-full rounded border border-gray-600 bg-gray-900 px-3 text-sm text-white" value={destinationTeamId} onChange={(value) => { setDestinationTeamId(value); invalidatePreview(); }} options={[{ value: "", label: "Select a team" }, ...activeTeams.map((team) => ({ value: team.teamId, label: team.name }))]} required ariaInvalid={!destinationTeamId} disabled={Boolean(busy)} />
            {!destinationTeamId && <p className="text-xs text-gray-300">Select a team to continue.</p>}
            {missingTeamCount > 0 && mappedTeamsColumn && <p className="text-xs text-gray-400">{missingTeamCount} {missingTeamCount === 1 ? "row has" : "rows have"} no team. CSV team assignments will be kept.</p>}
          </div> : hasCsvTeamAssignments ? <p className="text-sm text-gray-300">Team assignments found in your CSV. We'll use those assignments.</p> : null}

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-gray-100">How should positions be updated?</legend>
            <label className={`flex cursor-pointer items-start gap-3 rounded-md p-3 transition-colors focus-within:ring-2 focus-within:ring-cyan-400/70 ${updateMode === "merge" ? "bg-cyan-400/10 ring-1 ring-cyan-400/40" : "bg-gray-900/50 hover:bg-gray-900"}`}>
              <input className="mt-1" type="radio" name="position-update-mode" value="merge" checked={updateMode === "merge"} onChange={() => { setUpdateMode("merge"); invalidatePreview(); }} disabled={Boolean(busy)} />
              <span><span className="block text-sm font-medium">Add positions from the CSV</span><span className="block text-xs text-gray-300">Keep existing positions and add any new ones.</span></span>
            </label>
            <label className={`flex cursor-pointer items-start gap-3 rounded-md p-3 transition-colors focus-within:ring-2 focus-within:ring-cyan-400/70 ${updateMode === "replace" ? "bg-cyan-400/10 ring-1 ring-cyan-400/40" : "bg-gray-900/50 hover:bg-gray-900"}`}>
              <input className="mt-1" type="radio" name="position-update-mode" value="replace" checked={updateMode === "replace"} onChange={() => { setUpdateMode("replace"); invalidatePreview(); }} disabled={Boolean(busy)} />
              <span><span className="block text-sm font-medium">{hasCsvTeamAssignments ? "Replace positions in the imported teams" : "Replace positions in the selected team"}</span><span className="block text-xs text-gray-300">{!mappings.positions ? "This CSV has no Positions or Categories column, so existing positions won't change." : `${hasCsvTeamAssignments ? "Replace positions only for teams included in this import." : "Remove positions in this team that aren't in the CSV."} Positions in other teams won't change. A blank Positions or Categories cell clears positions in the relevant team${hasCsvTeamAssignments ? "s" : ""}.`}</span></span>
            </label>
          </fieldset>

          <div className="rounded-md bg-gray-900/55 p-3">
            <h4 className="text-sm font-semibold text-gray-100">Existing members</h4>
            <p className="mt-1 text-sm text-gray-400">We'll show changes to existing members before importing. Uncertain matches need your review.</p>
          </div>
          <details className="rounded-md bg-gray-900/55 p-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-200">Advanced options</summary>
            <label className="mt-3 flex items-start gap-2 text-sm text-gray-200">
              <input className="mt-1" type="checkbox" checked={clearBlankScalars} onChange={(event) => { setClearBlankScalars(event.currentTarget.checked); invalidatePreview(); }} disabled={Boolean(busy)} />
              <span><span className="block font-medium">Clear existing information when CSV cells are blank</span><span className="mt-1 block text-xs text-gray-300">Normally, blank cells leave existing information unchanged. Turn this on only if you want blank cells to clear applicable saved details such as contact information. This doesn't change positions or team memberships.</span></span>
            </label>
          </details>
        </div>}

        {inspection && !preview && (
          <div className="space-y-4 rounded-lg border border-cyan-400/35 bg-gray-800/65 p-4 shadow-sm shadow-black/20">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-sm font-semibold text-cyan-200" aria-hidden="true">02</span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Step 2</p>
                  <h4 className="text-lg font-semibold leading-tight text-white">{type === "members" ? "Match information" : "Column mapping"}</h4>
                </div>
              </div>
              {type === "members" && <Button type="button" variant="tertiary" onClick={() => setMappingOpen((value) => !value)} aria-expanded={mappingOpen} disabled={Boolean(busy)}>{mappingOpen ? "Hide column mapping" : "Review column mapping"}</Button>}
            </div>
            {type !== "members" && <p className="text-sm text-gray-400">{inspection.rowCount} {inspection.rowCount === 1 ? "row" : "rows"} · {inspection.columnCount} columns detected</p>}
            {(type !== "members" || mappingOpen) && <>
              {type === "members" && <p className="text-sm text-gray-300">Recognized columns are matched automatically. Check them only if something needs to change.</p>}
              <div className="space-y-2">
                {PORTABLE_FIELD_ORDER[type].map((field) => (
                  <div key={field} className="grid gap-1 rounded-md px-2 py-2 sm:grid-cols-[minmax(9rem,0.7fr)_minmax(0,1.3fr)] sm:items-center sm:gap-3">
                    <span className={`text-sm font-medium ${missingRequiredFields.includes(field) ? "text-amber-200" : "text-gray-200"}`}>{PORTABLE_FIELD_LABELS[field] || field}{(type === "members" ? field === "name" ? !mappings.firstName || !mappings.lastName : ["firstName", "lastName"].includes(field) && !mappings.name : currentType.required.includes(field)) && <span className={`ml-1 text-xs ${mappings[field] ? "text-gray-500" : "text-amber-200"}`}>{mappings[field] ? "Mapped" : "Required"}</span>}</span>
                    <Select aria-label={`Column for ${PORTABLE_FIELD_LABELS[field] || field}`} selectClassName="min-h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-sm text-white focus-visible:ring-2 focus-visible:ring-cyan-400/70" value={mappings[field] || ""} onChange={(value) => { setInspection((current) => current ? { ...current, mapping: { ...current.mapping, [field]: value } } : current); invalidatePreview(); }} options={[{ value: "", label: "Ignore this field" }, ...inspection.headers.map((header) => ({ value: header, label: header }))]} disabled={Boolean(busy)} />
                  </div>
                ))}
              </div>
              {type === "members" && <p className="text-sm text-gray-300">{hasCsvTeamAssignments ? "Positions are matched within each team listed in the CSV." : "Categories are matched to positions in the selected team."} Email and phone don't determine member matches.</p>}
              {type !== "members" && <p className="text-xs text-gray-400">For multiple names, use <span className="font-mono"> | </span>, semicolons, or separate lines. Commas split only when each part matches a known name.</p>}
              {type === "members" && <details className="text-xs text-gray-400"><summary className="cursor-pointer">Unmapped columns are ignored</summary><p className="mt-1 break-words">{inspection.headers.filter((header) => !Object.values(mappings).includes(header)).join(", ") || "No unmapped columns."}</p></details>}
              {type !== "members" && <p className="text-sm text-gray-400">Unmapped columns: {inspection.headers.filter((header) => !Object.values(mappings).includes(header)).join(", ") || "None"}. Unmapped values are ignored.</p>}
            </>}
          </div>
        )}

        {preview && teamStep && (
          <div className="space-y-4 rounded-lg border border-cyan-400/40 bg-gray-800/70 p-4 shadow-md shadow-black/20">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-sm font-semibold text-cyan-200" aria-hidden="true">02</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Step 2 · Match information</p>
                <h4 className="text-xl font-semibold leading-tight text-white">Match teams</h4>
                <p className="mt-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-200 ring-1 ring-inset ring-amber-300/25"><CircleAlert size={14} aria-hidden="true" />{teamGroups.length} {teamGroups.length === 1 ? "team needs" : "teams need"} attention</span></p>
                <p className="mt-2 text-sm text-gray-300">Some teams in your CSV weren't found in this church. Choose how to handle each team.</p>
              </div>
            </div>
            {teamGroups.map((group) => {
              const choice = teamChoices[group.key] || { action: "" as const, teamId: "", name: group.sourceValue };
              const options = group.options.length ? group.options : activeTeams.map((team) => ({ id: team.teamId, name: team.name }));
              return <div key={group.key} className="space-y-3 rounded-md bg-gray-900/55 p-3.5 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-base font-semibold text-white">{group.sourceValue}</p>
                    <p className="mt-0.5 text-xs text-gray-400">Used by {group.memberRows.size} {group.memberRows.size === 1 ? "member" : "members"}</p>
                  </div>
                </div>
                <Select aria-label={`How to handle team ${group.sourceValue}`} selectClassName="min-h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-sm text-white focus-visible:ring-2 focus-visible:ring-cyan-400/70" value={choice.action} onChange={(value) => updateTeamChoice(group.key, { ...choice, action: value as typeof choice.action })} options={[{ value: "", label: "Choose an option" }, { value: "match", label: "Match an existing team" }, { value: "create", label: `Create ${group.sourceValue}` }, { value: "ignore", label: "Ignore this team's assignments" }]} disabled={Boolean(busy)} />
                {choice.action === "match" && <Select aria-label={`Existing team for ${group.sourceValue}`} selectClassName="min-h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-sm text-white focus-visible:ring-2 focus-visible:ring-cyan-400/70" value={choice.teamId} onChange={(teamId) => updateTeamChoice(group.key, { ...choice, teamId })} options={[{ value: "", label: "Choose an active team" }, ...options.map((option) => ({ value: option.id, label: option.name }))]} disabled={Boolean(busy)} />}
                {choice.action === "create" && <Input aria-label={`New team name for ${group.sourceValue}`} label="Team name" labelClassName="text-gray-300" value={choice.name} onChange={(name) => updateTeamChoice(group.key, { ...choice, name: String(name) })} inputClassName="border-gray-600 bg-gray-900 text-white focus-visible:border-cyan-400/80 focus-visible:ring-cyan-400/30" disabled={Boolean(busy)} />}
                {choice.action === "ignore" && <p className="text-sm text-gray-300">Members can still be imported, but they won't be assigned to this team or its positions. Existing assignments are preserved, including in Replace mode.</p>}
              </div>;
            })}
          </div>
        )}

        {preview && positionStep && !teamStep && (
          <div className="space-y-4 rounded-lg border border-cyan-400/40 bg-gray-800/70 p-4 shadow-md shadow-black/20">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-sm font-semibold text-cyan-200" aria-hidden="true">02</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Step 2 · Match information</p>
                <h4 className="text-xl font-semibold leading-tight text-white">Match positions</h4>
                <p className="mt-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-200 ring-1 ring-inset ring-amber-300/25"><CircleAlert size={14} aria-hidden="true" />{positionGroups.length} {positionGroups.length === 1 ? "position needs" : "positions need"} attention</span></p>
              <p className="mt-2 text-sm text-gray-300">Choose how to handle positions that aren't yet in their assigned team. When team ownership is unclear, select the team that owns each position.</p>
              </div>
            </div>
            {positionGroups.map((group) => {
              const choice = positionChoices[group.key] || { action: "" as const, positionId: "", name: group.sourceValue, teamId: group.teamId };
              const ownerOptions: Array<{ teamId: string; name: string; isNew?: boolean; ignored?: boolean }> = group.teamOptions.length ? group.teamOptions : group.teamId ? [{ teamId: group.teamId, name: group.teamName, isNew: group.teamIsNew }] : [];
              const selectedTeamId = choice.teamId || (ownerOptions.length === 1 ? ownerOptions[0].teamId : "");
              const selectedOwner = ownerOptions.find((option) => option.teamId === selectedTeamId);
              const selectedOwnerLabel = selectedOwner ? teamDestinationLabel(selectedOwner) : "Choose the owning team";
              const scopedPositionOptions = group.options.filter((option) => !option.teamId || option.teamId === selectedTeamId);
              const selectedAction = choice.action === "create" ? { label: "Create new position", Icon: Plus, style: "bg-cyan-400/10 text-cyan-100 ring-cyan-300/25" } : choice.action === "match" ? { label: "Match existing position", Icon: Link2, style: "bg-cyan-400/10 text-cyan-100 ring-cyan-300/25" } : choice.action === "ignore" ? { label: "Import without position", Icon: Minus, style: "bg-gray-700/60 text-gray-300 ring-white/10" } : null;
              const fieldError = positionFieldErrors[group.key];
              return <div key={group.key} className={`space-y-3 rounded-md bg-gray-900/55 p-3.5 sm:p-4 ${fieldError ? "border border-red-500/70 ring-1 ring-red-500/30" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-base font-semibold text-white">{group.sourceValue}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{group.memberRows.size} {group.memberRows.size === 1 ? "member" : "members"} · Belongs to {selectedOwnerLabel}</p>
                  </div>
                  {selectedAction && <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${selectedAction.style}`}><selectedAction.Icon size={14} aria-hidden="true" />{selectedAction.label}</span>}
                </div>
                {ownerOptions.length > 1 && <Select label="Belongs to" aria-label={`Belongs to for ${group.sourceValue}`} labelClassName="text-gray-300" selectClassName="min-h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-sm text-white focus-visible:ring-2 focus-visible:ring-cyan-400/70" value={selectedTeamId} onChange={(teamId) => { setPositionChoices((current) => ({ ...current, [group.key]: { ...choice, teamId, positionId: "", action: "" } })); setApprovedPositionActions([]); setApprovedPositionRows({}); setPositionFieldErrors((current) => { const next = { ...current }; delete next[group.key]; return next; }); }} options={[{ value: "", label: "Choose the owning team" }, ...ownerOptions.map((option) => ({ value: option.teamId, label: teamDestinationLabel(option) }))]} ariaInvalid={fieldError?.field === "owner"} errorText={fieldError?.field === "owner" ? fieldError.message : undefined} disabled={Boolean(busy)} />}
                {fieldError?.field === "owner" && ownerOptions.length <= 1 && <p className="text-sm text-red-300" role="alert">{fieldError.message}</p>}
                <Select aria-label={`How to handle ${group.sourceValue} in ${selectedOwnerLabel}`} selectClassName="min-h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-sm text-white focus-visible:ring-2 focus-visible:ring-cyan-400/70" value={choice.action} onChange={(value) => { setPositionChoices((current) => ({ ...current, [group.key]: { ...choice, action: value as typeof choice.action } })); setApprovedPositionActions([]); setApprovedPositionRows({}); setPositionFieldErrors((current) => { const next = { ...current }; delete next[group.key]; return next; }); }} options={[{ value: "", label: "Choose an option" }, ...(!selectedOwner?.ignored && scopedPositionOptions.length && selectedTeamId ? [{ value: "match", label: "Match an existing position" }] : []), ...(!selectedOwner?.ignored && selectedTeamId ? [{ value: "create", label: "Create new position" }] : []), { value: "ignore", label: selectedOwner?.ignored ? "Ignore this position with its team" : "Import without this position" }]} ariaInvalid={fieldError?.field === "action"} errorText={fieldError?.field === "action" ? fieldError.message : undefined} disabled={Boolean(busy) || !selectedTeamId} />
                {choice.action === "match" && <Select aria-label={`Existing position for ${group.sourceValue}`} selectClassName="min-h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-sm text-white focus-visible:ring-2 focus-visible:ring-cyan-400/70" value={choice.positionId} onChange={(positionId) => { setPositionChoices((current) => ({ ...current, [group.key]: { ...choice, positionId } })); setApprovedPositionActions([]); setApprovedPositionRows({}); setPositionFieldErrors((current) => { const next = { ...current }; delete next[group.key]; return next; }); }} options={[{ value: "", label: "Choose an active position" }, ...scopedPositionOptions.map((option) => ({ value: option.id, label: option.teamName ? `${option.name} · ${option.teamName}` : option.name }))]} ariaInvalid={fieldError?.field === "position"} errorText={fieldError?.field === "position" ? fieldError.message : undefined} disabled={Boolean(busy) || !selectedTeamId} />}
                {choice.action === "create" && <>
                  <div className="rounded-md bg-gray-950/55 p-3">
                    <Input aria-label={`New position name for ${group.sourceValue}`} label="Position name" labelClassName="text-gray-300" value={choice.name} onChange={(name) => { setPositionChoices((current) => ({ ...current, [group.key]: { ...choice, name: String(name) } })); setApprovedPositionActions([]); setApprovedPositionRows({}); setPositionFieldErrors((current) => { const next = { ...current }; delete next[group.key]; return next; }); }} errorText={fieldError?.field === "name" ? fieldError.message : undefined} inputClassName="border-gray-600 bg-gray-900 text-white focus-visible:border-cyan-400/80 focus-visible:ring-cyan-400/30" disabled={Boolean(busy)} />
                  </div>
                </>}
                {choice.action === "ignore" && <p className="text-sm text-gray-300">These members will be imported without the {group.sourceValue} position. Team membership will still be added.</p>}
              </div>;
            })}
          </div>
        )}

        {preview && !teamStep && !positionStep && (
          <div className="space-y-4 rounded-lg border border-cyan-400/35 bg-gray-800/65 p-4 shadow-sm shadow-black/20">
            <div className="flex items-start gap-3">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-sm font-semibold text-cyan-200" aria-hidden="true">03</span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Step 3 · Review</p>
                  <h4 className="text-xl font-semibold leading-tight text-white">{type === "members" ? "Review your import" : "Review changes"}</h4>
              </div>
            </div>
              <div className={type === "members" ? "hidden" : ""}>
                <p className="text-sm text-gray-300">{preview.summary.total} {preview.summary.total === 1 ? "row" : "rows"} found</p>
                <p className="mt-1 text-sm text-gray-300">{type === "members" ? `${selectedCreateCount} new members · ${selectedUpdateCount} existing members to update` : `${selectedCreateCount} new · ${selectedUpdateCount} to update`} · {unchangedCount} unchanged · {preview.summary.review} need attention · {preview.summary.invalid} invalid · {skippedCount} skipped</p>
            </div>
            {type === "members" && <div>
              <p className="text-sm text-gray-300">Here&apos;s what will change when you import this file.</p>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-100">
                {selectedCreateCount > 0 && <span>{selectedCreateCount} new {selectedCreateCount === 1 ? "member" : "members"}</span>}
                {selectedUpdateCount > 0 && <span>{selectedUpdateCount} {selectedUpdateCount === 1 ? "member" : "members"} updated</span>}
                {unchangedCount > 0 && <span>{unchangedCount} already up to date</span>}
                {skippedCount > 0 && <span>{skippedCount} skipped</span>}
                {memberReviewCounts.review > 0 && <span className="text-amber-200">{memberReviewCounts.review} need your review</span>}
                {activePositionActions.filter((action) => action.action === "create").length > 0 && <span>{activePositionActions.filter((action) => action.action === "create").length} new {activePositionActions.filter((action) => action.action === "create").length === 1 ? "position" : "positions"}</span>}
                {activeTeamActions.filter((action) => action.action === "create").length > 0 && <span>{activeTeamActions.filter((action) => action.action === "create").length} new {activeTeamActions.filter((action) => action.action === "create").length === 1 ? "team" : "teams"}</span>}
              </p>
            </div>}
            {type !== "members" && activePositionActions.length > 0 && <p className="text-sm text-gray-300">Positions: {activePositionActions.filter((action) => action.action === "create").length} new, {activePositionActions.filter((action) => action.action === "match").length} matched, {activePositionActions.filter((action) => action.action === "ignore").length} ignored.</p>}
            {type !== "members" && activeTeamActions.length > 0 && <p className="text-sm text-gray-300">Teams: {activeTeamActions.filter((action) => action.action === "create").length} new, {activeTeamActions.filter((action) => action.action === "match").length} mapped, {activeTeamActions.filter((action) => action.action === "ignore").length} ignored.</p>}
            {type === "members" && updateMode === "replace" && plannedPositionRemovals > 0 && <p className="rounded border border-amber-800 p-3 text-sm text-amber-100">{plannedPositionRemovals} existing position {plannedPositionRemovals === 1 ? "assignment" : "assignments"} will be removed from the imported team scope.</p>}
            {type === "members" && ignoredSourceFields.length > 0 && <details className="rounded border border-gray-700 p-3 text-sm text-gray-200">
              <summary className="cursor-pointer font-medium">Some CSV fields won't be imported</summary>
              <p className="mt-2 text-gray-300">{ignoredSourceFields.join(", ")} are recognized but won't change existing WorshipSync information.</p>
              <p className="mt-1 text-xs text-gray-400">Source values remain available in each member's details. SMS consent protections are unchanged.</p>
            </details>}
            {type === "members" && preview.rows.some((row) => /inactive|archived|disabled|deactivated/i.test(`${row.record.status || ""} ${row.record.archived || ""}`)) && <p className="rounded border border-amber-800 p-3 text-sm text-amber-100">Some source records are inactive or archived. Imports won't archive or restore members; skip rows that should remain unchanged.</p>}
            {type === "members" && updateMode === "replace" && activePositionActions.some((action) => action.action === "ignore") && <p className="rounded border border-amber-800 p-3 text-sm text-amber-100">In Replace mode, existing positions are preserved for members with an ignored position reference.</p>}
            {commitResults.length > 0 && <div className="rounded-md bg-gray-900/60 p-3 text-sm" aria-live="polite">
              <h5 className="flex items-center gap-2 font-semibold"><Check size={16} className="text-emerald-300" aria-hidden="true" />Step 4 · Finish</h5>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium" aria-label="Import result summary">
                <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-200">Created {commitResults.filter((item) => item.status === "created").length}</span>
                <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-cyan-100">Updated {commitResults.filter((item) => item.status === "updated").length}</span>
                <span className="rounded-full bg-gray-700 px-2 py-1 text-gray-200">Unchanged {commitResults.filter((item) => item.status === "unchanged").length}</span>
                <span className="rounded-full bg-red-500/10 px-2 py-1 text-red-200">Failed {commitResults.filter((item) => item.status === "failed").length}</span>
                <span className="rounded-full bg-gray-700 px-2 py-1 text-gray-200">Skipped {Math.max(0, preview.summary.total - commitResults.length)}</span>
                {createdTeamCount > 0 && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-200">Teams created for this import: {createdTeamCount}</span>}
                {createdPositionCount > 0 && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-200">Positions created for this import: {createdPositionCount}</span>}
              </div>
              {type === "members" && (createdTeamCount > 0 || createdPositionCount > 0) && <p className="mt-2 text-xs text-gray-300">These totals include teams and positions created by earlier retries of this import.</p>}
              {type === "members" && <Button type="button" variant="tertiary" className="mt-2" onClick={downloadRecoveryRows}>Download failed and skipped rows</Button>}
            </div>}
            {preview.issues.map((issue) => <p key={`${issue.row}-${issue.code}`} className="text-sm text-red-200">Row {issue.row}: {issue.message}</p>)}
            {type === "members" && <Tabs value={memberReviewFilter} onValueChange={(value) => { setMemberReviewFilter(value as MemberReviewFilter); setPreviewPage(0); }} className="mt-3">
              <div className="scrollbar-variable w-full overflow-x-auto">
                <TabsList variant="line" size="sm" aria-label="Filter members by import status">
                  <TabsTrigger value="all">All {preview.rows.length}</TabsTrigger>
                  <TabsTrigger value="new">New {memberReviewCounts.new}</TabsTrigger>
                  <TabsTrigger value="updates">Updates {memberReviewCounts.updates}</TabsTrigger>
                  <TabsTrigger value="review">Needs review {memberReviewCounts.review}</TabsTrigger>
                  <TabsTrigger value="skipped">Skipped {memberReviewCounts.skipped}</TabsTrigger>
                </TabsList>
              </div>
            </Tabs>}
            <div className="space-y-2">
              {visibleReviewRows.map((row) => {
                const selected = rowChoices[row.row] || (row.action === "create" ? "create" : row.action === "update" ? `update:${row.matchedId}` : row.action === "review" ? "review" : "skip");
                const mustSkip = row.issues.some((issue) => (issue.code === "missing_reference" && ["teams", "positions"].includes(issue.field)) || (issue.code === "required" && issue.field === "team"));
                const fallbackTeamName = !String(row.record.teamIds || "").trim() && !String(row.record.positionIds || "").trim()
                  ? activeTeams.find((team) => team.teamId === destinationTeamId)?.name
                  : "";
                const createDetails = [["Email", row.record.email], ["Phone", row.record.phone], ["Teams", row.record.teams || fallbackTeamName], ["Positions", row.record.positions], ["Notes", row.record.notes]].filter(([, value]) => Boolean(value));
                const outcome = commitResults.find((result) => result.row === row.row);
                const alreadyCompleted = Boolean(outcome && outcome.status !== "failed");
                const selectedAction = outcome ? outcome.status[0].toUpperCase() + outcome.status.slice(1) : row.action === "invalid" ? "Invalid" : row.action === "review" && selected === "review" ? "Needs attention" : selected === "skip" ? "Skipped" : selected.startsWith("update:") ? (row.changes?.length ? "Update" : "Unchanged") : "New member";
                const selectedActionStyle = selectedAction === "Invalid" ? "text-red-200" : selectedAction === "Needs attention" ? "text-amber-200" : selectedAction === "Skipped" || selectedAction === "Unchanged" ? "text-gray-400" : selectedAction === "Update" ? "text-cyan-200" : "text-emerald-200";
                const positionRemovals = (row.changes || []).filter((change) => change.field === "Position" && change.before && !change.after);
                const importedTeamLabel = row.record.teams || fallbackTeamName || "the imported team";
                const plannedPositions = approvedPositionActions.filter((action) => approvedPositionRows[positionChoiceKey(action.teamId, action.sourceValue)]?.includes(row.row));
                const plannedTeams = approvedTeamActions.filter((action) => approvedTeamRows[teamChoiceKey(action.sourceValue)]?.includes(row.row));
                if (type === "members") {
                  const teamNames = plannedTeams.length
                    ? plannedTeams.filter((action) => action.action !== "ignore").map((action) => action.action === "create" ? action.name || action.sourceValue : activeTeams.find((team) => team.teamId === action.teamId)?.name || action.sourceValue)
                    : String(row.record.teams || fallbackTeamName || "").split(/[,;|]/).map((name) => name.trim()).filter(Boolean);
                  const positionNames = plannedPositions.length
                    ? plannedPositions.filter((action) => action.action !== "ignore").map((action) => action.name || action.sourceValue)
                    : String(row.record.positions || "").split(/[,;|]/).map((name) => name.trim()).filter(Boolean);
                  return <MemberReviewCard key={row.row} row={row} selected={selected} onActionChange={(value) => { setRowChoices((current) => ({ ...current, [row.row]: value })); setExplicitSkips((current) => ({ ...current, [row.row]: value === "skip" })); setChangingMemberAction(null); }} disabled={row.action === "invalid" || Boolean(busy)} alreadyCompleted={alreadyCompleted} result={outcome} actionOpen={changingMemberAction === row.row} onToggleAction={() => setChangingMemberAction((current) => current === row.row ? null : row.row)} relationshipChoices={relationshipChoices} onRelationshipChange={(key, value) => setRelationshipChoices((current) => ({ ...current, [key]: value }))} teamNames={[...new Set(teamNames)]} positionNames={[...new Set(positionNames)]} replaceMode={updateMode === "replace"} hasCsvTeamAssignments={hasCsvTeamAssignments} />;
                }
                return (
                  <div key={row.row} className="grid gap-2 rounded border border-gray-700 p-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start">
                    <div className="min-w-0">
                      <p className="text-sm"><span className="font-semibold text-gray-100">{row.record.name || [row.record.firstName, row.record.lastName].filter(Boolean).join(" ") || row.record.person || `Row ${row.row}`}</span> <span className={`font-medium ${selectedActionStyle}`}>{selectedAction}</span></p>
                      {commitResults.filter((result) => result.row === row.row).map((result) => <p key={`result-${row.row}`} className={`mt-1 text-xs ${result.status === "failed" ? "text-red-200" : result.status === "unchanged" ? "text-gray-400" : "text-emerald-200"}`}>{result.status === "failed" ? `Import failed: ${result.message || "Preview this file again."}` : result.status === "created" ? "Created." : result.status === "unchanged" ? "No changes." : "Updated."}</p>)}
                      {/inactive|archived|disabled|deactivated/i.test(`${row.record.status || ""} ${row.record.archived || ""}`) && <p className="mt-1 text-xs text-amber-200">Source status: {row.record.status || row.record.archived}. Import won't archive or restore this member.</p>}
                      {row.action === "create" && createDetails.length > 0 && <p className="mt-1 text-xs text-gray-200">New details: {createDetails.map(([label, value]) => `${label}: ${value}`).join(" · ")}</p>}
                      {plannedTeams.length > 0 && <p className="mt-1 text-sm text-gray-200">Teams: {plannedTeams.map((action) => action.action === "create" ? `${action.name} (new)` : action.action === "match" ? `${activeTeams.find((team) => team.teamId === action.teamId)?.name || action.sourceValue} (mapped from ${action.sourceValue})` : `${action.sourceValue} (assignments ignored)`).join(", ")}</p>}
                      {plannedPositions.length > 0 && <p className="mt-1 text-sm text-gray-200">Positions: {plannedPositions.map((action) => `${action.action === "create" ? `${action.name} (new)` : action.action === "match" ? `${action.name || action.sourceValue} (matched)` : `${action.sourceValue} (omitted)`}${action.teamName ? ` · ${action.teamName}` : ""}`).join(", ")}</p>}
                      {(row.changes || []).map((change, index) => <p key={`change-${row.row}-${index}`} className={`mt-1 text-sm ${updateMode === "replace" && change.field === "Position" && change.before && !change.after ? "font-semibold text-amber-100" : "text-gray-200"}`}>{updateMode === "replace" && change.field === "Position" && change.before && !change.after ? `Position removed from ${importedTeamLabel}: ${change.before}` : `${change.field}: ${change.before || "(blank)"} -> ${change.after || "(blank)"}`}</p>)}
                      {row.action === "update" && !(row.changes || []).length && <p className="mt-1 text-sm font-medium text-gray-200">No changes</p>}
                      {row.action === "update" && <p className="mt-1 text-xs text-gray-300">Other team memberships and positions outside this import scope are preserved.</p>}
                      {row.sourceValues && Object.keys(row.sourceValues).length > 0 && <details className="mt-2 text-xs text-gray-300">
                        <summary className="cursor-pointer">Source details</summary>
                        <dl className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">{Object.entries(row.sourceValues).filter(([, value]) => String(value || "").trim()).map(([label, value]) => <Fragment key={`${row.row}-${label}`}><dt className="font-medium">{label}</dt><dd className="break-words">{value}</dd></Fragment>)}</dl>
                      </details>}
                      {updateMode === "replace" && positionRemovals.length > 0 && <p className="mt-1 text-xs text-amber-100">Only positions in {hasCsvTeamAssignments ? "the imported teams" : "the selected team"} are affected.</p>}
                      {row.issues.map((issue, index) => <p key={`${issue.code}-${index}`} className={`mt-1 text-xs ${issue.code === "required" || issue.code === "missing_reference" || issue.code === "unresolved_reference" || issue.code === "not_found" || issue.code === "archived_match" ? "text-red-200" : "text-amber-200"}`}>{issue.message}</p>)}
                      {row.issues.filter((issue) => issue.candidates?.length && ["ambiguous_reference", "foreign_or_unknown_reference_id"].includes(issue.code)).map((issue) => { const fieldLabel = issue.field === "positions" ? "Position" : issue.field === "teams" ? "Team" : /^service\d+$/.test(issue.field) ? `Service ${Number(issue.field.slice(7)) + 1}` : PORTABLE_FIELD_LABELS[issue.field] || issue.field; const referenceIndex = issue.referenceIndex ?? 0; const choiceKey = relationshipChoiceKey(row.row, issue.field, referenceIndex); const description = issue.referenceValue ? `${fieldLabel}: ${issue.referenceValue}` : fieldLabel; return <div key={`resolve-${issue.field}-${referenceIndex}-${issue.code}`} className="mt-2 grid max-w-lg gap-1 text-xs text-gray-200"><span>{description}</span><Select aria-label={`Resolve ${description} for row ${row.row}`} selectClassName="min-h-9 rounded border border-gray-600 bg-gray-900 px-2 text-sm text-white" value={relationshipChoices[choiceKey] || ""} onChange={(value) => setRelationshipChoices((current) => ({ ...current, [choiceKey]: value }))} options={[{ value: "", label: "Choose a local match…" }, ...(issue.candidates || []).map((candidate) => ({ value: candidate.id, label: candidate.teamName ? `${candidate.name} · ${candidate.teamName}` : candidate.name }))]} /></div>; })}
                      {row.candidates.length > 0 && <p className="mt-1 text-xs text-gray-400">Several possible matches. Choose one or create a new record.</p>}
                    </div>
                    <Select aria-label={`Action for row ${row.row}`} selectClassName="min-h-10 w-full rounded border border-gray-600 bg-gray-900 px-3 text-sm text-white" value={selected} disabled={row.action === "invalid" || alreadyCompleted || Boolean(busy)} onChange={(value) => { setRowChoices((current) => ({ ...current, [row.row]: value })); setExplicitSkips((current) => ({ ...current, [row.row]: value === "skip" })); }} options={mustSkip ? [{ value: "skip", label: alreadyCompleted ? "Completed (excluded from retry)" : "Skip row" }] : [...(row.action === "review" ? [{ value: "review", label: "Choose an action" }] : []), { value: "skip", label: alreadyCompleted ? "Completed (excluded from retry)" : "Skip row" }, { value: "create", label: "Create new" }, ...(row.matchedId ? [{ value: `update:${row.matchedId}`, label: "Update matched record" }] : []), ...row.candidates.filter((candidate) => candidate.id !== row.matchedId).map((candidate) => ({ value: `update:${candidate.id}`, label: `Match ${candidate.name}` }))]} />
                  </div>
                );
              })}
              {reviewRows.length > 50 && <div className="flex items-center justify-between gap-3 text-sm text-gray-300"><span>Rows {previewPage * 50 + 1}–{Math.min((previewPage + 1) * 50, reviewRows.length)} of {reviewRows.length}</span><div className="flex gap-2"><Button type="button" variant="tertiary" onClick={() => setPreviewPage((page) => Math.max(0, page - 1))} disabled={previewPage === 0}>Previous</Button><Button type="button" variant="tertiary" onClick={() => setPreviewPage((page) => Math.min(Math.ceil(reviewRows.length / 50) - 1, page + 1))} disabled={(previewPage + 1) * 50 >= reviewRows.length}>Next</Button></div></div>}
            </div>
          </div>
        )}
        {message && <p role="status" className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ring-1 ring-inset ${messageType === "error" ? "bg-red-500/10 text-red-100 ring-red-400/20" : messageType === "success" ? "bg-emerald-500/10 text-emerald-100 ring-emerald-400/20" : "bg-amber-500/10 text-amber-100 ring-amber-400/20"}`}>
          {messageType === "success" ? <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
          {message}
        </p>}
        </div>
        {inspection && <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-700 bg-gray-900 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap gap-2">
            {preview ? <>
              <Button type="button" variant="tertiary" onClick={returnToSetup} disabled={Boolean(busy)}>{type === "members" ? "Back to match information" : "Back to column mapping"}</Button>
              {positionStep && approvedTeamActions.length > 0 && <Button type="button" variant="tertiary" onClick={handleBackToTeams} disabled={Boolean(busy)}>Back to teams</Button>}
              {!teamStep && !positionStep && approvedPositionActions.length > 0 && <Button type="button" variant="tertiary" onClick={handleBackToPositions} disabled={Boolean(busy)}>Back to positions</Button>}
              {!teamStep && !positionStep && approvedPositionActions.length === 0 && approvedTeamActions.length > 0 && <Button type="button" variant="tertiary" onClick={handleBackToTeams} disabled={Boolean(busy)}>Back to teams</Button>}
            </> : <span className="text-xs text-gray-400" aria-live="polite">Step {activeStep}: {stepLabel}</span>}
          </div>
          {preview ? teamStep ? <Button type="button" variant="cta" wrap className="min-h-10 w-full justify-center px-5 sm:w-auto" svg={ArrowRight} iconPosition="right" onClick={() => void handleApplyTeamActions()} disabled={Boolean(busy)} aria-busy={busy === "team-preview"}>{busy === "team-preview" ? "Updating review..." : "Continue to positions"}</Button> : positionStep ? <Button type="button" variant="cta" wrap className="min-h-10 w-full justify-center px-5 sm:w-auto" svg={ArrowRight} iconPosition="right" onClick={() => void handleApplyPositionActions()} disabled={Boolean(busy)} aria-busy={busy === "position-preview"}>{busy === "position-preview" ? "Updating review..." : "Continue to review"}</Button> : requiresRepreview ? <Button type="button" variant="cta" className="min-h-10 w-full justify-center px-5 sm:w-auto" svg={ArrowRight} iconPosition="right" onClick={() => void handlePreview()} disabled={Boolean(busy)} aria-busy={busy === "preview"}>{busy === "preview" ? "Checking rows..." : "Review changes again"}</Button> : selectedRows.length === 0 ? <Button type="button" variant="cta" className="min-h-10 w-full justify-center px-5 sm:w-auto" onClick={() => onOpenChange(false)} disabled={Boolean(busy)}>Close</Button> : <Button type="button" variant="cta" wrap className="min-h-10 w-full justify-center px-5 sm:w-auto" onClick={() => void handleCommit()} disabled={Boolean(busy)} aria-busy={busy === "commit"}>{busy === "commit" ? <><Spinner size="sm" className="mr-2 shrink-0" />Importing...</> : commitButtonLabel}</Button> : <Button type="button" variant="cta" className="min-h-10 w-full justify-center px-5 sm:w-auto" svg={ArrowRight} iconPosition="right" onClick={() => void handlePreview()} disabled={Boolean(busy) || !fileName || (needsDestinationTeam && !destinationTeamId)} aria-busy={busy === "preview"}>{busy === "preview" ? "Checking rows..." : type === "members" ? "Review your import" : "Review import"}</Button>}
        </footer>}
      </section>
    </Modal>
  );
};

export default PortableDataImportDialog;
