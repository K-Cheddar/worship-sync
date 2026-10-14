import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChurchServiceTimeZoneSettings from "./ChurchServiceTimeZoneSettings";

const mockUpdateChurchServiceTimeZone = jest.fn();
const mockRefreshChatContext = jest.fn();
const mockRefreshTimeZone = jest.fn();
const mockShowToast = jest.fn();
let mockSavedTimeZone: string | null;
let mockChurchTimeZone: {
  status: "loading" | "ready" | "error";
  timeZone: string | null;
  isConfigured: boolean;
  legacyTimeZoneSuggestion: string | null;
  refresh: typeof mockRefreshTimeZone;
};

jest.mock("../../api/auth", () => ({
  updateChurchServiceTimeZone: (...args: unknown[]) =>
    mockUpdateChurchServiceTimeZone(...args),
}));

jest.mock("../../chat/ChatContext", () => ({
  useChat: () => ({ refreshContext: mockRefreshChatContext }),
}));

jest.mock("../../context/churchServiceTimeZone", () => ({
  useChurchServiceTimeZone: () => mockChurchTimeZone,
}));

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const renderSettings = (canEdit = true) =>
  render(
    <ChurchServiceTimeZoneSettings churchId="church-1" canEdit={canEdit} />,
  );

const curatedTimeZones = [
  ["Eastern Time (New York)", "America/New_York"],
  ["Central Time (Chicago)", "America/Chicago"],
  ["Mountain Time (Denver)", "America/Denver"],
  ["Mountain Time (Arizona)", "America/Phoenix"],
  ["Pacific Time (Los Angeles)", "America/Los_Angeles"],
  ["Alaska Time (Anchorage)", "America/Anchorage"],
  ["Hawaii Time (Honolulu)", "Pacific/Honolulu"],
  ["Atlantic Time (Puerto Rico)", "America/Puerto_Rico"],
] as const;

beforeEach(() => {
  mockChurchTimeZone = {
    status: "ready",
    timeZone: null,
    isConfigured: false,
    legacyTimeZoneSuggestion: null,
    refresh: mockRefreshTimeZone,
  };
  mockSavedTimeZone = null;
  mockUpdateChurchServiceTimeZone.mockReset().mockImplementation(
    async (_churchId: string, serviceTimeZone: string) => {
      mockSavedTimeZone = serviceTimeZone;
      return {
        serviceTimeZone,
        isConfigured: true,
      };
    },
  );
  mockRefreshChatContext.mockReset().mockResolvedValue(undefined);
  mockRefreshTimeZone.mockReset().mockImplementation(async () => {
    if (mockSavedTimeZone) {
      mockChurchTimeZone = {
        ...mockChurchTimeZone,
        timeZone: mockSavedTimeZone,
        isConfigured: true,
      };
    }
  });
  mockShowToast.mockReset();
  document.documentElement.classList.remove("dark");
});

describe("ChurchServiceTimeZoneSettings", () => {
  it("suggests Eastern for an unconfigured church without saving it automatically", async () => {
    const user = userEvent.setup();
    mockChurchTimeZone = {
      ...mockChurchTimeZone,
      legacyTimeZoneSuggestion: "America/Los_Angeles",
    };
    renderSettings();

    expect(screen.getByRole("status")).toHaveTextContent("Not configured");
    await user.click(screen.getByRole("button", { name: "Select time zone" }));

    expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveTextContent(
      "Eastern Time (New York)",
    );
    expect(mockUpdateChurchServiceTimeZone).not.toHaveBeenCalled();
  });

  it("presents exactly the eight curated choices without UTC or international options", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("button", { name: "Select time zone" }));
    await user.click(screen.getByRole("combobox", { name: "Time zone" }));

    const listbox = within(await screen.findByRole("listbox"));
    expect(listbox.getAllByRole("option").map((option) => option.textContent)).toEqual(
      curatedTimeZones.map(([label]) => label),
    );
    expect(listbox.queryByRole("option", { name: "UTC" })).not.toBeInTheDocument();
    expect(
      listbox.queryByRole("option", { name: "Japan Standard Time (Tokyo)" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Common time zones" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "All time zones" })).not.toBeInTheDocument();
  });

  it.each(curatedTimeZones)("allows %s and saves its canonical IANA identifier", async (label, value) => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("button", { name: "Select time zone" }));
    await user.click(screen.getByRole("combobox", { name: "Time zone" }));
    await user.click(await screen.findByRole("option", { name: label }));
    await user.click(screen.getByRole("button", { name: "Save time zone" }));

    await waitFor(() => {
      expect(mockUpdateChurchServiceTimeZone).toHaveBeenCalledWith("church-1", value);
    });
    expect(mockRefreshTimeZone).toHaveBeenCalledTimes(1);
    expect(mockRefreshChatContext).toHaveBeenCalledTimes(1);
  });

  it("keeps a configured selection unchanged until the user chooses and saves another zone", async () => {
    const user = userEvent.setup();
    mockChurchTimeZone = {
      ...mockChurchTimeZone,
      timeZone: "America/New_York",
      isConfigured: true,
    };
    renderSettings();

    expect(screen.getByRole("status")).toHaveTextContent("Eastern Time (New York)");
    await user.click(screen.getByRole("button", { name: "Change" }));

    expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveTextContent(
      "Eastern Time (New York)",
    );
    expect(screen.getByRole("button", { name: "Save time zone" })).toBeDisabled();
    expect(mockUpdateChurchServiceTimeZone).not.toHaveBeenCalled();
  });

  it("keeps a saved non-US time zone visible and selectable as the current setting", async () => {
    const user = userEvent.setup();
    mockChurchTimeZone = {
      ...mockChurchTimeZone,
      timeZone: "Europe/London",
      isConfigured: true,
    };
    renderSettings();

    expect(screen.getByRole("status")).toHaveTextContent("London");
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveTextContent(
      "London",
    );
    await user.click(screen.getByRole("combobox", { name: "Time zone" }));

    const currentSetting = within(
      await screen.findByRole("group", { name: "Current setting" }),
    );
    expect(currentSetting.getByRole("option", { name: /London/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Save time zone" })).toBeDisabled();
    expect(mockUpdateChurchServiceTimeZone).not.toHaveBeenCalled();

    await user.click(screen.getByRole("combobox", { name: "Time zone" }));
    await user.click(screen.getByRole("option", { name: "Central Time (Chicago)" }));
    await user.click(screen.getByRole("button", { name: "Save time zone" }));

    await waitFor(() => {
      expect(mockUpdateChurchServiceTimeZone).toHaveBeenCalledWith(
        "church-1",
        "America/Chicago",
      );
    });
  });

  it("keeps a previously saved UTC value available only as the current setting", async () => {
    const user = userEvent.setup();
    mockChurchTimeZone = {
      ...mockChurchTimeZone,
      timeZone: "UTC",
      isConfigured: true,
    };
    renderSettings();

    expect(screen.getByRole("status")).toHaveTextContent("UTC");
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("combobox", { name: "Time zone" }));

    const currentSetting = within(
      await screen.findByRole("group", { name: "Current setting" }),
    );
    expect(currentSetting.getByRole("option", { name: "UTC" })).toBeInTheDocument();
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(9);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Save time zone" })).toBeDisabled();
    expect(mockUpdateChurchServiceTimeZone).not.toHaveBeenCalled();
  });

  it("supports selecting a curated option from the keyboard", async () => {
    const user = userEvent.setup();
    renderSettings();

    const editButton = screen.getByRole("button", { name: "Select time zone" });
    editButton.focus();
    await user.keyboard("{Enter}");
    const trigger = screen.getByRole("combobox", { name: "Time zone" });
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}c{Enter}");

    expect(trigger).toHaveTextContent("Central Time (Chicago)");
    await user.click(screen.getByRole("button", { name: "Save time zone" }));
    await waitFor(() => {
      expect(mockUpdateChurchServiceTimeZone).toHaveBeenCalledWith(
        "church-1",
        "America/Chicago",
      );
    });
    expect(screen.getByRole("button", { name: "Change" })).toHaveFocus();
  });

  it("does not expose controls that let read-only users change the setting", () => {
    mockChurchTimeZone = {
      ...mockChurchTimeZone,
      timeZone: "America/New_York",
      isConfigured: true,
    };
    renderSettings(false);

    expect(screen.getByRole("status")).toHaveTextContent("Eastern Time (New York)");
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select time zone" })).not.toBeInTheDocument();
    expect(mockUpdateChurchServiceTimeZone).not.toHaveBeenCalled();
  });

  it.each([
    ["light", false],
    ["dark", true],
  ])("keeps the shared picker readable in %s mode", async (_theme, isDark) => {
    const user = userEvent.setup();
    document.documentElement.classList.toggle("dark", isDark);
    mockChurchTimeZone = {
      ...mockChurchTimeZone,
      timeZone: "America/New_York",
      isConfigured: true,
    };
    renderSettings();

    await user.click(screen.getByRole("button", { name: "Change" }));
    const trigger = screen.getByRole("combobox", { name: "Time zone" });
    expect(trigger).toHaveClass("bg-neutral-900", "text-neutral-100");
    await user.click(trigger);

    const listbox = await screen.findByRole("listbox");
    expect(listbox).toHaveClass("bg-neutral-900", "text-neutral-100");
    expect(within(listbox).getAllByRole("option")).toHaveLength(8);
  });
});
