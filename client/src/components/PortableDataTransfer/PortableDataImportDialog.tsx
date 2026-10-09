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
import type { PortableDataType, PortableImportResolution, PortableImportRow, PortablePositionAction, PortableTeamAction, TeamRecord } from "../../api/authTypes";
import { downloadBlob, PORTABLE_DATA_TYPES, PORTABLE_FIELD_LABELS, PORTABLE_FIELD_ORDER } from "./portableDataTransfer";
import { useToast } from "../../context/toastContext";

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

const relationshipChoiceKey = (row: number, field: string, referenceIndex = 0) => `${row}:${field}:${referenceIndex}`;
const positionChoiceKey = (teamId: string, sourceValue: string) => JSON.stringify([teamId.trim(), sourceValue.trim().normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ")]);
const teamChoiceKey = (sourceValue: string) => sourceValue.trim().normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");

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
  const [approvedPositionActions, setApprovedPositionActions] = useState<PortablePositionAction[]>([]);
  const [approvedPositionRows, setApprovedPositionRows] = useState<Record<string, number[]>>({});
  const [positionStep, setPositionStep] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"attention" | "error" | "success">("attention");
  const [commitResults, setCommitResults] = useState<Array<{ row: number; status: "created" | "updated" | "unchanged" | "failed"; message?: string; code?: string }>>([]);
  const [explicitSkips, setExplicitSkips] = useState<Record<number, boolean>>({});
  const [createdPositionCount, setCreatedPositionCount] = useState(0);
  const [createdTeamCount, setCreatedTeamCount] = useState(0);
  const [previewPage, setPreviewPage] = useState(0);
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
    (preview?.rows || []).forEach((row) => row.issues.filter((issue) => issue.field === "teams" && ["missing_reference", "ambiguous_reference", "foreign_or_unknown_reference_id"].includes(issue.code)).forEach((issue) => {
      const sourceValue = issue.referenceValue || "";
      const key = teamChoiceKey(sourceValue);
      const group = groups.get(key) || { sourceValue, memberRows: new Set<number>(), options: new Map<string, string>() };
      group.memberRows.add(row.row);
      (issue.candidates || []).forEach((option) => group.options.set(option.id, option.name));
      groups.set(key, group);
    }));
    return [...groups.entries()].map(([key, group]) => ({ ...group, key, options: [...group.options].map(([id, name]) => ({ id, name })) }));
  })();
  const positionGroups = (() => {
    const groups = new Map<string, { teamId: string; teamName: string; sourceValue: string; memberRows: Set<number>; options: Map<string, { id: string; name: string; teamId?: string; teamName?: string }>; teamOptions: Map<string, string> }>();
    (preview?.rows || []).forEach((row) => row.issues.filter((issue) => issue.field === "positions" && (issue.teamId || issue.teamOptions?.length) && ["missing_reference", "ambiguous_reference", "foreign_or_unknown_reference_id"].includes(issue.code)).forEach((issue) => {
      const ownerKey = issue.teamId || (issue.teamOptions || []).map((option) => option.teamId).sort().join(",");
      const key = positionChoiceKey(ownerKey, issue.referenceValue || "");
      const group = groups.get(key) || { teamId: issue.teamId || "", teamName: issue.teamName || "Choose the owning team", sourceValue: issue.referenceValue || "", memberRows: new Set<number>(), options: new Map(), teamOptions: new Map() };
      group.memberRows.add(row.row);
      (issue.teamOptions || []).forEach((option) => group.teamOptions.set(option.teamId, option.name));
      (issue.positionOptions || issue.candidates || []).forEach((option) => group.options.set(option.id, { id: option.id, name: option.name, teamId: option.teamId, teamName: option.teamName }));
      groups.set(key, group);
    }));
    return [...groups.entries()].map(([key, group]) => ({ ...group, key, options: [...group.options.values()], teamOptions: [...group.teamOptions].map(([teamId, name]) => ({ teamId, name })) }));
  })();
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
    setApprovedPositionActions([]);
    setApprovedPositionRows({});
    setPositionStep(false);
    setCommitResults([]);
    setExplicitSkips({});
    setCreatedPositionCount(0);
    setCreatedTeamCount(0);
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
    setApprovedPositionActions([]);
    setApprovedPositionRows({});
    setPositionStep(false);
    setCommitResults([]);
    setExplicitSkips({});
    setCreatedPositionCount(0);
    setCreatedTeamCount(0);
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
  const skippedCount = Object.values(explicitSkips).filter(Boolean).length;
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
      result.rows.forEach((row) => row.issues.filter((issue) => issue.field === "positions" && (issue.teamId || issue.teamOptions?.length) && ["missing_reference", "ambiguous_reference", "foreign_or_unknown_reference_id"].includes(issue.code)).forEach((issue) => {
        const ownerKey = issue.teamId || (issue.teamOptions || []).map((option) => option.teamId).sort().join(",");
        const key = positionChoiceKey(ownerKey, issue.referenceValue || "");
        initialPositionChoices[key] = initialPositionChoices[key] || { action: "", positionId: "", name: issue.referenceValue || "", teamId: issue.teamId || "" };
      }));
      setPositionChoices(initialPositionChoices);
      const initialTeamChoices: typeof teamChoices = {};
      const initialTeamRows: Record<string, number[]> = {};
      result.rows.forEach((row) => row.issues.filter((issue) => issue.field === "teams" && issue.referenceValue).forEach((issue) => {
        const key = teamChoiceKey(issue.referenceValue!);
        initialTeamChoices[key] = initialTeamChoices[key] || { action: "", teamId: "", name: issue.referenceValue! };
        initialTeamRows[key] = [...new Set([...(initialTeamRows[key] || []), row.row])];
      }));
      setTeamChoices(initialTeamChoices);
      setApprovedTeamRows(initialTeamRows);
      setTeamStep(Object.keys(initialTeamChoices).length > 0);
      setPositionStep(Object.keys(initialTeamChoices).length === 0 && Object.keys(initialPositionChoices).length > 0);
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
      result.rows.forEach((row) => row.issues.filter((issue) => issue.field === "positions" && (issue.teamId || issue.teamOptions?.length) && ["missing_reference", "ambiguous_reference", "foreign_or_unknown_reference_id"].includes(issue.code)).forEach((issue) => {
        const ownerKey = issue.teamId || (issue.teamOptions || []).map((option) => option.teamId).sort().join(",");
        const key = positionChoiceKey(ownerKey, issue.referenceValue || "");
        initialPositionChoices[key] = initialPositionChoices[key] || { action: "", positionId: "", name: issue.referenceValue || "", teamId: issue.teamId || "" };
      }));
      setPositionChoices(initialPositionChoices);
      setApprovedPositionActions([]);
      setApprovedPositionRows({});
      setTeamStep(false);
      setPositionStep(Object.keys(initialPositionChoices).length > 0);
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
      actions.push({ teamId: selectedTeamId, ...(group.teamOptions.length > 1 ? { teamName: group.teamOptions.find((option) => option.teamId === selectedTeamId)?.name || group.teamName } : {}), sourceValue: group.sourceValue, action: choice.action as "match" | "create" | "ignore", ...(choice.action === "match" ? { positionId: choice.positionId, name: group.options.find((option) => option.id === choice.positionId)?.name } : {}), ...(choice.action === "create" ? { name: choice.name.trim() } : {}) });
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
      const resultMessage = hasFailures
        ? hasCompletedRows
          ? "Import partially completed. Review the failed rows below."
          : "Import failed. Review the results and try again."
        : `Import finished. Review the results below.${refreshFailed ? " The data was saved, but this page could not refresh. Reload to see the latest data." : ""}`;
      setMessage(resultMessage);
      setMessageType(hasFailures ? (hasCompletedRows ? "attention" : "error") : "success");
      const completedRows = new Set(combinedResults.filter((item) => item.status !== "failed").map((item) => item.row));
      const allRowsResolved = preview.rows.every((row) => completedRows.has(row.row) || explicitSkips[row.row]);
      if (!hasFailures && allRowsResolved) {
        const created = combinedResults.filter((item) => item.status === "created").length;
        const updated = combinedResults.filter((item) => item.status === "updated").length;
        const unchanged = combinedResults.filter((item) => item.status === "unchanged").length;
        const skipped = Object.values(explicitSkips).filter(Boolean).length;
        const positionsCreated = Math.max(createdPositionCount, result.summary.positionsCreated || 0);
        const teamsCreated = Math.max(createdTeamCount, result.summary.teamsCreated || 0);
        const entity = currentType.label;
        const counts = [created ? `${created} added` : "", updated ? `${updated} updated` : "", unchanged ? `${unchanged} unchanged` : "", skipped ? `${skipped} skipped` : "", teamsCreated ? `${teamsCreated} ${teamsCreated === 1 ? "team" : "teams"} created` : "", positionsCreated ? `${positionsCreated} ${positionsCreated === 1 ? "position" : "positions"} created` : ""].filter(Boolean).join(" · ");
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
      const skipped = !outcome && explicitSkips[row.row];
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

  const activeStep = !inspection ? 1 : preview ? teamStep ? 3 : positionStep ? 4 : type === "members" ? 5 : 3 : 2;
  const stepLabel = activeStep === 1 ? "Choose CSV" : activeStep === 2 ? (type === "members" ? "Setup and column mapping" : "Map columns") : activeStep === 3 ? "Match teams" : activeStep === 4 && type === "members" ? "Match positions" : "Review changes";
  const eligibleFailedRows = selectedRows.filter((row) => commitResults.some((result) => result.row === row.row && result.status === "failed")).length;
  const requiresRepreview = commitResults.some((result) => result.status === "failed" && result.code === "stale_preview");
  const commitButtonLabel = eligibleFailedRows === selectedRows.length && eligibleFailedRows > 0
    ? `Retry ${eligibleFailedRows} failed ${eligibleFailedRows === 1 ? "row" : "rows"}`
    : updateMode === "replace" && selectedRows.some((row) => (row.changes || []).some((change) => change.field === "Position" && change.before && !change.after))
      ? `Replace positions and import ${selectedRows.length} ${selectedRows.length === 1 ? "member" : "members"}`
      : type === "members" ? `Import ${selectedRows.length} ${selectedRows.length === 1 ? "member" : "members"}` : `Import ${selectedRows.length} ${selectedRows.length === 1 ? "row" : "rows"}`;

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
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-sm font-semibold text-cyan-200" aria-hidden="true">{type === "members" ? "03" : "02"}</span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Step 2</p>
                  <h4 className="text-lg font-semibold leading-tight text-white">{type === "members" ? "Setup and column mapping" : "Column mapping"}</h4>
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
              {type === "members" && <p className="text-sm text-gray-300">Categories are matched to positions in the selected team. Email and phone don't determine member matches.</p>}
              {type !== "members" && <p className="text-xs text-gray-400">For multiple names, use <span className="font-mono"> | </span>, semicolons, or separate lines. Commas split only when each part matches a known name.</p>}
              {type === "members" && <details className="text-xs text-gray-400"><summary className="cursor-pointer">Unmapped columns are ignored</summary><p className="mt-1 break-words">{inspection.headers.filter((header) => !Object.values(mappings).includes(header)).join(", ") || "No unmapped columns."}</p></details>}
              {type !== "members" && <p className="text-sm text-gray-400">Unmapped columns: {inspection.headers.filter((header) => !Object.values(mappings).includes(header)).join(", ") || "None"}. Unmapped values are ignored.</p>}
            </>}
          </div>
        )}

        {preview && teamStep && (
          <div className="space-y-4 rounded-lg border border-cyan-400/40 bg-gray-800/70 p-4 shadow-md shadow-black/20">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-sm font-semibold text-cyan-200" aria-hidden="true">03</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Step 3</p>
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
                <Select aria-label={`How to handle team ${group.sourceValue}`} selectClassName="min-h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-sm text-white focus-visible:ring-2 focus-visible:ring-cyan-400/70" value={choice.action} onChange={(value) => setTeamChoices((current) => ({ ...current, [group.key]: { ...choice, action: value as typeof choice.action } }))} options={[{ value: "", label: "Choose an option" }, { value: "match", label: "Match an existing team" }, { value: "create", label: `Create ${group.sourceValue}` }, { value: "ignore", label: "Ignore this team's assignments" }]} disabled={Boolean(busy)} />
                {choice.action === "match" && <Select aria-label={`Existing team for ${group.sourceValue}`} selectClassName="min-h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-sm text-white focus-visible:ring-2 focus-visible:ring-cyan-400/70" value={choice.teamId} onChange={(teamId) => setTeamChoices((current) => ({ ...current, [group.key]: { ...choice, teamId } }))} options={[{ value: "", label: "Choose an active team" }, ...options.map((option) => ({ value: option.id, label: option.name }))]} disabled={Boolean(busy)} />}
                {choice.action === "create" && <Input aria-label={`New team name for ${group.sourceValue}`} label="Team name" labelClassName="text-gray-300" value={choice.name} onChange={(name) => setTeamChoices((current) => ({ ...current, [group.key]: { ...choice, name: String(name) } }))} inputClassName="border-gray-600 bg-gray-900 text-white focus-visible:border-cyan-400/80 focus-visible:ring-cyan-400/30" disabled={Boolean(busy)} />}
                {choice.action === "ignore" && <p className="text-sm text-gray-300">Members can still be imported, but they won't be assigned to this team or its positions. Existing assignments are preserved, including in Replace mode.</p>}
              </div>;
            })}
          </div>
        )}

        {preview && positionStep && !teamStep && (
          <div className="space-y-4 rounded-lg border border-cyan-400/40 bg-gray-800/70 p-4 shadow-md shadow-black/20">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-sm font-semibold text-cyan-200" aria-hidden="true">04</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Step 4</p>
                <h4 className="text-xl font-semibold leading-tight text-white">Match positions</h4>
                <p className="mt-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-200 ring-1 ring-inset ring-amber-300/25"><CircleAlert size={14} aria-hidden="true" />{positionGroups.length} {positionGroups.length === 1 ? "position needs" : "positions need"} attention</span></p>
              <p className="mt-2 text-sm text-gray-300">Choose how to handle positions that aren't yet in their assigned team. When team ownership is unclear, select the team that owns each position.</p>
              </div>
            </div>
            {positionGroups.map((group) => {
              const choice = positionChoices[group.key] || { action: "" as const, positionId: "", name: group.sourceValue, teamId: group.teamId };
              const ownerOptions: Array<{ teamId: string; name: string; ignored?: boolean }> = group.teamOptions.length ? group.teamOptions : group.teamId ? [{ teamId: group.teamId, name: group.teamName }] : [];
              const selectedTeamId = choice.teamId || (ownerOptions.length === 1 ? ownerOptions[0].teamId : "");
              const selectedOwner = ownerOptions.find((option) => option.teamId === selectedTeamId);
              const scopedPositionOptions = group.options.filter((option) => !option.teamId || option.teamId === selectedTeamId);
              const selectedAction = choice.action === "create" ? { label: "Create new position", Icon: Plus, style: "bg-cyan-400/10 text-cyan-100 ring-cyan-300/25" } : choice.action === "match" ? { label: "Match existing position", Icon: Link2, style: "bg-cyan-400/10 text-cyan-100 ring-cyan-300/25" } : choice.action === "ignore" ? { label: "Import without position", Icon: Minus, style: "bg-gray-700/60 text-gray-300 ring-white/10" } : null;
              const fieldError = positionFieldErrors[group.key];
              return <div key={group.key} className={`space-y-3 rounded-md bg-gray-900/55 p-3.5 sm:p-4 ${fieldError ? "border border-red-500/70 ring-1 ring-red-500/30" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-base font-semibold text-white">{group.sourceValue}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{group.memberRows.size} {group.memberRows.size === 1 ? "member" : "members"} · {selectedTeamId ? ownerOptions.find((option) => option.teamId === selectedTeamId)?.name || group.teamName : "Choose which team owns this position"}</p>
                  </div>
                  {selectedAction && <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${selectedAction.style}`}><selectedAction.Icon size={14} aria-hidden="true" />{selectedAction.label}</span>}
                </div>
                {ownerOptions.length > 1 && <Select aria-label={`Team that owns ${group.sourceValue}`} selectClassName="min-h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-sm text-white focus-visible:ring-2 focus-visible:ring-cyan-400/70" value={selectedTeamId} onChange={(teamId) => { setPositionChoices((current) => ({ ...current, [group.key]: { ...choice, teamId, positionId: "", action: "" } })); setPositionFieldErrors((current) => { const next = { ...current }; delete next[group.key]; return next; }); }} options={[{ value: "", label: "Choose the owning team" }, ...ownerOptions.map((option) => ({ value: option.teamId, label: option.ignored ? `${option.name} (ignored team)` : option.name }))]} ariaInvalid={fieldError?.field === "owner"} errorText={fieldError?.field === "owner" ? fieldError.message : undefined} disabled={Boolean(busy)} />}
                {fieldError?.field === "owner" && ownerOptions.length <= 1 && <p className="text-sm text-red-300" role="alert">{fieldError.message}</p>}
                <Select aria-label={`How to handle ${group.sourceValue} in ${group.teamName}`} selectClassName="min-h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-sm text-white focus-visible:ring-2 focus-visible:ring-cyan-400/70" value={choice.action} onChange={(value) => { setPositionChoices((current) => ({ ...current, [group.key]: { ...choice, action: value as typeof choice.action } })); setPositionFieldErrors((current) => { const next = { ...current }; delete next[group.key]; return next; }); }} options={[{ value: "", label: "Choose an option" }, ...(!selectedOwner?.ignored && scopedPositionOptions.length && selectedTeamId ? [{ value: "match", label: "Match an existing position" }] : []), ...(!selectedOwner?.ignored && selectedTeamId ? [{ value: "create", label: "Create new position" }] : []), { value: "ignore", label: selectedOwner?.ignored ? "Ignore this position with its team" : "Import without this position" }]} ariaInvalid={fieldError?.field === "action"} errorText={fieldError?.field === "action" ? fieldError.message : undefined} disabled={Boolean(busy) || !selectedTeamId} />
                {choice.action === "match" && <Select aria-label={`Existing position for ${group.sourceValue}`} selectClassName="min-h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-sm text-white focus-visible:ring-2 focus-visible:ring-cyan-400/70" value={choice.positionId} onChange={(positionId) => { setPositionChoices((current) => ({ ...current, [group.key]: { ...choice, positionId } })); setPositionFieldErrors((current) => { const next = { ...current }; delete next[group.key]; return next; }); }} options={[{ value: "", label: "Choose an active position" }, ...scopedPositionOptions.map((option) => ({ value: option.id, label: option.teamName ? `${option.name} · ${option.teamName}` : option.name }))]} ariaInvalid={fieldError?.field === "position"} errorText={fieldError?.field === "position" ? fieldError.message : undefined} disabled={Boolean(busy) || !selectedTeamId} />}
                {choice.action === "create" && <>
                  <div className="rounded-md bg-gray-950/55 p-3">
                    <Input aria-label={`New position name for ${group.sourceValue}`} label="Position name" labelClassName="text-gray-300" value={choice.name} onChange={(name) => { setPositionChoices((current) => ({ ...current, [group.key]: { ...choice, name: String(name) } })); setPositionFieldErrors((current) => { const next = { ...current }; delete next[group.key]; return next; }); }} errorText={fieldError?.field === "name" ? fieldError.message : undefined} inputClassName="border-gray-600 bg-gray-900 text-white focus-visible:border-cyan-400/80 focus-visible:ring-cyan-400/30" disabled={Boolean(busy)} />
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
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-sm font-semibold text-cyan-200" aria-hidden="true">{type === "members" ? "04" : "03"}</span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Step {type === "members" ? "5" : "3"}</p>
                <h4 className="text-xl font-semibold leading-tight text-white">Review changes</h4>
              </div>
            </div>
              <div>
                <p className="text-sm text-gray-300">{preview.summary.total} {preview.summary.total === 1 ? "row" : "rows"} found</p>
                <p className="mt-1 text-sm text-gray-300">{type === "members" ? `${selectedCreateCount} new members · ${selectedUpdateCount} existing members to update` : `${selectedCreateCount} new · ${selectedUpdateCount} to update`} · {unchangedCount} unchanged · {preview.summary.review} need attention · {preview.summary.invalid} invalid · {skippedCount} skipped</p>
            </div>
            {type === "members" && activePositionActions.length > 0 && <p className="text-sm text-gray-300">Positions: {activePositionActions.filter((action) => action.action === "create").length} new, {activePositionActions.filter((action) => action.action === "match").length} matched, {activePositionActions.filter((action) => action.action === "ignore").length} ignored.</p>}
            {type === "members" && activeTeamActions.length > 0 && <p className="text-sm text-gray-300">Teams: {activeTeamActions.filter((action) => action.action === "create").length} new, {activeTeamActions.filter((action) => action.action === "match").length} mapped, {activeTeamActions.filter((action) => action.action === "ignore").length} ignored.</p>}
            {type === "members" && updateMode === "replace" && plannedPositionRemovals > 0 && <p className="rounded border border-amber-800 p-3 text-sm text-amber-100">{plannedPositionRemovals} existing position {plannedPositionRemovals === 1 ? "assignment" : "assignments"} will be removed from the imported team scope.</p>}
            {type === "members" && ignoredSourceFields.length > 0 && <details className="rounded border border-gray-700 p-3 text-sm text-gray-200">
              <summary className="cursor-pointer font-medium">Some CSV fields won't be imported</summary>
              <p className="mt-2 text-gray-300">{ignoredSourceFields.join(", ")} are recognized but won't change existing WorshipSync information.</p>
              <p className="mt-1 text-xs text-gray-400">Source values remain available in each member's details. SMS consent protections are unchanged.</p>
            </details>}
            {type === "members" && preview.rows.some((row) => /inactive|archived|disabled|deactivated/i.test(`${row.record.status || ""} ${row.record.archived || ""}`)) && <p className="rounded border border-amber-800 p-3 text-sm text-amber-100">Some source records are inactive or archived. Imports won't archive or restore members; skip rows that should remain unchanged.</p>}
            {type === "members" && updateMode === "replace" && activePositionActions.some((action) => action.action === "ignore") && <p className="rounded border border-amber-800 p-3 text-sm text-amber-100">In Replace mode, existing positions are preserved for members with an ignored position reference.</p>}
            {commitResults.length > 0 && <div className="rounded-md bg-gray-900/60 p-3 text-sm" aria-live="polite">
              <h5 className="flex items-center gap-2 font-semibold"><Check size={16} className="text-emerald-300" aria-hidden="true" />Step {type === "members" ? "5" : "4"} · Import results</h5>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium" aria-label="Import result summary">
                <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-200">Created {commitResults.filter((item) => item.status === "created").length}</span>
                <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-cyan-100">Updated {commitResults.filter((item) => item.status === "updated").length}</span>
                <span className="rounded-full bg-gray-700 px-2 py-1 text-gray-200">Unchanged {commitResults.filter((item) => item.status === "unchanged").length}</span>
                <span className="rounded-full bg-red-500/10 px-2 py-1 text-red-200">Failed {commitResults.filter((item) => item.status === "failed").length}</span>
                <span className="rounded-full bg-gray-700 px-2 py-1 text-gray-200">Skipped {Math.max(0, preview.summary.total - commitResults.length)}</span>
                {createdTeamCount > 0 && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-200">Teams created {createdTeamCount}</span>}
                {createdPositionCount > 0 && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-200">Positions created {createdPositionCount}</span>}
              </div>
              {type === "members" && <Button type="button" variant="tertiary" className="mt-2" onClick={downloadRecoveryRows}>Download failed and skipped rows</Button>}
            </div>}
            {preview.issues.map((issue) => <p key={`${issue.row}-${issue.code}`} className="text-sm text-red-200">Row {issue.row}: {issue.message}</p>)}
            <div className="space-y-2">
              {preview.rows.slice(previewPage * 50, previewPage * 50 + 50).map((row) => {
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
              {preview.rows.length > 50 && <div className="flex items-center justify-between gap-3 text-sm text-gray-300"><span>Rows {previewPage * 50 + 1}–{Math.min((previewPage + 1) * 50, preview.rows.length)} of {preview.rows.length}</span><div className="flex gap-2"><Button type="button" variant="tertiary" onClick={() => setPreviewPage((page) => Math.max(0, page - 1))} disabled={previewPage === 0}>Previous</Button><Button type="button" variant="tertiary" onClick={() => setPreviewPage((page) => Math.min(Math.ceil(preview.rows.length / 50) - 1, page + 1))} disabled={(previewPage + 1) * 50 >= preview.rows.length}>Next</Button></div></div>}
            </div>
          </div>
        )}
        {message && <p role="status" className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ring-1 ring-inset ${messageType === "error" ? "bg-red-500/10 text-red-100 ring-red-400/20" : messageType === "success" ? "bg-emerald-500/10 text-emerald-100 ring-emerald-400/20" : "bg-amber-500/10 text-amber-100 ring-amber-400/20"}`}>
          {messageType === "success" ? <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
          {message}
        </p>}
        </div>
        {inspection && <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-700 bg-gray-900 px-4 py-3">
          <div>
            {preview ? <Button type="button" variant="tertiary" onClick={returnToSetup} disabled={Boolean(busy)}>{type === "members" ? "Back to setup and mapping" : "Back to column mapping"}</Button> : <span className="text-xs text-gray-400" aria-live="polite">Step {activeStep}: {stepLabel}</span>}
          </div>
          {preview ? teamStep ? <Button type="button" variant="cta" wrap className="min-h-10 w-full justify-center px-5 sm:w-auto" svg={ArrowRight} iconPosition="right" onClick={() => void handleApplyTeamActions()} disabled={Boolean(busy)} aria-busy={busy === "team-preview"}>{busy === "team-preview" ? "Updating review..." : "Continue to positions"}</Button> : positionStep ? <Button type="button" variant="cta" wrap className="min-h-10 w-full justify-center px-5 sm:w-auto" svg={ArrowRight} iconPosition="right" onClick={() => void handleApplyPositionActions()} disabled={Boolean(busy)} aria-busy={busy === "position-preview"}>{busy === "position-preview" ? "Updating review..." : "Continue to review"}</Button> : requiresRepreview ? <Button type="button" variant="cta" className="min-h-10 w-full justify-center px-5 sm:w-auto" svg={ArrowRight} iconPosition="right" onClick={() => void handlePreview()} disabled={Boolean(busy)} aria-busy={busy === "preview"}>{busy === "preview" ? "Checking rows..." : "Review changes again"}</Button> : selectedRows.length === 0 ? <Button type="button" variant="cta" className="min-h-10 w-full justify-center px-5 sm:w-auto" onClick={() => onOpenChange(false)} disabled={Boolean(busy)}>Close</Button> : <Button type="button" variant="cta" wrap className="min-h-10 w-full justify-center px-5 sm:w-auto" onClick={() => void handleCommit()} disabled={Boolean(busy)} aria-busy={busy === "commit"}>{busy === "commit" ? <><Spinner size="sm" className="mr-2 shrink-0" />Importing...</> : commitButtonLabel}</Button> : <Button type="button" variant="cta" className="min-h-10 w-full justify-center px-5 sm:w-auto" svg={ArrowRight} iconPosition="right" onClick={() => void handlePreview()} disabled={Boolean(busy) || !fileName || (needsDestinationTeam && !destinationTeamId)} aria-busy={busy === "preview"}>{busy === "preview" ? "Checking rows..." : type === "members" ? "Review changes" : "Review import"}</Button>}
        </footer>}
      </section>
    </Modal>
  );
};

export default PortableDataImportDialog;
