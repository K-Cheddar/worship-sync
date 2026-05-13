import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationsSettingsPanel } from "./IntegrationsSettingsPanel";
import { createDefaultChurchIntegrations } from "../../types/integrations";
import type { ElectronAPI } from "../../types/electron";

type WindowWithTestElectron = Window & {
  electronAPI?: Pick<ElectronAPI, "openExternalUrl">;
};

const mockShowToast = jest.fn();
const mockUpdateChurchIntegrations = jest.fn();
const mockDisconnectRestream = jest.fn();
const mockGetRestreamConnectAuthorizeUrl = jest.fn();
const mockGetRestreamConnectStatus = jest.fn();

jest.mock("../../utils/environment", () => ({
  isElectron: jest.fn(() => false),
}));

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

jest.mock("../../boards/api", () => ({
  disconnectRestream: (...args: unknown[]) => mockDisconnectRestream(...args),
  getRestreamConnectAuthorizeUrl: (...args: unknown[]) =>
    mockGetRestreamConnectAuthorizeUrl(...args),
  getRestreamConnectStatus: (...args: unknown[]) =>
    mockGetRestreamConnectStatus(...args),
}));

jest.mock("../../api/auth", () => ({
  __esModule: true,
  AuthApiError: class AuthApiError extends Error { },
  updateChurchIntegrations: (...args: unknown[]) =>
    mockUpdateChurchIntegrations(...args),
}));

describe("IntegrationsSettingsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDisconnectRestream.mockResolvedValue(undefined);
    mockGetRestreamConnectAuthorizeUrl.mockResolvedValue({
      authorizeUrl: "https://api.restream.io/login?churchId=church-1",
      connectRequestId: "restream-connect-1",
      connectRequestSecret: "restream-secret-1",
      expiresAt: Date.now() + 60_000,
      pollIntervalMs: 10_000,
    });
    mockGetRestreamConnectStatus.mockResolvedValue({
      status: "pending",
      errorMessage: "",
    });
    const { isElectron } = jest.requireMock("../../utils/environment") as {
      isElectron: jest.Mock;
    };
    isElectron.mockReturnValue(false);
    delete (window as WindowWithTestElectron).electronAPI;
  });

  it("saves overlaySyncEnabled=false when the rule is turned off and saved right away", async () => {
    const user = userEvent.setup();
    const integrations = createDefaultChurchIntegrations();
    integrations.servicePlanning.enabled = true;
    integrations.servicePlanning.elementRules = [
      {
        id: "rule-8",
        matchElementType: "Song of Praise",
        matchMode: "contains",
        overlaySyncEnabled: true,
        displayName: "",
        nameSources: ["ledBy"],
        multiOverlay: { mode: "single" },
        outlineSync: {
          enabled: true,
          itemType: "song",
        },
      },
    ];

    mockUpdateChurchIntegrations.mockResolvedValue({
      success: true,
      integrations: {
        ...integrations,
        servicePlanning: {
          ...integrations.servicePlanning,
          elementRules: [
            {
              ...integrations.servicePlanning.elementRules[0],
              overlaySyncEnabled: false,
            },
          ],
        },
      },
    });

    render(
      <IntegrationsSettingsPanel
        churchId="church-1"
        integrations={integrations}
        integrationsStatus="ready"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Expand rule" }));
    await user.click(
      screen.getByRole("switch", { name: /use for overlay sync/i }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdateChurchIntegrations).toHaveBeenCalledWith(
        "church-1",
        expect.objectContaining({
          servicePlanning: expect.objectContaining({
            elementRules: [
              expect.objectContaining({
                id: "rule-8",
                overlaySyncEnabled: false,
              }),
            ],
          }),
        }),
      );
    });
  });

  it("shows Restream connection controls in the integrations panel", async () => {
    const user = userEvent.setup();
    const integrations = createDefaultChurchIntegrations();
    integrations.restream.enabled = true;
    integrations.restream.connected = true;
    integrations.restream.accountLabel = "Main Restream";
    integrations.restream.platformSummary = ["YouTube: Main channel"];

    render(
      <IntegrationsSettingsPanel
        churchId="church-1"
        integrations={integrations}
        integrationsStatus="ready"
      />,
    );

    expect(screen.getByText("Main Restream")).toBeInTheDocument();
    expect(screen.getByText(/Live sources: YouTube: Main channel/i)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Disconnect Restream/i }),
    );

    await waitFor(() => {
      expect(mockDisconnectRestream).toHaveBeenCalledWith("church-1");
    });
  });

  it("opens Restream connect in the system browser when running in Electron", async () => {
    const user = userEvent.setup();
    const { isElectron } = jest.requireMock("../../utils/environment") as {
      isElectron: jest.Mock;
    };
    isElectron.mockReturnValue(true);
    const openExternalUrl = jest.fn().mockResolvedValue(true);
    (window as WindowWithTestElectron).electronAPI = {
      openExternalUrl,
    };

    render(
      <IntegrationsSettingsPanel
        churchId="church-1"
        integrations={createDefaultChurchIntegrations()}
        integrationsStatus="ready"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Connect Restream/i }));

    await waitFor(() => {
      expect(mockGetRestreamConnectAuthorizeUrl).toHaveBeenCalledWith(
        "church-1",
        "/account?tab=integrations",
      );
    });
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://api.restream.io/login?churchId=church-1",
    );
  });

  it("opens Restream connect in a new browser tab on the web", async () => {
    const user = userEvent.setup();
    const openSpy = jest.spyOn(window, "open").mockReturnValue(window);

    render(
      <IntegrationsSettingsPanel
        churchId="church-1"
        integrations={createDefaultChurchIntegrations()}
        integrationsStatus="ready"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Connect Restream/i }));

    await waitFor(() => {
      expect(mockGetRestreamConnectAuthorizeUrl).toHaveBeenCalledWith(
        "church-1",
        "/account?tab=integrations",
      );
    });

    expect(openSpy).toHaveBeenCalledWith(
      "https://api.restream.io/login?churchId=church-1",
      "_blank",
      "noopener,noreferrer",
    );

    openSpy.mockRestore();
  });

  it("shows a success toast when the pending Restream connect completes", async () => {
    jest.useFakeTimers();
    const openSpy = jest.spyOn(window, "open").mockReturnValue(window);
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      mockGetRestreamConnectStatus.mockResolvedValueOnce({
        status: "completed",
        errorMessage: "",
        accountLabel: "Main Channel",
      });

      render(
        <IntegrationsSettingsPanel
          churchId="church-1"
          integrations={createDefaultChurchIntegrations()}
          integrationsStatus="ready"
        />,
      );

      await user.click(screen.getByRole("button", { name: /Connect Restream/i }));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          "Restream opened in your browser. Finish the connection there.",
          "success",
        );
      });
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          "Restream connected to Main Channel.",
          "success",
        );
      });

    } finally {
      openSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});
