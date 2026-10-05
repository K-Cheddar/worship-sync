import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PortableDataImportDialog from "./PortableDataImportDialog";
import { commitPortableImport, inspectPortableImport, previewPortableImport } from "../../api/auth";

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
    expect(screen.getByRole("button", { name: "Choose Schedules CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download CSV template" })).toBeInTheDocument();
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
    });
    jest.mocked(previewPortableImport).mockResolvedValue({
      success: true,
      rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe" }, action: "create", matchedId: null, candidates: [], issues: [] }],
      issues: [],
      summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 },
    });
    jest.mocked(commitPortableImport).mockResolvedValue({
      success: true,
      results: [{ row: 2, status: "created", id: "member-1" }],
      summary: { created: 1, updated: 0, failed: 0 },
    });
    const file = new File(["first_name,last_name\nJane,Doe"], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "first_name,last_name\nJane,Doe" });
    const onImported = jest.fn();

    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" onImported={onImported} />);
    expect(screen.queryByRole("group", { name: "Choose data to import" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose Members CSV"), { target: { files: [file] } });
    expect(await screen.findByText("1 row · 2 columns detected")).toBeInTheDocument();
    expect(commitPortableImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Review import" }));
    expect(await screen.findByText("1 row found")).toBeInTheDocument();
    expect(commitPortableImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Import 1 row" }));
    await waitFor(() => expect(commitPortableImport).toHaveBeenCalledWith("church-1", "members", [expect.objectContaining({ row: 2, action: "create", resolutions: [] })]));
    expect(await screen.findByRole("status")).toHaveTextContent("Imported 1 · Updated 0 · Failed 0 · Skipped 0.");
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("lets an admin resolve an ambiguous relationship before import", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name", "Positions"], rowCount: 1, columnCount: 3, issues: [], mapping: { firstName: "First Name", lastName: "Last Name", positions: "Positions" }, sampleRows: [] });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe", positions: "Keys" }, action: "review", matchedId: null, candidates: [], issues: [{ field: "positions", referenceIndex: 0, referenceValue: "Keys", code: "ambiguous_reference", message: "Choose which position to use.", candidates: [{ id: "position-a", name: "Keys" }, { id: "position-b", name: "Keys" }] }] }], issues: [], summary: { total: 1, create: 0, update: 0, review: 1, invalid: 0 } });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "created", id: "member-1" }], summary: { created: 1, updated: 0, failed: 0 } });
    const file = new File(["First Name,Last Name,Positions\nJane,Doe,Keys"], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "First Name,Last Name,Positions\nJane,Doe,Keys" });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" />);
    fireEvent.change(screen.getByLabelText("Choose Members CSV"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review import" }));
    await user.click(await screen.findByLabelText("Resolve Position: Keys for row 2"));
    await user.click(screen.getAllByRole("option", { name: "Keys" })[1]);
    await user.click(screen.getByLabelText("Action for row 2"));
    await user.click(screen.getAllByRole("option", { name: "Create new" })[0]);
    await user.click(screen.getByRole("button", { name: "Import 1 row" }));
    await waitFor(() => expect(commitPortableImport).toHaveBeenCalledWith("church-1", "members", [expect.objectContaining({ resolutions: [{ field: "positions", referenceIndex: 0, selectedId: "position-b" }] })]));
  });

  it("keeps same-field relationship choices independent and sends both", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name", "Teams", "Positions"], rowCount: 1, columnCount: 4, issues: [], mapping: { firstName: "First Name", lastName: "Last Name", teams: "Teams", positions: "Positions" }, sampleRows: [] });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe", teams: "Praise | Media", positions: "Vocalist | Keys" }, action: "review", matchedId: null, candidates: [], issues: [
      { field: "teams", referenceIndex: 0, referenceValue: "Praise", code: "ambiguous_reference", message: "Choose a team.", candidates: [{ id: "praise-a", name: "Praise" }, { id: "praise-b", name: "Praise" }] },
      { field: "teams", referenceIndex: 1, referenceValue: "Media", code: "ambiguous_reference", message: "Choose a team.", candidates: [{ id: "media-a", name: "Media" }, { id: "media-b", name: "Media" }] },
      { field: "positions", referenceIndex: 0, referenceValue: "Vocalist", code: "ambiguous_reference", message: "Choose a position.", candidates: [{ id: "vocal-a", name: "Vocalist" }, { id: "vocal-b", name: "Vocalist" }] },
      { field: "positions", referenceIndex: 1, referenceValue: "Keys", code: "ambiguous_reference", message: "Choose a position.", candidates: [{ id: "keys-a", name: "Keys" }, { id: "keys-b", name: "Keys" }] },
    ] }], issues: [], summary: { total: 1, create: 0, update: 0, review: 1, invalid: 0 } });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "created", id: "member-1" }], summary: { created: 1, updated: 0, failed: 0 } });
    const file = new File(["First Name,Last Name,Teams,Positions\nJane,Doe,Praise | Media,Vocalist | Keys"], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "First Name,Last Name,Teams,Positions\nJane,Doe,Praise | Media,Vocalist | Keys" });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" />);
    fireEvent.change(screen.getByLabelText("Choose Members CSV"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review import" }));
    await user.click(await screen.findByLabelText("Resolve Team: Praise for row 2"));
    await user.click(screen.getAllByRole("option", { name: "Praise" })[0]);
    await user.click(await screen.findByLabelText("Resolve Team: Media for row 2"));
    await user.click(screen.getAllByRole("option", { name: "Media" })[1]);
    await user.click(await screen.findByLabelText("Resolve Position: Vocalist for row 2"));
    await user.click(screen.getAllByRole("option", { name: "Vocalist" })[1]);
    await user.click(await screen.findByLabelText("Resolve Position: Keys for row 2"));
    await user.click(screen.getAllByRole("option", { name: "Keys" })[0]);
    await user.click(screen.getByLabelText("Action for row 2"));
    await user.click(screen.getAllByRole("option", { name: "Create new" })[0]);
    await user.click(screen.getByRole("button", { name: "Import 1 row" }));
    await waitFor(() => expect(commitPortableImport).toHaveBeenCalledWith("church-1", "members", [expect.objectContaining({ resolutions: [
      { field: "teams", referenceIndex: 0, selectedId: "praise-a" },
      { field: "teams", referenceIndex: 1, selectedId: "media-b" },
      { field: "positions", referenceIndex: 0, selectedId: "vocal-b" },
      { field: "positions", referenceIndex: 1, selectedId: "keys-a" },
    ] })]));
  });

  it("keeps failed rows and their messages after a partial import", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name"], rowCount: 1, columnCount: 2, issues: [], mapping: { firstName: "First Name", lastName: "Last Name" }, sampleRows: [] });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe" }, action: "create", matchedId: null, candidates: [], issues: [] }], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 } });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "failed", code: "stale_preview", message: "Preview this file again." }], summary: { created: 0, updated: 0, failed: 1 } });
    const file = new File(["First Name,Last Name\nJane,Doe"], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "First Name,Last Name\nJane,Doe" });
    render(<PortableDataImportDialog open onOpenChange={() => undefined} churchId="church-1" type="members" />);
    fireEvent.change(screen.getByLabelText("Choose Members CSV"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review import" }));
    await user.click(screen.getByRole("button", { name: "Import 1 row" }));
    expect(await screen.findByText("Import failed: Preview this file again.")).toBeInTheDocument();
    expect(screen.getByText("1 row found")).toBeInTheDocument();
  });
});
