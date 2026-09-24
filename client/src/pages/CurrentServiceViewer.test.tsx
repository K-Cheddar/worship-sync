import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { ServiceTime } from "../types";
import type { ServicePlan, ServicePlanSummary } from "../types/servicePlan";
import {
  buildCurrentServiceViewerOptions,
  default as CurrentServiceViewer,
  useCurrentServiceViewerSelection,
} from "./CurrentServiceViewer";
import ServicePublicView from "./ServicePublicView";
import { buildServicePlanFlowSnapshot } from "./buildServicePlanFlowSnapshot";
import type { TeamScheduleOccurrence } from "../api/authTypes";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";
import store from "../store/store";
import { initiateServices } from "../store/serviceTimesSlice";
import {
  getServicePlanViewer,
  listServicePlans,
} from "../api/auth";
import { useChat } from "../chat/ChatContext";

jest.mock("../api/auth", () => ({
  getServicePlanViewer: jest.fn(),
  listServicePlans: jest.fn(),
}));

jest.mock("./Teams/hooks/useTeamsLiveSync", () => ({
  isServicePlanUpdatedEvent: jest.fn(() => false),
  useTeamsLiveSync: jest.fn(),
}));

jest.mock("../containers/Toolbar/ToolbarElements/UserSection", () => () => null);

jest.mock("../chat/ChatContext", () => ({
  useChat: jest.fn(),
}));

const plan: ServicePlan = {
  planId: "plan-1",
  churchId: "church-1",
  planKey: "svc-1@2026-09-13",
  serviceId: "svc-1",
  date: "2026-09-13",
  name: "Sunday Service",
  sections: [
    {
      id: "worship",
      name: "Worship",
      elements: [
        {
          id: "welcome",
          type: "song",
          title: {
            blocks: [{ type: "paragraph", spans: [{ text: "Welcome" }] }],
          },
          notes: {
            blocks: [{ type: "paragraph", spans: [{ text: "Start quietly." }] }],
          },
          teamNotes: [
            {
              id: "team-note-1",
              label: "Worship Team",
              note: {
                blocks: [{ type: "paragraph", spans: [{ text: "Team detail." }] }],
              },
            },
          ],
          songRefs: [
            { kind: "library", songId: "song-1", songName: "Opening Song" },
          ],
          assignees: [
            { id: "assignee-1", name: "Avery Volunteer", memberId: "member-1" },
          ],
        },
      ],
    },
  ],
};

const occurrence = (
  occurrenceId: string,
  startsAt: string,
): TeamScheduleOccurrence => ({
  occurrenceId,
  serviceId: occurrenceId,
  name: occurrenceId,
  startsAt,
});

const service = (id: string, dateTimeISO: string): ServiceTime => ({
  id,
  name: id,
  timerType: "countdown",
  reccurence: "one_time",
  dateTimeISO,
});

const morningService = service("svc-1", "2026-09-13T13:00:00.000Z");
const tomorrowService = service("svc-2", "2026-09-14T13:00:00.000Z");

const mockedUseChat = jest.mocked(useChat);

const summary = (serviceItem: ServiceTime): {
  planKey: string;
  serviceId: string;
  date: string;
  name: string;
  startsAt: string;
} => ({
  planKey: `${serviceItem.id}@${serviceItem.dateTimeISO?.slice(0, 10)}`,
  serviceId: serviceItem.id,
  date: serviceItem.dateTimeISO?.slice(0, 10) ?? "",
  name: `${serviceItem.name} Plan`,
  startsAt: serviceItem.dateTimeISO ?? "",
});

const renderViewer = (services: ServiceTime[], canViewTeams = false) => {
  store.dispatch(initiateServices(services));
  const context = createMockGlobalContext({
    churchId: "church-1",
    churchName: "Test Church",
    canViewServices: true,
    canViewTeams,
  });
  return render(
    <Provider store={store}>
      <GlobalInfoContext.Provider
        value={context as ContextType<typeof GlobalInfoContext>}
      >
        <MemoryRouter>
          <CurrentServiceViewer />
        </MemoryRouter>
      </GlobalInfoContext.Provider>
    </Provider>,
  );
};

describe("CurrentServiceViewer", () => {
  beforeEach(() => {
    mockedUseChat.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    store.dispatch(initiateServices([]));
    jest.mocked(getServicePlanViewer).mockReset();
    jest.mocked(listServicePlans).mockReset();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("renders plan content without roster assignments", () => {
    render(
      <ServicePublicView
        snapshot={buildServicePlanFlowSnapshot({
          plan,
          startsAt: "2026-09-13T13:00:00.000Z",
          churchName: "Test Church",
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Worship" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByText("Opening Song")).toBeInTheDocument();
    expect(screen.getByText("Start quietly.")).toBeInTheDocument();
    expect(screen.getByText("Team detail.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Team notes/ })).toBeInTheDocument();
    expect(screen.queryByText("Avery Volunteer")).not.toBeInTheDocument();
  });

  it("projects non-song resources into the viewer snapshot", () => {
    const snapshot = buildServicePlanFlowSnapshot({
      plan: {
        ...plan,
        sections: [{
          ...plan.sections[0],
          elements: [{
            ...plan.sections[0].elements[0],
            resources: [
              {
                id: "resource-link",
                type: "url",
                title: "Rehearsal video",
                url: "https://example.com/rehearsal",
              },
              {
                id: "resource-text",
                type: "text",
                title: "Call notes",
                data: { text: "Bring the spare cable." },
              },
            ],
          }],
        }],
      },
      startsAt: "2026-09-13T13:00:00.000Z",
      churchName: "Test Church",
    });

    expect(snapshot.service.sections[0].items[0].resources).toEqual([
      {
        type: "url",
        title: "Rehearsal video",
        url: "https://example.com/rehearsal",
      },
      {
        type: "text",
        title: "Call notes",
        detail: "Bring the spare cable.",
      },
    ]);
  });

  it("loads the automatically selected service and its saved plan", async () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-09-13T12:00:00.000Z"));
    jest.mocked(listServicePlans).mockResolvedValue({
      success: true,
      servicePlans: [summary(morningService)],
    });
    jest.mocked(getServicePlanViewer).mockResolvedValue({
      success: true,
      plan,
      snapshot: null,
    });

    renderViewer([morningService]);

    expect(await screen.findByRole("heading", { name: "Sunday Service" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("overflow-x-hidden");
    expect(getServicePlanViewer).toHaveBeenCalledWith(
      "church-1",
      "svc-1@2026-09-13",
    );
  });

  it("shows a clear empty state when the selected service has no saved plan", async () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-09-13T12:00:00.000Z"));
    jest.mocked(listServicePlans).mockResolvedValue({
      success: true,
      servicePlans: [],
    });
    jest.mocked(getServicePlanViewer).mockResolvedValue({
      success: true,
      plan: null,
      snapshot: null,
    });

    renderViewer([morningService]);

    expect(await screen.findByText("No Service Plan yet")).toBeInTheDocument();
    const toolbar = screen.getByRole("toolbar", { name: "Current service toolbar" });
    expect(within(toolbar).getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(within(toolbar).queryByText("Current service")).not.toBeInTheDocument();
    expect(toolbar).toHaveClass("w-dvw", "-translate-x-1/2", "-mt-4", "sm:-mt-6");
    expect(screen.getByRole("main")).toHaveClass("overflow-x-hidden");
    expect(toolbar).not.toHaveClass("rounded-xl");
    expect(screen.getByRole("combobox", { name: /Choose a service/i })).toBeInTheDocument();
    expect(getServicePlanViewer).toHaveBeenCalledWith(
      "church-1",
      "svc-1@2026-09-13",
    );
  });

  it("renders the active service before a slow plan list completes", async () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-09-13T12:00:00.000Z"));
    let resolveList: ((value: { success: true; servicePlans: ServicePlanSummary[] }) => void) | undefined;
    jest.mocked(listServicePlans).mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    jest.mocked(getServicePlanViewer).mockResolvedValue({
      success: true,
      plan,
      snapshot: null,
    });

    renderViewer([morningService]);

    expect(await screen.findByRole("heading", { name: "Sunday Service" })).toBeInTheDocument();
    expect(screen.queryByText("Loading service plans")).not.toBeInTheDocument();
    resolveList?.({ success: true, servicePlans: [summary(morningService)] });
  });

  it("groups bounded manual choices as recent, today, and upcoming", () => {
    const now = Date.parse("2026-09-13T08:00:00.000Z");
    const options = buildCurrentServiceViewerOptions(
      [
        occurrence("recent", "2026-09-12T10:00:00.000Z"),
        occurrence("today", "2026-09-13T10:00:00.000Z"),
        occurrence("later", "2026-09-14T10:00:00.000Z"),
      ],
      now,
    );

    expect(options.map((option) => option.group)).toEqual([
      "Recent",
      "Today",
      "Upcoming",
    ]);
    expect(options.map((option) => option.value)).toEqual([
      "recent",
      "today",
      "later",
    ]);
  });

  it("keeps manual selection until the viewer explicitly returns to automatic", () => {
    const result = {
      current: null as ReturnType<typeof useCurrentServiceViewerSelection> | null,
    };
    const Harness = ({ services }: { services: ServiceTime[] }) => {
      result.current = useCurrentServiceViewerSelection(services);
      return null;
    };
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-09-13T08:00:00.000Z"));

    render(
      <Harness
        services={[
          service("morning", "2026-09-13T09:00:00.000Z"),
          service("tomorrow", "2026-09-14T09:00:00.000Z"),
        ]}
      />,
    );
    const tomorrow = result.current?.occurrences.find(
      (candidate) => candidate.serviceId === "tomorrow",
    );
    act(() => {
      result.current?.selectOccurrence(tomorrow?.occurrenceId ?? "");
    });

    expect(result.current?.occurrence?.serviceId).toBe("tomorrow");
    expect(result.current?.selectedOccurrenceId).toBe(tomorrow?.occurrenceId);

    act(() => {
      result.current?.returnToCurrent();
    });

    expect(result.current?.occurrence?.serviceId).toBe("morning");
    expect(result.current?.selectedOccurrenceId).toBeNull();
  });

  it("switches between bounded services and returns to the automatic service", async () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-09-13T12:00:00.000Z"));
    jest.mocked(listServicePlans).mockResolvedValue({
      success: true,
      servicePlans: [summary(morningService), summary(tomorrowService)],
    });
    jest.mocked(getServicePlanViewer).mockImplementation(async (_churchId, planKey) => ({
      success: true,
      plan: { ...plan, planKey, name: planKey },
      snapshot: null,
    }));
    const user = userEvent.setup();

    renderViewer([morningService, tomorrowService]);
    expect(await screen.findByRole("heading", { name: "svc-1@2026-09-13" })).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /Choose a service/ }));
    await user.click(await screen.findByRole("option", { name: /svc-2/ }));
    expect(await screen.findByRole("heading", { name: "svc-2@2026-09-14" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /return to current service/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /return to current service/i }));
    expect(await screen.findByRole("heading", { name: "svc-1@2026-09-13" })).toBeInTheDocument();
  });

  it("refreshes after a meaningful hidden-to-visible transition", async () => {
    let nowMs = Date.parse("2026-09-13T12:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    jest.mocked(listServicePlans).mockResolvedValue({
      success: true,
      servicePlans: [summary(morningService)],
    });
    jest.mocked(getServicePlanViewer).mockResolvedValue({
      success: true,
      plan,
      snapshot: null,
    });
    const setVisibility = (visibility: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibility,
      });
    };

    renderViewer([morningService]);
    await screen.findByRole("heading", { name: "Welcome" });
    expect(listServicePlans).toHaveBeenCalledTimes(1);

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      nowMs += 10_001;
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(listServicePlans).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("rechecks the automatic choice when the scheduled start arrives", () => {
    jest.useFakeTimers();
    let nowMs = Date.parse("2026-09-13T08:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    const result = {
      current: null as ReturnType<typeof useCurrentServiceViewerSelection> | null,
    };
    const Harness = () => {
      result.current = useCurrentServiceViewerSelection([
        service("morning", "2026-09-13T08:01:00.000Z"),
      ]);
      return null;
    };

    render(<Harness />);
    expect(result.current?.automaticResolution.reason).toBe("upcoming-today");

    act(() => {
      nowMs += 60_000;
      jest.advanceTimersByTime(60_000);
    });

    expect(result.current?.automaticResolution.reason).toBe("in-progress");
  });

  it("shows authorized Team Chat with the shared unread count and opens shared chat", async () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-09-13T12:00:00.000Z"));
    jest.mocked(listServicePlans).mockResolvedValue({
      success: true,
      servicePlans: [],
    });
    jest.mocked(getServicePlanViewer).mockResolvedValue({
      success: true,
      plan: null,
      snapshot: null,
    });
    const openChat = jest.fn();
    const closeChat = jest.fn();
    mockedUseChat.mockReturnValue({
      available: true,
      isOpen: false,
      openChat,
      closeChat,
      unreadCount: 3,
    } as unknown as NonNullable<ReturnType<typeof useChat>>);

    renderViewer([morningService]);

    expect(await screen.findByText("No Service Plan yet")).toBeInTheDocument();
    const teamChatButton = screen.getByRole("button", {
      name: "Open Team Chat. 3 unread messages.",
    });
    expect(teamChatButton).toBeInTheDocument();
    expect(
      screen.getByRole("toolbar", { name: "Current service toolbar" }),
    ).toHaveClass("w-dvw", "-translate-x-1/2");

    await userEvent.setup().click(teamChatButton);

    expect(openChat).toHaveBeenCalledTimes(1);
  });

  it("does not expose Team Chat when the shared chat surface is unavailable", async () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-09-13T12:00:00.000Z"));
    jest.mocked(listServicePlans).mockResolvedValue({
      success: true,
      servicePlans: [],
    });
    jest.mocked(getServicePlanViewer).mockResolvedValue({
      success: true,
      plan: null,
      snapshot: null,
    });
    mockedUseChat.mockReturnValue(null);

    renderViewer([morningService]);

    expect(await screen.findByText("No Service Plan yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open Team Chat/i }),
    ).not.toBeInTheDocument();
  });
});
