import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationsSettingsPanel } from "./IntegrationsSettingsPanel";
import { createDefaultChurchIntegrations } from "../../types/integrations";

const mockShowToast = jest.fn();
const mockUpdateChurchIntegrations = jest.fn();

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

jest.mock("../../api/auth", () => ({
  __esModule: true,
  AuthApiError: class AuthApiError extends Error {},
  updateChurchIntegrations: (...args: unknown[]) =>
    mockUpdateChurchIntegrations(...args),
}));

describe("IntegrationsSettingsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
