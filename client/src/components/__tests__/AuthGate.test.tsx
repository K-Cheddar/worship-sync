import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AuthGate from "../AuthGate";
import { GlobalInfoContext } from "../../context/globalInfo";

type GlobalInfoValue = ComponentProps<
  typeof GlobalInfoContext.Provider
>["value"];

const gateContext = (overrides: Record<string, unknown> = {}) =>
  ({
    bootstrapStatus: "ready",
    loginState: "success",
    sessionKind: "human" as const,
    operatorName: "Alex",
    ...overrides,
  }) as GlobalInfoValue;

const renderWithGate = (
  overrides: Record<string, unknown>,
  allowedKinds: ("human" | "workstation" | "display")[],
  initialEntry = "/controller"
) =>
  render(
    <GlobalInfoContext.Provider value={gateContext(overrides)}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/controller"
            element={
              <AuthGate allowedKinds={allowedKinds}>
                <div data-testid="protected">Protected</div>
              </AuthGate>
            }
          />
          <Route
            path="/projector"
            element={
              <AuthGate allowedKinds={allowedKinds}>
                <div data-testid="projector-surface">Projector</div>
              </AuthGate>
            }
          />
          <Route
            path="/workstation/operator"
            element={<div data-testid="operator-page">Operator</div>}
          />
        </Routes>
      </MemoryRouter>
    </GlobalInfoContext.Provider>
  );

describe("AuthGate", () => {
  it("shows a loading screen while bootstrap or sign-in is loading", () => {
    renderWithGate(
      { bootstrapStatus: "loading", loginState: "loading" },
      ["human", "workstation"]
    );
    expect(screen.getByText("Checking your access...")).toBeInTheDocument();
    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
  });

  it("renders children when session kind is allowed", () => {
    renderWithGate(
      { sessionKind: "human", operatorName: "" },
      ["human", "workstation"]
    );
    expect(screen.getByTestId("protected")).toBeInTheDocument();
  });

  it("sends workstation sessions without an operator name to the operator prompt", async () => {
    renderWithGate(
      {
        sessionKind: "workstation",
        operatorName: "",
      },
      ["human", "workstation"]
    );

    expect(await screen.findByTestId("operator-page")).toBeInTheDocument();
    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
  });

  it("allows workstation sessions without an operator on display output routes", () => {
    renderWithGate(
      {
        sessionKind: "workstation",
        operatorName: "",
      },
      ["human", "display", "workstation"],
      "/projector"
    );

    expect(screen.getByTestId("projector-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("operator-page")).not.toBeInTheDocument();
  });

  it("shows the display link message when display is required but not signed in", () => {
    renderWithGate({ sessionKind: null, loginState: "guest" }, ["human", "display"]);
    expect(
      screen.getByText("This display isn’t linked yet")
    ).toBeInTheDocument();
  });
});
