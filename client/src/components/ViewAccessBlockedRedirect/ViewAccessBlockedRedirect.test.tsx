import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ViewAccessBlockedRedirect from "./ViewAccessBlockedRedirect";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";

const renderGuard = (overrides: Record<string, unknown>, initialEntry = "/projector") =>
  render(
    <GlobalInfoContext.Provider value={createMockGlobalContext(overrides) as any}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/projector"
            element={
              <ViewAccessBlockedRedirect>
                <div data-testid="display-page">Display page</div>
              </ViewAccessBlockedRedirect>
            }
          />
          <Route path="/home" element={<div data-testid="home-page">Home</div>} />
        </Routes>
      </MemoryRouter>
    </GlobalInfoContext.Provider>
  );

describe("ViewAccessBlockedRedirect", () => {
  it("allows paired display sessions onto display routes", () => {
    renderGuard({
      sessionKind: "display",
      access: "view",
      loginState: "success",
      device: { surfaceType: "projector" },
    });

    expect(screen.getByTestId("display-page")).toBeInTheDocument();
    expect(screen.queryByTestId("home-page")).not.toBeInTheDocument();
  });

  it("redirects view-only human sessions away from blocked routes", async () => {
    renderGuard({
      sessionKind: "human",
      access: "view",
      loginState: "success",
    });

    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    expect(screen.queryByTestId("display-page")).not.toBeInTheDocument();
  });
});
