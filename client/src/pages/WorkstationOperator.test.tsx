import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WorkstationOperator from "./WorkstationOperator";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";

describe("WorkstationOperator", () => {
  it("auto focuses the operator name input for shared workstation login", () => {
    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            sessionKind: "workstation",
            device: {
              deviceId: "workstation-1",
              label: "Front Booth",
              surfaceType: "workstation",
            },
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/workstation/operator"]}>
          <Routes>
            <Route path="/workstation/operator" element={<WorkstationOperator />} />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>,
    );

    expect(
      screen.getByRole("textbox", { name: /operator name/i }),
    ).toHaveFocus();
  });
});
