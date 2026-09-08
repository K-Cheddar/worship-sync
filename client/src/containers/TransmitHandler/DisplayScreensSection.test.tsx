import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DisplayScreensSection from "./DisplayScreensSection";
import type { DisplayDeviceClient } from "../../api/authTypes";
import type { DisplayOutput } from "../../utils/displayOutputs";

const updateDisplayDeviceSettings = jest.fn().mockResolvedValue({
  success: true,
  settings: {},
});

jest.mock("../../api/auth", () => ({
  updateDisplayDeviceSettings: (...args: unknown[]) =>
    updateDisplayDeviceSettings(...args),
}));

const OUTPUT: DisplayOutput = {
  id: "out_lobby",
  type: "projector",
  name: "Lobby",
  order: 1,
  enabled: true,
  settings: { showClock: false },
};

const makeScreen = (
  overrides: Partial<DisplayDeviceClient> = {},
): DisplayDeviceClient =>
  ({
    deviceId: "disp_1",
    churchId: "church_1",
    label: "Booth machine",
    surfaceType: "projector",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    outputId: "out_lobby",
    ...overrides,
  }) as DisplayDeviceClient;

const onError = jest.fn();
const onChanged = jest.fn();

const renderSection = (screens: DisplayDeviceClient[]) =>
  render(
    <DisplayScreensSection
      output={OUTPUT}
      screens={screens}
      churchId="church_1"
      onError={onError}
      onChanged={onChanged}
    />,
  );

beforeEach(() => {
  updateDisplayDeviceSettings.mockClear().mockResolvedValue({ success: true });
  onError.mockClear();
  onChanged.mockClear();
});

describe("DisplayScreensSection", () => {
  it("renders nothing when no screen is paired to the display", () => {
    const { container } = renderSection([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each paired screen by label", () => {
    renderSection([
      makeScreen(),
      makeScreen({ deviceId: "disp_2", label: "Ceiling" }),
    ]);
    expect(screen.getByText("Booth machine")).toBeInTheDocument();
    expect(screen.getByText("Ceiling")).toBeInTheDocument();
  });

  it("shows the display's default until the screen overrides it", () => {
    renderSection([
      makeScreen(),
      makeScreen({
        deviceId: "disp_2",
        label: "Stage",
        settings: { showClock: true },
      }),
    ]);
    const rows = screen.getAllByRole("listitem");
    // Display default is showClock: false; only the stage screen overrides it.
    expect(within(rows[0]).getAllByRole("switch")[1]).not.toBeChecked();
    expect(within(rows[1]).getAllByRole("switch")[1]).toBeChecked();
  });

  it("saves an override for one screen without touching its sibling", async () => {
    const user = userEvent.setup();
    renderSection([makeScreen({ settings: { isHeadless: true } })]);

    await user.click(screen.getAllByRole("switch")[1]);

    expect(updateDisplayDeviceSettings).toHaveBeenCalledWith(
      "church_1",
      "disp_1",
      // Existing overrides are preserved, not replaced.
      { isHeadless: true, showClock: true },
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("offers headless, which no display default can supply", () => {
    renderSection([makeScreen()]);
    expect(screen.getByText(/Headless/)).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(4);
  });

  it("hides headless on a display whose page never reads it", () => {
    // Stream is bare for OBS and has no fullscreen gate to strip, so the
    // toggle would write a setting nothing acts on.
    render(
      <DisplayScreensSection
        output={{ ...OUTPUT, type: "stream" }}
        screens={[makeScreen()]}
        churchId="church_1"
        onError={onError}
        onChanged={onChanged}
      />,
    );

    expect(screen.queryByText(/Headless/)).not.toBeInTheDocument();
    expect(screen.getByText(/Video sound/)).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("lets one stream screen override sound and volume", async () => {
    const user = userEvent.setup();
    render(
      <DisplayScreensSection
        output={{ ...OUTPUT, type: "stream" }}
        screens={[
          makeScreen({
            label: "OBS",
            settings: { localVideoAudioEnabled: true },
          }),
        ]}
        churchId="church_1"
        onError={onError}
        onChanged={onChanged}
      />,
    );

    expect(screen.getByRole("switch", { name: /Video sound/ })).toBeChecked();
    await user.clear(screen.getByLabelText("Video volume for OBS"));
    await user.type(screen.getByLabelText("Video volume for OBS"), "45");

    expect(updateDisplayDeviceSettings).toHaveBeenLastCalledWith(
      "church_1",
      "disp_1",
      expect.objectContaining({ localVideoVolume: 45 }),
    );
  });

  it("tells the operator what to do when the save fails", async () => {
    updateDisplayDeviceSettings.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderSection([makeScreen()]);

    await user.click(screen.getAllByRole("switch")[1]);

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining("try again"),
        "error",
      ),
    );
  });
});

describe("the window this machine has open", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("lists the local window and which screen it is on", () => {
    render(
      <DisplayScreensSection
        output={OUTPUT}
        screens={[]}
        localScreen={{ isOpen: true, screenLabel: "Display 2 - External" }}
        churchId="church_1"
        onError={onError}
        onChanged={onChanged}
      />,
    );

    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByText("Display 2 - External")).toBeInTheDocument();
  });

  it("stores a local override on this device rather than on the server", async () => {
    const user = userEvent.setup();
    render(
      <DisplayScreensSection
        output={OUTPUT}
        screens={[]}
        localScreen={{ isOpen: true }}
        churchId="church_1"
        onError={onError}
        onChanged={onChanged}
      />,
    );

    // The local window is listed first, and Headless is its first toggle.
    const local = screen.getAllByRole("listitem")[0];
    await user.click(within(local).getAllByRole("switch")[0]);

    expect(updateDisplayDeviceSettings).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        window.localStorage.getItem("worshipSync_screenDisplaySettings") ?? "{}",
      ),
    ).toEqual({ out_lobby: { isHeadless: true } });
  });
});
