import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountDataTransferPage from "./AccountDataTransferPage";
import { commitPortableImport, inspectPortableImport, previewPortableImport } from "../../../api/auth";

jest.mock("../AccountPageContext", () => ({
  useAccountPage: () => ({ churchId: "church-1" }),
}));

jest.mock("../../../api/auth", () => ({
  commitPortableImport: jest.fn(),
  downloadPortableData: jest.fn(),
  inspectPortableImport: jest.fn(),
  previewPortableImport: jest.fn(),
}));

describe("AccountDataTransferPage import flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    render(<AccountDataTransferPage />);
    fireEvent.change(screen.getByLabelText("Choose Members CSV"), { target: { files: [file] } });
    expect(await screen.findByText("1 row · 2 columns detected")).toBeInTheDocument();
    expect(commitPortableImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Review import" }));
    expect(await screen.findByText("1 row found")).toBeInTheDocument();
    expect(commitPortableImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Import 1 row" }));
    await waitFor(() => expect(commitPortableImport).toHaveBeenCalledWith("church-1", "members", [expect.objectContaining({ row: 2, action: "create", resolutions: {} })]));
    expect(await screen.findByRole("status")).toHaveTextContent("Imported 1 · Updated 0 · Failed 0 · Skipped 0.");
  });

  it("lets an admin resolve an ambiguous relationship before import", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name", "Positions"], rowCount: 1, columnCount: 3, issues: [], mapping: { firstName: "First Name", lastName: "Last Name", positions: "Positions" }, sampleRows: [] });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe", positions: "Keys" }, action: "review", matchedId: null, candidates: [], issues: [{ field: "positions", code: "ambiguous_reference", message: "Choose which position to use.", candidates: [{ id: "position-a", name: "Keys" }, { id: "position-b", name: "Keys" }] }] }], issues: [], summary: { total: 1, create: 0, update: 0, review: 1, invalid: 0 } });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "created", id: "member-1" }], summary: { created: 1, updated: 0, failed: 0 } });
    const file = new File(["First Name,Last Name,Positions\nJane,Doe,Keys"], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "First Name,Last Name,Positions\nJane,Doe,Keys" });
    render(<AccountDataTransferPage />);
    fireEvent.change(screen.getByLabelText("Choose Members CSV"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review import" }));
    await user.selectOptions(await screen.findByLabelText("Resolve Positions for row 2"), "position-b");
    await user.selectOptions(screen.getByLabelText("Action for row 2"), "create");
    await user.click(screen.getByRole("button", { name: "Import 1 row" }));
    await waitFor(() => expect(commitPortableImport).toHaveBeenCalledWith("church-1", "members", [expect.objectContaining({ resolutions: { positions: "position-b" } })]));
  });

  it("keeps failed rows and their messages after a partial import", async () => {
    const user = userEvent.setup();
    jest.mocked(inspectPortableImport).mockResolvedValue({ success: true, headers: ["First Name", "Last Name"], rowCount: 1, columnCount: 2, issues: [], mapping: { firstName: "First Name", lastName: "Last Name" }, sampleRows: [] });
    jest.mocked(previewPortableImport).mockResolvedValue({ success: true, rows: [{ row: 2, record: { firstName: "Jane", lastName: "Doe" }, action: "create", matchedId: null, candidates: [], issues: [] }], issues: [], summary: { total: 1, create: 1, update: 0, review: 0, invalid: 0 } });
    jest.mocked(commitPortableImport).mockResolvedValue({ success: true, results: [{ row: 2, status: "failed", code: "stale_preview", message: "Preview this file again." }], summary: { created: 0, updated: 0, failed: 1 } });
    const file = new File(["First Name,Last Name\nJane,Doe"], "people.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "First Name,Last Name\nJane,Doe" });
    render(<AccountDataTransferPage />);
    fireEvent.change(screen.getByLabelText("Choose Members CSV"), { target: { files: [file] } });
    await user.click(await screen.findByRole("button", { name: "Review import" }));
    await user.click(screen.getByRole("button", { name: "Import 1 row" }));
    expect(await screen.findByText("Import failed: Preview this file again.")).toBeInTheDocument();
    expect(screen.getByText("1 row found")).toBeInTheDocument();
  });
});
