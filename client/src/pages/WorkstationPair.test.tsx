import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WorkstationPair from "./WorkstationPair";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";
import { setDisplayToken } from "../utils/authStorage";
import * as authApi from "../api/auth";

jest.mock("../api/auth", () => ({
  startDevicePairingRequest: jest.fn(),
  getDevicePairingRequestStatus: jest.fn(),
  exchangeDevicePairingRequest: jest.fn(),
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
    (authApi.getDevicePairingRequestStatus as jest.Mock).mockReset();
    (authApi.exchangeDevicePairingRequest as jest.Mock).mockReset();
    (authApi.startDevicePairingRequest as jest.Mock).mockResolvedValue({
      requestId: "request-1",
      requestSecret: "secret-1",
      approvalUrl: "https://www.worshipsync.net/#/device-pairing/approve/request-1",
      pollIntervalMs: 1500,
    });
  });

  it("keeps the approved QR visible and offers retry when exchange fails", async () => {
    (authApi.getDevicePairingRequestStatus as jest.Mock).mockResolvedValue({
      success: true,
      status: "awaiting_exchange",
      expiresAt: "2026-04-08T00:10:00.000Z",
    });
    (authApi.exchangeDevicePairingRequest as jest.Mock).mockRejectedValue(new Error("network failure"));

    render(
      <GlobalInfoContext.Provider value={createMockGlobalContext({ sessionKind: null }) as any}>
        <MemoryRouter initialEntries={["/workstation/pair"]}>
          <WorkstationPair lockedPairType="workstation" />
        </MemoryRouter>
      </GlobalInfoContext.Provider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not|network|try again/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Generate new QR" }).length).toBeGreaterThan(0);
    expect(screen.getByTestId("device-pairing-qr-surface")).toHaveStyle({
      backgroundColor: "rgb(255, 255, 255)",
      colorScheme: "light",
      forcedColorAdjust: "none",
    });
    const qrCode = screen.getByTestId("device-pairing-qr-code");
    expect(qrCode).toContainHTML('fill="#FFFFFF"');
    expect(qrCode).toContainHTML('fill="#000000"');
    expect(authApi.exchangeDevicePairingRequest).toHaveBeenCalledWith({
      requestId: "request-1",
      requestSecret: "secret-1",
      platformType: "web",
    });
  });

  it("hides the preparation message after the QR expires", async () => {
    (authApi.getDevicePairingRequestStatus as jest.Mock).mockResolvedValue({
      success: true,
      status: "expired",
      expiresAt: "2026-04-08T00:10:00.000Z",
    });

    render(
      <GlobalInfoContext.Provider value={createMockGlobalContext({ sessionKind: null }) as any}>
        <MemoryRouter initialEntries={["/workstation/pair"]}>
          <WorkstationPair lockedPairType="workstation" />
        </MemoryRouter>
      </GlobalInfoContext.Provider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("This QR code expired. Generate a new one.");
    expect(screen.queryByText("Preparing QR code…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate new QR" })).toBeVisible();
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

    await userEvent.click(screen.getByRole("button", { name: "Use a link code instead" }));
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
