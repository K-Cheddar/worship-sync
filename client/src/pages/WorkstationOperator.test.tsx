import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import WorkstationOperator from "./WorkstationOperator";
import AuthGate from "../components/AuthGate";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";
import * as authApi from "../api/auth";

const RequestedRoute = () => {
  const location = useLocation();
  return (
    <div data-testid="requested-current-service">
      {location.pathname}{location.search}{location.hash}
    </div>
  );
};

const WorkstationContext = ({
  permissions,
}: {
  permissions: { teams: "view" | "none"; services: "view" | "none" };
}) => {
  const [operatorName, setOperatorName] = useState("");
  const value = useMemo(
    () =>
      createMockGlobalContext({
        loginState: "success",
        bootstrapStatus: "ready",
        sessionKind: "workstation",
        operatorName,
        setOperatorName,
        permissions,
        role: "operator",
        device: {
          deviceId: "workstation-1",
          label: "Front Booth",
          surfaceType: "workstation",
        },
      }),
    [operatorName, permissions],
  );

  return (
    <GlobalInfoContext.Provider value={value as any}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/current-service",
            search: "?tab=plan",
            hash: "#item-2",
          },
        ]}
      >
        <Routes>
          <Route
            path="/current-service"
            element={
              <AuthGate allowedKinds={["human", "workstation"]}>
                <RequestedRoute />
              </AuthGate>
            }
          />
          <Route path="/controller" element={<div>Presentation Controller</div>} />
          <Route
            path="/workstation/operator"
            element={<WorkstationOperator />}
          />
        </Routes>
      </MemoryRouter>
    </GlobalInfoContext.Provider>
  );
};

describe("WorkstationOperator", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the shared screen while the workstation session is loading", () => {
    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            bootstrapStatus: "loading",
            loginState: "loading",
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

    expect(screen.getByText("Getting WorshipSync ready")).toBeInTheDocument();
    expect(screen.getByText("Preparing your workspace…")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /operator name/i })).not.toBeInTheDocument();
  });

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

  it("returns a named workstation to its authorized requested route with query and hash", async () => {
    const user = userEvent.setup();
    const updateOperator = jest
      .spyOn(authApi, "updateWorkstationOperator")
      .mockResolvedValue({ success: true, workstation: {} as never });

    render(<WorkstationContext permissions={{ teams: "view", services: "none" }} />);

    await user.type(
      await screen.findByRole("textbox", { name: /operator name/i }),
      "Alex",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByTestId("requested-current-service")).toHaveTextContent(
      "/current-service?tab=plan#item-2",
    );
    expect(screen.queryByText("Presentation Controller")).not.toBeInTheDocument();
    expect(updateOperator).toHaveBeenCalledWith("workstation-1", "Alex", "");
  });

  it("keeps the existing access fallback for a workstation without Teams permission", async () => {
    const user = userEvent.setup();
    jest
      .spyOn(authApi, "updateWorkstationOperator")
      .mockResolvedValue({ success: true, workstation: {} as never });

    render(<WorkstationContext permissions={{ teams: "none", services: "none" }} />);

    await user.type(
      await screen.findByRole("textbox", { name: /operator name/i }),
      "Alex",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Presentation Controller")).toBeInTheDocument();
    expect(screen.queryByTestId("requested-current-service")).not.toBeInTheDocument();
  });
});
