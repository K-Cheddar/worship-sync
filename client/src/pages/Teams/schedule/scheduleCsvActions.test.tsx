import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Button from "../../../components/Button/Button";
import Menu from "../../../components/Menu/Menu";
import { downloadPortableData } from "../../../api/auth";
import { createScheduleCsvMenuItems } from "./scheduleCsvActions";

jest.mock("../../../api/auth", () => ({ downloadPortableData: jest.fn() }));

describe("schedule CSV overflow actions", () => {
  it("imports schedules and clearly exports all schedules", async () => {
    const user = userEvent.setup();
    const onImport = jest.fn();
    const setExportBusy = jest.fn();
    jest.mocked(downloadPortableData).mockResolvedValue({ blob: new Blob(), filename: "schedules.csv" });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: jest.fn(() => "blob:test") });
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(
      <Menu
        TriggeringButton={<Button type="button">More schedule options</Button>}
        menuItems={createScheduleCsvMenuItems({
          churchId: "church-1",
          onImport,
          onExportError: jest.fn(),
          exportBusy: false,
          setExportBusy,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More schedule options" }));
    await user.click(screen.getByRole("menuitem", { name: "Import CSV…" }));
    expect(onImport).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "More schedule options" }));
    expect(screen.getByText("All schedules")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Export CSV/ }));
    expect(downloadPortableData).toHaveBeenCalledWith("church-1", "schedules", false, expect.any(String));
    expect(setExportBusy).toHaveBeenCalledWith(true);
  });
});
