import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AppEntry from "./AppEntry";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";

describe("AppEntry", () => {
  it("redirects shared workstation from root to /home (matches human Home navigation)", async () => {
    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            sessionKind: "workstation",
            operatorName: "Alex",
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<AppEntry />} />
            <Route path="/home" element={<div data-testid="home-hub">Home hub</div>} />
            <Route path="/controller" element={<div data-testid="controller">Controller</div>} />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>
    );

    expect(await screen.findByTestId("home-hub")).toBeInTheDocument();
    expect(screen.queryByTestId("controller")).not.toBeInTheDocument();
  });
});
