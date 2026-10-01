import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AccountDataTransferPage from "./AccountDataTransferPage";
import { downloadPortableData } from "../../../api/auth";

jest.mock("../AccountPageContext", () => ({
  useAccountPage: () => ({ churchId: "church-1" }),
}));

jest.mock("../../../api/auth", () => ({
  downloadPortableData: jest.fn(),
}));

describe("AccountDataTransferPage", () => {
  it("offers only the ZIP export for the supported CSV domains", async () => {
    jest.mocked(downloadPortableData).mockResolvedValue({
      blob: new Blob(["zip"]),
      filename: "worshipsync-export.zip",
    });
    const createObjectURL = jest.fn(() => "blob:test");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<AccountDataTransferPage />);
    expect(screen.getByRole("heading", { name: "Data export" })).toBeInTheDocument();
    expect(screen.getByText("Download members, teams, positions, services, and schedules as CSV files.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download all CSVs" })).toBeInTheDocument();
    expect(screen.queryByText("Import")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download all CSVs" }));
    await waitFor(() => expect(downloadPortableData).toHaveBeenCalledWith("church-1", "all", false, expect.any(String)));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    createObjectURL.mockRestore();
    click.mockRestore();
  });
});
