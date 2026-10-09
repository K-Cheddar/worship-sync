import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import PortableDataImportDialog from "./PortableDataImportDialog";
import { commitPortableImport, downloadPortableData, inspectPortableImport, previewPortableImport } from "../../api/auth";

const mockShowToast = jest.fn();

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));
jest.mock("../../api/auth", () => ({
  commitPortableImport: jest.fn(),
  downloadPortableData: jest.fn(),
  inspectPortableImport: jest.fn(),
  previewPortableImport: jest.fn(),
}));

describe("PortableDataImportDialog import flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses the fixed schedules type when launched from the schedule menu", () => {
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="schedules" />);
    expect(screen.getByRole("heading", { name: "Import Schedules from CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a CSV file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download CSV template" })).toBeInTheDocument();
  });

  it("allows closing while CSV inspection is still running", async () => {
    let resolveInspection!: (value: Awaited<ReturnType<typeof inspectPortableImport>>) => void;
    jest.mocked(inspectPortableImport).mockReturnValue(new Promise((resolve) => { resolveInspection = resolve; }));
    const onOpenChange = jest.fn();
    const file = new File(["first_name,last_name\nJane,Doe"], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "first_name,last_name\nJane,Doe" });
    const ControlledDialog = () => {
      const [open, setOpen] = useState(true);
      return <>
        <button type="button">Outside target</button>
        <PortableDataImportDialog open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }]} destinationTeamId="team-1" />
      </>;
    };
    render(<ControlledDialog />);

    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    expect(await screen.findByRole("button", { name: "Reading CSV..." })).toBeDisabled();
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-busy", "true");
    await userEvent.setup().keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(async () => { resolveInspection({ success: true, headers: [], rowCount: 0, columnCount: 0, issues: [], mapping: {}, sampleRows: [], columnStats: {} }); });
  });

  it("allows outside dismissal while a CSV template is being prepared", async () => {
    let resolveDownload!: (value: Awaited<ReturnType<typeof downloadPortableData>>) => void;
    jest.mocked(downloadPortableData).mockReturnValue(new Promise((resolve) => { resolveDownload = resolve; }));
    const onOpenChange = jest.fn();
    const ControlledDialog = () => {
      const [open, setOpen] = useState(true);
      return <>
        <button type="button">Outside target</button>
        <PortableDataImportDialog open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }]} destinationTeamId="team-1" />
      </>;
    };
    render(<ControlledDialog />);
    const outside = screen.getByRole("button", { name: "Outside target", hidden: true });

    await userEvent.setup().click(screen.getByRole("button", { name: "Download CSV template" }));
    expect(await screen.findByRole("button", { name: "Preparing template..." })).toBeDisabled();
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-busy", "true");
    fireEvent.pointerDown(outside);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(async () => { resolveDownload({ blob: new Blob(["template"]), filename: "template.csv" }); });
  });

  it("blocks Escape and outside dismissal while an import commit is running", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name"], rowCount: 1, columnCount: 2, issues: [], mapping: { firstName: "First Name", lastName: "Last Name" }, sampleRows: [], columnStats: {} });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe" }, action: "create", matchedId: null, candidates: [], issues: [] }], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 }, previewToken: "preview-token", previewCsvHash: "a".repeat(64) });
    let resolveCommit!: (value: Awaited<ReturnType<typeof commitPortableImport>>) => void;
    jest.mocked(commitPortableImport).mockReturnValue(new Promise((resolve) => { resolveCommit = resolve; }));
    const onOpenChange = jest.fn();
    const file = new File(["First Name,Last Name\nJane,Doe"], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "First Name,Last Name\nJane,Doe" });
    render(<>
      <button type="button">Outside target</button>
      <PortableDataImportDialog open onOpenChange={onOpenChange} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }]} destinationTeamId="team-1" />
    </>);
    const outside = screen.getByRole("button", { name: "Outside target", hidden: true });

    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    await user.click(await screen.findByRole("button", { name: "Import 1 member" }));
    expect(await screen.findByRole("button", { name: "Importing..." })).toBeDisabled();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Close modal" })).toBeDisabled();

    await user.keyboard("{Escape}");
    fireEvent.pointerDown(outside);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => { resolveCommit({ success: true, results: [{ row: 2, status: "created", id: "member-1" }], summary: { created: 1, updated: 0, failed: 0 } }); });
  });

  it("inspects and previews an uploaded CSV without writing until the admin confirms", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({
      success: true,
      headers: ["first_name", "last_name"],
      rowCount: 1,
      columnCount: 2,
      issues: [],
      mapping: { firstName: "first_name", lastName: "last_name" },
      sampleRows: [],
      columnStats: {},
    });
    jest.mocked(previewPortableImport).mockResolvedValue({
      success: true,
      rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe" }, action: "create", matchedId: null, candidates: [], issues: [] }],
      issues: [],
      summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 },
      previewToken: "preview-token",
      previewCsvHash: "a".repeat(64),
    });
    jest.mocked(commitPortableImport).mockResolvedValue({
      success: true,
      results: [{ row: 2, status: "created", id: "member-1" }],
      summary: { created: 1, updated: 0, failed: 0, positionsCreated: 1 },
    });
    const file = new File(["first_name,last_name\nJane,Doe"], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "first_name,last_name\nJane,Doe" });
    const onImported = jest.fn();

    const onOpenChange = jest.fn();
    const ControlledDialog = () => {
      const [open, setOpen] = useState(true);
      return <PortableDataImportDialog open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }]} destinationTeamId="team-1" onImported={onImported} />;
    };
    render(<ControlledDialog />);
    expect(screen.queryByRole("group", { name: "Choose data to import" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    expect(await screen.findByText("1 member · 2 columns")).toBeInTheDocument();
    expect(commitPortableImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    expect(await screen.findByText("1 row found")).toBeInTheDocument();
    expect(previewPortableImport).toHaveBeenCalledWith("church-1", "members", expect.any(String), { firstName: "first_name", lastName: "last_name" }, undefined, expect.objectContaining({ destinationTeamId: "team-1", updateMode: "merge" }));
    expect(commitPortableImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Import 1 member" }));
    await waitFor(() => expect(commitPortableImport).toHaveBeenCalledWith("church-1", "members", [expect.objectContaining({ row: 2, action: "create", resolutions: [] })], undefined, expect.objectContaining({ destinationTeamId: "team-1", updateMode: "merge" })));
    expect(commitPortableImport).toHaveBeenCalledWith("church-1", "members", expect.any(Array), undefined, expect.objectContaining({ previewToken: "preview-token", previewCsvHash: expect.stringMatching(/^[a-f0-9]{64}$/), mapping: { firstName: "first_name", lastName: "last_name" } }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockShowToast).toHaveBeenCalledWith("Members imported successfully. 1 added · 1 position created.", "success");
  });

  it("lets an admin resolve an ambiguous relationship before import", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name", "Positions"], rowCount: 1, columnCount: 3, issues: [], mapping: { firstName: "First Name", lastName: "Last Name", positions: "Positions" }, sampleRows: [], columnStats: {} });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe", positions: "Keys" }, action: "review", matchedId: null, candidates: [], issues: [{ field: "positions", referenceIndex: 0, referenceValue: "Keys", code: "ambiguous_reference", message: "Choose which position to use.", candidates: [{ id: "position-a", name: "Keys" }, { id: "position-b", name: "Keys" }] }] }], issues: [], summary: { total: 1, create: 0, update: 0, review: 1, invalid: 0 } });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "created", id: "member-1" }], summary: { created: 1, updated: 0, failed: 0 } });
    const file = new File(["First Name,Last Name,Positions\nJane,Doe,Keys"], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "First Name,Last Name,Positions\nJane,Doe,Keys" });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }]} destinationTeamId="team-1" />);
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    await user.click(await screen.findByLabelText("Resolve Position: Keys for row 2"));
    await user.click(screen.getAllByRole("option", { name: "Keys" })[1]);
    await user.click(screen.getByLabelText("Action for row 2"));
    await user.click(screen.getAllByRole("option", { name: "Create new" })[0]);
    await user.click(screen.getByRole("button", { name: "Import 1 member" }));
    await waitFor(() => expect(commitPortableImport).toHaveBeenCalledWith("church-1", "members", [expect.objectContaining({ resolutions: [{ field: "positions", referenceIndex: 0, selectedId: "position-b" }] })], undefined, expect.objectContaining({ updateMode: "merge" })));
  });

  it("groups a missing position for a team and requires explicit creation approval", async () => {
    const user = userEvent.setup();
    const csv = "First Name,Last Name,Positions\nJules,CSVTest,Video Director";
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name", "Positions"], rowCount: 1, columnCount: 3, issues: [], mapping: { firstName: "First Name", lastName: "Last Name", positions: "Positions" }, sampleRows: [], columnStats: { Positions: { nonBlank: 1, blank: 0 } } });
    jest.mocked(previewPortableImport)
      .mockResolvedValueOnce({ success: true, rows: [{ row: 2, record: { firstName: "Jules", lastName: "CSVTest", positions: "Video Director" }, action: "create", matchedId: null, candidates: [], issues: [{ field: "positions", referenceIndex: 0, referenceValue: "Video Director", code: "missing_reference", message: "Position was not found.", teamId: "team-1", teamName: "New Test Team", positionOptions: [{ id: "camera", name: "Camera Operator" }] }] }], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 }, previewToken: "initial", previewCsvHash: "a".repeat(64) })
      .mockResolvedValueOnce({ success: true, rows: [{ row: 2, record: { firstName: "Jules", lastName: "CSVTest", positions: "Video Director" }, action: "create", matchedId: null, candidates: [], issues: [] }], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 }, previewToken: "approved", previewCsvHash: "a".repeat(64) });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "created", id: "member-1" }], summary: { created: 1, updated: 0, failed: 0, positionsCreated: 1 } });
    const file = new File([csv], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "New Test Team", memberIds: [] }]} destinationTeamId="team-1" />);

    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    expect(await screen.findByText("CSV ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a different file" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Setup and column mapping" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review changes" })).toHaveAttribute("data-variant", "presentCta");
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    expect(await screen.findByRole("heading", { name: "Match positions" })).toBeInTheDocument();
    expect(screen.getByText("1 position needs attention")).toBeInTheDocument();
    expect(screen.getByText("Video Director")).toBeInTheDocument();
    expect(screen.getByText("1 member · New Test Team")).toBeInTheDocument();
    const positionActionSelect = screen.getByLabelText("How to handle Video Director in New Test Team");
    positionActionSelect.focus();
    await user.keyboard("{Enter}{ArrowDown}{ArrowDown}{Enter}");
    expect(screen.getByLabelText("New position name for Video Director")).toHaveValue("Video Director");
    expect(screen.getAllByText("Create new position")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Continue to review" }));
    expect(await screen.findByRole("heading", { name: "Review changes" })).toBeInTheDocument();
    expect(previewPortableImport).toHaveBeenLastCalledWith("church-1", "members", expect.any(String), { firstName: "First Name", lastName: "Last Name", positions: "Positions" }, undefined, expect.objectContaining({ positionActions: [{ teamId: "team-1", sourceValue: "Video Director", action: "create", name: "Video Director" }] }));
    await user.click(screen.getByRole("button", { name: "Import 1 member" }));
    await waitFor(() => expect(commitPortableImport).toHaveBeenCalledWith("church-1", "members", expect.any(Array), undefined, expect.objectContaining({ positionActions: [{ teamId: "team-1", sourceValue: "Video Director", action: "create", name: "Video Director" }], previewToken: "approved" })));
  });

  it("keeps several missing and long position names readable in the matching step", async () => {
    const user = userEvent.setup();
    const longPosition = "Assistant Director of Contemporary Worship and Video Production";
    const csv = `First Name,Last Name,Positions\nJules,CSVTest,${longPosition} | Lighting`;
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name", "Positions"], rowCount: 1, columnCount: 3, issues: [], mapping: { firstName: "First Name", lastName: "Last Name", positions: "Positions" }, sampleRows: [], columnStats: { Positions: { nonBlank: 1, blank: 0 } } });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jules", lastName: "CSVTest", positions: `${longPosition} | Lighting` }, action: "create", matchedId: null, candidates: [], issues: [
      { field: "positions", referenceIndex: 0, referenceValue: longPosition, code: "missing_reference", message: "Position was not found.", teamId: "team-1", teamName: "New Test Team", positionOptions: [] },
      { field: "positions", referenceIndex: 1, referenceValue: "Lighting", code: "missing_reference", message: "Position was not found.", teamId: "team-1", teamName: "New Test Team", positionOptions: [] },
    ] }], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 } });
    const file = new File([csv], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "New Test Team", memberIds: [] }]} destinationTeamId="team-1" />);

    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review changes" }));

    expect(await screen.findByText("2 positions need attention")).toBeInTheDocument();
    expect(screen.getByText(longPosition)).toBeInTheDocument();
    expect(screen.getByText("Lighting")).toBeInTheDocument();
    expect(screen.getByLabelText(`How to handle ${longPosition} in New Test Team`)).toBeInTheDocument();
    expect(screen.getByLabelText("How to handle Lighting in New Test Team")).toBeInTheDocument();
  });

  it("resolves a missing source team once before reviewing member rows", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name", "Teams", "Positions"], rowCount: 1, columnCount: 4, issues: [], mapping: { firstName: "First Name", lastName: "Last Name", teams: "Teams", positions: "Positions" }, sampleRows: [], columnStats: { Teams: { nonBlank: 1, blank: 0 } } });
    const row = { row: 2, record: { firstName: "Jane", lastName: "Doe", teams: "CSV Test Media", positions: "Camera Operator" }, action: "review" as const, matchedId: null, candidates: [], issues: [{ field: "teams", referenceIndex: 0, referenceValue: "CSV Test Media", code: "missing_reference", message: "Choose or create a local team.", candidates: [] }] };
    const resolvedRow = { ...row, action: "create" as const, issues: [{ field: "positions", referenceIndex: 0, referenceValue: "Camera Operator", code: "missing_reference", message: "Create this position in the planned team.", teamId: "portable-pending-team-media", teamName: "CSV Test Media", positionOptions: [] }] };
    const fullyResolvedRow = { ...resolvedRow, issues: [] };
    jest.mocked(previewPortableImport)
      .mockResolvedValueOnce({ success: true, rows: [row], issues: [], summary: { total: 1, create: 0, update: 0, review: 1, invalid: 0 } })
      .mockResolvedValueOnce({ success: true, rows: [resolvedRow], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 } })
      .mockResolvedValueOnce({ success: true, rows: [fullyResolvedRow], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 } });
    const file = new File(["First Name,Last Name,Teams,Positions\nJane,Doe,CSV Test Media,Camera Operator"], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "First Name,Last Name,Teams,Positions\nJane,Doe,CSV Test Media,Camera Operator" });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }]} destinationTeamId="team-1" />);
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    expect(await screen.findByText("Team assignments found in your CSV. We'll use those assignments.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Which team are these members joining?")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    expect(await screen.findByRole("heading", { name: "Match teams" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Review changes" })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("How to handle team CSV Test Media"));
    await user.click(screen.getByRole("option", { name: "Create CSV Test Media" }));
    await user.click(screen.getByRole("button", { name: "Continue to positions" }));
    await waitFor(() => expect(previewPortableImport).toHaveBeenCalledTimes(2));
    expect(previewPortableImport).toHaveBeenLastCalledWith("church-1", "members", expect.any(String), { firstName: "First Name", lastName: "Last Name", teams: "Teams", positions: "Positions" }, undefined, expect.objectContaining({ teamActions: [{ sourceValue: "CSV Test Media", action: "create", name: "CSV Test Media" }] }));
    expect(await screen.findByRole("heading", { name: "Match positions" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Review changes" })).not.toBeInTheDocument();
    expect(screen.getByText("Camera Operator")).toBeInTheDocument();
    const positionAction = screen.getByLabelText("How to handle Camera Operator in CSV Test Media");
    await user.click(positionAction);
    await user.click(screen.getByRole("option", { name: "Create new position" }));
    await user.click(screen.getByRole("button", { name: "Continue to review" }));
    expect(await screen.findByRole("heading", { name: "Review changes" })).toBeInTheDocument();
    expect(previewPortableImport).toHaveBeenLastCalledWith("church-1", "members", expect.any(String), { firstName: "First Name", lastName: "Last Name", teams: "Teams", positions: "Positions" }, undefined, expect.objectContaining({ teamActions: [{ sourceValue: "CSV Test Media", action: "create", name: "CSV Test Media" }], positionActions: [{ teamId: "portable-pending-team-media", sourceValue: "Camera Operator", action: "create", name: "Camera Operator" }] }));
  });

  it("highlights the unresolved owning-team field when continuing position review", async () => {
    const user = userEvent.setup();
    const csv = "First Name,Last Name,Teams,Positions\nJane,Doe,Media | Worship,Camera Operator";
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name", "Teams", "Positions"], rowCount: 1, columnCount: 4, issues: [], mapping: { firstName: "First Name", lastName: "Last Name", teams: "Teams", positions: "Positions" }, sampleRows: [], columnStats: { Teams: { nonBlank: 1, blank: 0 } } });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe", teams: "Media | Worship", positions: "Camera Operator" }, action: "create", matchedId: null, candidates: [], issues: [{ field: "positions", referenceIndex: 0, referenceValue: "Camera Operator", code: "ambiguous_reference", message: "Choose the owning team.", teamOptions: [{ teamId: "team-media", name: "Media" }, { teamId: "team-worship", name: "Worship" }], positionOptions: [] }] }], issues: [], summary: { total: 1, create: 0, update: 0, review: 1, invalid: 0 } });
    const file = new File([csv], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" teams={[{ teamId: "team-media", churchId: "church-1", name: "Media", memberIds: [] }, { teamId: "team-worship", churchId: "church-1", name: "Worship", memberIds: [] }]} />);
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    expect(await screen.findByRole("heading", { name: "Match positions" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to review" }));
    const ownerField = screen.getByRole("combobox", { name: "Team that owns Camera Operator" });
    expect(ownerField).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the team that owns this position.");
  });

  it("keeps failed rows and their messages after a partial import", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name"], rowCount: 2, columnCount: 2, issues: [], mapping: { firstName: "First Name", lastName: "Last Name" }, sampleRows: [], columnStats: {} });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [
      { row: 2, record: { firstName: "Jane", lastName: "Doe" }, action: "create", matchedId: null, candidates: [], issues: [] },
      { row: 3, record: { firstName: "Alex", lastName: "Smith" }, action: "create", matchedId: null, candidates: [], issues: [] },
    ], issues: [], summary: { total: 2, create: 2, update: 0, review: 0, invalid: 0 } });
    jest.mocked(commitPortableImport)
      .mockResolvedValueOnce({ success: true, results: [{ row: 2, status: "created", id: "member-1" }, { row: 3, status: "failed", code: "temporary_failure", message: "Try this row again." }], summary: { created: 1, updated: 0, failed: 1 } })
      .mockResolvedValueOnce({ success: true, results: [{ row: 3, status: "created", id: "member-2" }], summary: { created: 1, updated: 0, failed: 0 } });
    const csv = "First Name,Last Name\nJane,Doe\nAlex,Smith";
    const file = new File([csv], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    const onOpenChange = jest.fn();
    render(<PortableDataImportDialog open onOpenChange={onOpenChange} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }]} destinationTeamId="team-1" />);
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    await user.click(screen.getByRole("button", { name: "Import 2 members" }));
    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Completed (excluded from retry)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry 1 failed row" })).toBeInTheDocument();
    expect(screen.getByText("Import failed: Try this row again.")).toBeInTheDocument();
    expect(screen.queryByText("Jane Doe Skipped")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import 0 members" })).not.toBeInTheDocument();
    expect(screen.getByText("Failed", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry 1 failed row" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Retry 1 failed row" }));
    await waitFor(() => expect(commitPortableImport).toHaveBeenCalledTimes(2));
    expect(commitPortableImport).toHaveBeenLastCalledWith("church-1", "members", [expect.objectContaining({ row: 3, record: { firstName: "Alex", lastName: "Smith" } })], undefined, expect.any(Object));
    expect(screen.queryByText("Import failed: Preview this file again.")).not.toBeInTheDocument();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockShowToast).toHaveBeenCalledWith("Members imported successfully. 2 added.", "success");
  });

  it("completes when unresolved rows are explicitly skipped", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name"], rowCount: 2, columnCount: 2, issues: [], mapping: { firstName: "First Name", lastName: "Last Name" }, sampleRows: [], columnStats: {} });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [
      { row: 2, record: { firstName: "Jane", lastName: "Doe" }, action: "create", matchedId: null, candidates: [], issues: [] },
      { row: 3, record: { firstName: "Alex", lastName: "Smith" }, action: "review", matchedId: null, candidates: [], issues: [{ field: "firstName", code: "ambiguous_match", message: "Choose an action." }] },
    ], issues: [], summary: { total: 2, create: 1, update: 0, review: 1, invalid: 0 } });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "created", id: "member-1" }], summary: { created: 1, updated: 0, failed: 0 } });
    const csv = "First Name,Last Name\nJane,Doe\nAlex,Smith";
    const file = new File([csv], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    const onOpenChange = jest.fn();
    const ControlledDialog = () => {
      const [open, setOpen] = useState(true);
      return <PortableDataImportDialog open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }]} destinationTeamId="team-1" />;
    };
    render(<ControlledDialog />);
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    expect(screen.getByRole("button", { name: "Import 1 member" })).toBeEnabled();
    await user.click(screen.getByLabelText("Action for row 3"));
    await user.click(screen.getByRole("option", { name: "Skip row" }));
    await user.click(screen.getByRole("button", { name: "Import 1 member" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockShowToast).toHaveBeenCalledWith("Import completed. 1 added · 1 skipped.", "success");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("requires a fresh preview after a stale-preview failure", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["Name"], rowCount: 1, columnCount: 1, issues: [], mapping: { name: "Name" }, sampleRows: [], columnStats: {} });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { name: "Example" }, action: "create", matchedId: null, candidates: [], issues: [] }], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 }, previewToken: "old-token" });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "failed", code: "stale_preview", message: "Preview the file again." }], summary: { created: 0, updated: 0, failed: 1 } });
    const csv = "Name\nExample";
    const file = new File([csv], "portable.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="teams" />);
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review import" }));
    await user.click(screen.getByRole("button", { name: "Import 1 row" }));
    expect(await screen.findByRole("button", { name: "Review changes again" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Retry 1 failed row" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review changes again" }));
    await waitFor(() => expect(previewPortableImport).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Import 1 row" })).toBeEnabled();
    expect(screen.getByText("This preview is stale. Review the refreshed changes before retrying.")).toBeInTheDocument();
  });

  it("summarizes updated and unchanged committed rows from server results", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name"], rowCount: 2, columnCount: 2, issues: [], mapping: { firstName: "First Name", lastName: "Last Name" }, sampleRows: [], columnStats: {} });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [
      { row: 2, record: { firstName: "Jane", lastName: "Doe" }, action: "update", matchedId: "member-1", candidates: [], issues: [], changes: [{ field: "Phone", before: "", after: "555-0100" }] },
      { row: 3, record: { firstName: "Alex", lastName: "Smith" }, action: "update", matchedId: "member-2", candidates: [], issues: [], changes: [] },
    ], issues: [], summary: { total: 2, create: 0, update: 1, review: 0, invalid: 0 } });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "updated", id: "member-1" }, { row: 3, status: "unchanged", id: "member-2" }], summary: { created: 0, updated: 1, unchanged: 1, failed: 0 } });
    const csv = "First Name,Last Name\nJane,Doe\nAlex,Smith";
    const file = new File([csv], "members.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    const onImported = jest.fn();
    const ControlledDialog = () => {
      const [open, setOpen] = useState(true);
      return <PortableDataImportDialog open={open} onOpenChange={setOpen} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }]} destinationTeamId="team-1" onImported={onImported} />;
    };
    render(<ControlledDialog />);
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    await user.click(await screen.findByRole("button", { name: "Import 2 members" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockShowToast).toHaveBeenCalledWith("Import completed. 1 updated · 1 unchanged.", "success");
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it.each(["teams", "positions", "services", "schedules"] as const)("closes a successful %s import", async (type) => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["Name"], rowCount: 1, columnCount: 1, issues: [], mapping: { name: "Name" }, sampleRows: [], columnStats: {} });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { name: "Example" }, action: "create", matchedId: null, candidates: [], issues: [] }], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 } });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "created", id: "entity-1" }], summary: { created: 1, updated: 0, failed: 0 } });
    const csv = "Name\nExample";
    const file = new File([csv], "portable.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    const onOpenChange = jest.fn();
    const ControlledDialog = () => {
      const [open, setOpen] = useState(true);
      return <PortableDataImportDialog open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }} churchId="church-1" type={type} />;
    };
    render(<ControlledDialog />);
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review import" }));
    await user.click(await screen.findByRole("button", { name: "Import 1 row" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const entity = type[0].toUpperCase() + type.slice(1);
    expect(mockShowToast).toHaveBeenCalledWith(`${entity} imported successfully. 1 added.`, "success");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reports saved imports clearly when the page refresh fails", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["Name"], rowCount: 1, columnCount: 1, issues: [], mapping: { name: "Name" }, sampleRows: [], columnStats: {} });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { name: "Example" }, action: "create", matchedId: null, candidates: [], issues: [] }], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 } });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "created", id: "team-1" }], summary: { created: 1, updated: 0, failed: 0 } });
    const csv = "Name\nExample";
    const file = new File([csv], "teams.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    const onOpenChange = jest.fn();
    const onImported = jest.fn().mockRejectedValue(new Error("refresh unavailable"));
    const ControlledDialog = () => {
      const [open, setOpen] = useState(true);
      return <PortableDataImportDialog open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }} churchId="church-1" type="teams" onImported={onImported} />;
    };
    render(<ControlledDialog />);
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review import" }));
    await user.click(await screen.findByRole("button", { name: "Import 1 row" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("Teams imported successfully. 1 added. The page could not refresh"), "warning");
  });

  it("shows contextual notices for recognized member columns during review", async () => {
    const user = userEvent.setup();
    const csv = "First Name,Last Name,Status,SMS Opt-In,Timezone,Skill Tiers\nJane,Doe,Inactive,Yes,America/New_York,Camera 2";
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name", "Status", "SMS Opt-In", "Timezone", "Skill Tiers"], rowCount: 1, columnCount: 6, issues: [], mapping: { firstName: "First Name", lastName: "Last Name", status: "Status", smsOptIn: "SMS Opt-In", timezone: "Timezone", skillTiers: "Skill Tiers" }, sampleRows: [], columnStats: {} });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe", status: "Inactive", smsOptIn: "Yes", timezone: "America/New_York", skillTiers: "Camera 2" }, action: "create", matchedId: null, candidates: [], issues: [] }], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 } });
    const file = new File([csv], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }]} destinationTeamId="team-1" />);

    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    expect(screen.queryByText(/SMS preferences/)).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Review changes" }));

    expect(await screen.findByText("Some CSV fields won't be imported")).toBeInTheDocument();
    await user.click(screen.getByText("Some CSV fields won't be imported"));
    expect(screen.getByText("Skill tiers, Timezone, SMS Opt-In are recognized but won't change existing WorshipSync information.")).toBeInTheDocument();
    expect(screen.getByText("Some source records are inactive or archived. Imports won't archive or restore members; skip rows that should remain unchanged.")).toBeInTheDocument();
  });

  it("makes replaced position removals clear before importing an existing member", async () => {
    const user = userEvent.setup();
    const csv = "First Name,Last Name,Phone,Positions\nJane,Doe,555-0199,Keys";
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name", "Phone", "Positions"], rowCount: 1, columnCount: 4, issues: [], mapping: { firstName: "First Name", lastName: "Last Name", phone: "Phone", positions: "Positions" }, sampleRows: [], columnStats: {} });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe", phone: "555-0199", positions: "Keys" }, action: "update", matchedId: "member-1", candidates: [], issues: [], changes: [{ field: "Phone", before: "555-0100", after: "555-0199" }, { field: "Position", before: "Camera Operator", after: "" }] }], issues: [], summary: { total: 1, create: 0, update: 1, review: 0, invalid: 0 } });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "updated", id: "member-1" }], summary: { created: 0, updated: 1, failed: 0 } });
    const file = new File([csv], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }]} destinationTeamId="team-1" />);

    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("radio", { name: /Replace positions in the selected team/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Review changes" }));

    expect(await screen.findByText("Position removed from Worship: Camera Operator")).toBeInTheDocument();
    expect(screen.getByText("Phone: 555-0100 -> 555-0199")).toBeInTheDocument();
    expect(screen.getByText("Other team memberships and positions outside this import scope are preserved.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace positions and import 1 member" }));
    expect(commitPortableImport).toHaveBeenCalledWith("church-1", "members", [expect.objectContaining({ row: 2, action: "update", recordId: "member-1" })], undefined, expect.objectContaining({ updateMode: "replace" }));
  });

  it("invalidates the preview when import settings, mappings, or the file change", async () => {
    const user = userEvent.setup();
    const csv = "First Name,Last Name,Teams\nJane,Doe,Worship\nJanet,Smith,";
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name", "Teams"], rowCount: 2, columnCount: 3, issues: [], mapping: { firstName: "First Name", lastName: "Last Name", teams: "Teams" }, sampleRows: [], columnStats: { Teams: { nonBlank: 1, blank: 1 } } });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe", teams: "Worship" }, action: "create", matchedId: null, candidates: [], issues: [] }], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 }, previewToken: "signed-preview" });
    const file = new File([csv], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] }, { teamId: "team-2", churchId: "church-1", name: "Production", memberIds: [] }]} destinationTeamId="team-1" />);
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    expect(await screen.findByText("1 row found")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("button", { name: "Back to setup and mapping" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Back to setup and mapping" }));
    await user.click(await screen.findByRole("radio", { name: /Replace positions in the imported teams/ }));
    expect(screen.queryByText("1 row found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review changes" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review column mapping" }));
    await user.click(screen.getByLabelText("Column for First name"));
    await user.click(screen.getByRole("option", { name: "Last Name" }));
    expect(screen.queryByText("1 row found")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Which team are these members joining?"));
    await user.click(screen.getByRole("option", { name: "Production" }));
    expect(screen.queryByText("1 row found")).not.toBeInTheDocument();
    await user.click(screen.getByText("Advanced options"));
    await user.click(screen.getByRole("checkbox", { name: /Clear existing information when CSV cells are blank/ }));
    expect(screen.queryByText("1 row found")).not.toBeInTheDocument();
    expect(commitPortableImport).not.toHaveBeenCalled();

    const replacement = new File([csv.replace("Jane", "Janet")], "replacement.csv", { type: "text/csv" });
    Object.defineProperty(replacement, "text", { value: async () => csv.replace("Jane", "Janet") });
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [replacement] } });
    expect(screen.queryByText("1 row found")).not.toBeInTheDocument();
  });
});
