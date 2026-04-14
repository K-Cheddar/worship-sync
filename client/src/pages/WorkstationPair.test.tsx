import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WorkstationPair from "./WorkstationPair";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";
import { setDisplayToken } from "../utils/authStorage";
import * as authApi from "../api/auth";

jest.mock("../api/auth", () => ({
  redeemDisplayPairing: jest.fn(),
  redeemWorkstationPairing: jest.fn(),
}));

jest.mock("../utils/environment", () => ({
  isElectron: () => false,
}));

describe("WorkstationPair", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    (authApi.redeemWorkstationPairing as jest.Mock).mockReset();
    (authApi.redeemDisplayPairing as jest.Mock).mockReset();
  });

  it("clears a stale display token when web workstation pairing succeeds", async () => {
    const refreshAuthBootstrap = jest.fn(() => Promise.resolve());
    (authApi.redeemWorkstationPairing as jest.Mock).mockResolvedValue({
      success: true,
      credential: "workstation-token-1",
      device: {
        deviceId: "workstation-1",
        churchId: "church-1",
        label: "Front Row Laptop",
        appAccess: "full",
        status: "active",
        createdAt: "2026-04-08T00:00:00.000Z",
      },
    });
    setDisplayToken("stale-display-token");

    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            sessionKind: null,
            refreshAuthBootstrap,
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/workstation/pair"]}>
          <Routes>
            <Route
              path="/workstation/pair"
              element={<WorkstationPair lockedPairType="workstation" />}
            />
            <Route
              path="/workstation/operator"
              element={<div data-testid="operator-page">Operator</div>}
            />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: /link code/i }),
      "ABC123"
    );
    await userEvent.click(screen.getByRole("button", { name: "Link device" }));

    await screen.findByTestId("operator-page");
    expect(refreshAuthBootstrap).toHaveBeenCalled();
    expect(localStorage.getItem("worshipsync_display_token")).toBeNull();
    expect(localStorage.getItem("worshipsync_workstation_token")).toBe(
      "workstation-token-1"
    );
    await waitFor(() =>
      expect(authApi.redeemWorkstationPairing).toHaveBeenCalledWith({
        token: "ABC123",
        platformType: "web",
      })
    );
  });
});
