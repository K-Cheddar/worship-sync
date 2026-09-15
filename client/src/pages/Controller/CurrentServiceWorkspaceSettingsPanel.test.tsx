import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CurrentServiceWorkspaceSettingsPanel } from "./CurrentServiceWorkspaceSettingsPanel";
import { createDefaultCurrentServiceWorkspace } from "../../utils/currentServiceWorkspace";

const mockShowToast = jest.fn();
const mockUpdateCurrentServiceWorkspace = jest.fn();

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

jest.mock("../../api/auth", () => ({
  __esModule: true,
  AuthApiError: class AuthApiError extends Error {},
  updateCurrentServiceWorkspace: (...args: unknown[]) =>
    mockUpdateCurrentServiceWorkspace(...args),
}));

describe("CurrentServiceWorkspaceSettingsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the four tool controls and saves only changed settings", async () => {
    const user = userEvent.setup();
    const configuration = createDefaultCurrentServiceWorkspace();
    mockUpdateCurrentServiceWorkspace.mockResolvedValue({
      success: true,
      currentServiceWorkspace: {
        sections: {
          ...configuration.sections,
          team: false,
        },
      },
    });

    render(
      <CurrentServiceWorkspaceSettingsPanel
        churchId="church-1"
        configuration={configuration}
        configurationStatus="ready"
      />,
    );

    expect(
      screen.getByText("Choose which tools are available in the Current Service Workspace."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);

    await user.click(screen.getByRole("checkbox", { name: "Team" }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(mockUpdateCurrentServiceWorkspace).toHaveBeenCalledWith(
        "church-1",
        { team: false },
      ),
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      "Workspace settings saved.",
      "success",
    );
  });

  it("merges remote changes without discarding a dirty local field", async () => {
    const user = userEvent.setup();
    const configuration = createDefaultCurrentServiceWorkspace();
    const remoteConfiguration = {
      sections: {
        ...configuration.sections,
        credits: false,
      },
    };
    mockUpdateCurrentServiceWorkspace.mockResolvedValue({
      success: true,
      currentServiceWorkspace: {
        sections: {
          ...remoteConfiguration.sections,
          team: false,
        },
      },
    });

    const { rerender } = render(
      <CurrentServiceWorkspaceSettingsPanel
        churchId="church-1"
        configuration={configuration}
        configurationStatus="ready"
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Team" }));
    rerender(
      <CurrentServiceWorkspaceSettingsPanel
        churchId="church-1"
        configuration={remoteConfiguration}
        configurationStatus="ready"
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Team" })).not.toBeChecked(),
    );
    expect(screen.getByRole("checkbox", { name: "Credits" })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(mockUpdateCurrentServiceWorkspace).toHaveBeenCalledWith(
        "church-1",
        { team: false },
      ),
    );
  });
});
