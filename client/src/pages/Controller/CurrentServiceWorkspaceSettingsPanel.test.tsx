import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CurrentServiceWorkspaceSettingsPanel } from "./CurrentServiceWorkspaceSettingsPanel";
import { createDefaultCurrentServiceWorkspace } from "../../utils/currentServiceWorkspace";

const mockShowToast = jest.fn();
const mockUpdateCurrentServiceWorkspace = jest.fn();
const mockOutputState = {
  displayOutputs: {
    list: [
      { id: "projector", type: "projector", name: "Projector", enabled: true },
      { id: "monitor", type: "monitor", name: "Monitor", enabled: true },
      { id: "stream", type: "stream", name: "Stream", enabled: true },
      { id: "tv-one", type: "projector", name: "TV One", enabled: true },
      { id: "tv-two", type: "projector", name: "TV Two", enabled: true },
      { id: "retired", type: "projector", name: "Retired TV", enabled: false },
    ],
  },
};

jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: typeof mockOutputState) => unknown) =>
    selector(mockOutputState),
}));

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
    expect(screen.getAllByRole("checkbox")).toHaveLength(9);
    expect(screen.getByRole("checkbox", { name: "Projector" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "TV One" })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Retired TV" })).not.toBeInTheDocument();

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

  it("saves output previews by ID so projector-type outputs are independent", async () => {
    const user = userEvent.setup();
    const configuration = {
      ...createDefaultCurrentServiceWorkspace(),
      outputPreviewIds: ["projector", "monitor", "stream", "tv-two"],
    };
    mockUpdateCurrentServiceWorkspace.mockResolvedValue({
      success: true,
      currentServiceWorkspace: configuration,
    });
    render(
      <CurrentServiceWorkspaceSettingsPanel
        churchId="church-1"
        configuration={configuration}
        configurationStatus="ready"
      />,
    );

    expect(screen.getByRole("checkbox", { name: "TV One" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "TV Two" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "TV One" }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(mockUpdateCurrentServiceWorkspace).toHaveBeenCalledWith(
        "church-1",
        { outputPreviewIds: ["projector", "monitor", "stream", "tv-one", "tv-two"] },
      ),
    );
  });

  it("preserves selected previews for outputs that are currently disabled", async () => {
    const user = userEvent.setup();
    const configuration = {
      ...createDefaultCurrentServiceWorkspace(),
      outputPreviewIds: ["projector", "retired"],
    };
    mockUpdateCurrentServiceWorkspace.mockResolvedValue({
      success: true,
      currentServiceWorkspace: configuration,
    });
    render(
      <CurrentServiceWorkspaceSettingsPanel
        churchId="church-1"
        configuration={configuration}
        configurationStatus="ready"
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "TV One" }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(mockUpdateCurrentServiceWorkspace).toHaveBeenCalledWith(
        "church-1",
        { outputPreviewIds: ["projector", "tv-one", "retired"] },
      ),
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
