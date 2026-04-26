import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AuthGate from "../AuthGate";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";
import RoutePersistence, {
  resetRoutePersistenceForTests,
} from "./RoutePersistence";

const LocationProbe = () => {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from
    ?.pathname;
  return (
    <>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="from">{from || "none"}</div>
    </>
  );
};

describe("RoutePersistence", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetRoutePersistenceForTests();
  });

  afterEach(() => {
    resetRoutePersistenceForTests();
    jest.useRealTimers();
    delete window.electronAPI;
  });

  it("keeps the saved shared-workstation route available through operator entry", async () => {
    const getLastRoute = jest.fn().mockResolvedValue("/controller/songs");
    const saveLastRoute = jest.fn().mockResolvedValue(true);
    window.electronAPI = {
      getLastRoute,
      saveLastRoute,
    } as unknown as NonNullable<typeof window.electronAPI>;

    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            sessionKind: "workstation",
            operatorName: "",
            device: { deviceId: "workstation-1", label: "Booth" },
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/workstation/operator"]}>
          <RoutePersistence />
          <Routes>
            <Route path="/workstation/operator" element={<LocationProbe />} />
            <Route
              path="/controller/*"
              element={
                <AuthGate allowedKinds={["human", "workstation"]}>
                  <LocationProbe />
                </AuthGate>
              }
            />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>,
    );

    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(screen.getByTestId("path")).toHaveTextContent("/workstation/operator");
    });
    expect(screen.getByTestId("from")).toHaveTextContent("/controller/songs");
    expect(getLastRoute).toHaveBeenCalledTimes(1);
    expect(saveLastRoute).not.toHaveBeenCalledWith("/workstation/operator");
  });
});
