/* eslint-disable testing-library/no-node-access -- Compare the decorative icon SVG directly to verify its identity. */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AccountPage from "../Account";
import { GlobalInfoContext } from "../../context/globalInfo";
import { PAGE_APPEARANCES } from "../pageAppearances";
import { getLucideIconInnerMarkup } from "../../test/lucideIconTestUtils";

jest.mock("../../components/HomeToolbarMenu/HomeToolbarMenu", () => () => <button>Menu</button>);
jest.mock("../../containers/Toolbar/ToolbarElements/UserSection", () => () => null);
jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ undoable: { present: { preferences: { scrollbarWidth: "thin" } } } }),
}));
jest.mock("../Account/AccountPageContext", () => ({
  AccountPageProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAccountPage: () => ({ canManage: false, toolbarLogos: null }),
}));

describe("Account page identity", () => {
  it("renders the shared administration icon through AppWorkspaceShell", () => {
    render(
      <MemoryRouter initialEntries={["/account/people"]}>
        <GlobalInfoContext.Provider
          value={{ loginState: "success", churchName: "Northside" } as never}
        >
          <Routes>
            <Route path="/account/*" element={<AccountPage />} />
          </Routes>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    const title = screen.getByTestId("app-workspace-title");
    const titleIcon = title.querySelector("svg");
    expect(title).toHaveTextContent("Church administration");
    expect(titleIcon?.innerHTML).toBe(
      getLucideIconInnerMarkup(PAGE_APPEARANCES.churchAdministration.icon),
    );
    expect(titleIcon?.parentElement).toHaveClass(
      PAGE_APPEARANCES.churchAdministration.iconColorClass,
    );
    expect(screen.getByTestId("app-workspace-toolbar")).toHaveClass(
      "h-[48px]",
      "min-h-[48px]",
    );
  });
});
