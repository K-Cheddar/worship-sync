import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalInfoContext } from "@/context/globalInfo";
import { downloadPortableData } from "../../api/auth";
import PortableDataActions from "./PortableDataActions";
import type { PortableDataType } from "../../api/authTypes";

jest.mock("../../api/auth", () => ({
  downloadPortableData: jest.fn(),
  commitPortableImport: jest.fn(),
  inspectPortableImport: jest.fn(),
  previewPortableImport: jest.fn(),
}));

const renderActions = (role: string, type: PortableDataType) => render(
  <GlobalInfoContext.Provider value={{ churchId: "church-1", role } as never}>
    <PortableDataActions type={type} />
  </GlobalInfoContext.Provider>,
);

describe("PortableDataActions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows no transfer action to non-admin users", () => {
    renderActions("editor", "teams");
    expect(screen.queryByRole("button", { name: "More data options" })).not.toBeInTheDocument();
  });

  it.each([
    ["members", "Members"],
    ["teams", "Teams"],
    ["positions", "Positions"],
    ["services", "Services"],
  ] as const)("launches the fixed %s import", async (type, label) => {
    const user = userEvent.setup();
    renderActions("admin", type);
    await user.click(screen.getByRole("button", { name: "More data options" }));
    await user.click(screen.getByRole("menuitem", { name: "Import CSV…" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(`Import ${label} from CSV`);
    expect(screen.queryByRole("group", { name: "Choose data to import" })).not.toBeInTheDocument();
  });

  it("exports the configured entity using the local timezone", async () => {
    const user = userEvent.setup();
    jest.mocked(downloadPortableData).mockResolvedValue({ blob: new Blob(), filename: "teams.csv" });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: jest.fn(() => "blob:test") });
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderActions("admin", "teams");
    await user.click(screen.getByRole("button", { name: "More data options" }));
    await user.click(screen.getByRole("menuitem", { name: "Export CSV" }));
    expect(downloadPortableData).toHaveBeenCalledWith("church-1", "teams", false, expect.any(String));
  });
});
