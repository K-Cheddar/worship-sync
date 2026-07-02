import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useGenerateCreditsFromOverlays } from "./useGenerateCreditsFromOverlays";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import { getTeamsBootstrap } from "../api/auth";
import { putCreditDoc } from "../utils/dbUtils";
import { broadcastCreditsUpdate } from "../store/store";

const mockDispatch = jest.fn();

jest.mock("../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (fn: (state: typeof baseMockState) => unknown) =>
    fn(mockState as typeof baseMockState),
}));

jest.mock("../api/auth", () => ({
  getTeamsBootstrap: jest.fn(),
}));

jest.mock("../utils/dbUtils", () => ({
  putCreditDoc: jest.fn(),
}));

jest.mock("../store/store", () => ({
  broadcastCreditsUpdate: jest.fn(),
}));

jest.mock("../utils/creditsHistoryFlush", () => ({
  flushCreditsHistoryFromLatestList: jest.fn().mockResolvedValue(undefined),
}));

const baseMockState = {
  undoable: {
    present: {
      credits: {
        list: [] as { id: string; heading: string; text: string; hidden?: boolean }[],
        scheduleName: "",
      },
      itemLists: {
        selectedList: { _id: "outline-1", name: "AM" } as const,
        activeList: { _id: "outline-1", name: "AM" } as const,
      },
      overlays: {
        list: [] as { id: string; name: string; event?: string; type: string }[],
      },
    },
  },
};

let mockState: typeof baseMockState;

const mockDb = {} as PouchDB.Database;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
    <ControllerInfoContext.Provider value={{ db: mockDb } as any}>
      {children}
    </ControllerInfoContext.Provider>
  </GlobalInfoContext.Provider>
);

const teamsBootstrap = {
  success: true,
  teams: [
    {
      teamId: "team-media",
      churchId: "church-1",
      name: "Media Team",
      memberIds: ["m1", "m2"],
    },
  ],
  positions: [
    {
      positionId: "camera",
      churchId: "church-1",
      teamId: "team-media",
      name: "Camera",
      order: 1,
    },
  ],
  members: [
    {
      memberId: "m1",
      churchId: "church-1",
      firstName: "Alice",
      lastName: "Jones",
      positionIds: ["camera"],
      blockoutDates: [],
    },
    {
      memberId: "m2",
      churchId: "church-1",
      firstName: "Bob",
      lastName: "Smith",
      positionIds: ["camera"],
      blockoutDates: [],
    },
  ],
  schedules: [
    {
      scheduleId: "schedule-1",
      churchId: "church-1",
      name: "July Media",
      teamId: "team-media",
      serviceIds: ["service-1"],
      occurrences: [
        {
          occurrenceId: "occ-1",
          serviceId: "service-1",
          name: "Sabbath Worship",
          startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      ],
      assignments: {
        "occ-1": {
          "camera::0": { primaryMemberId: "m1" },
          "camera::1": { primaryMemberId: "m2" },
        },
      },
    },
  ],
};

describe("useGenerateCreditsFromOverlays", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    (getTeamsBootstrap as jest.Mock).mockResolvedValue(teamsBootstrap);
    (putCreditDoc as jest.Mock).mockImplementation(async () => ({
      _id: "doc",
      id: "c1",
      heading: "Executive Producers",
      text: "Alice\nBob",
    }));
    mockState = JSON.parse(JSON.stringify(baseMockState));
    mockState.undoable.present.credits.list = [
      {
        id: "c1",
        heading: "Camera Operators",
        text: "Old",
        hidden: false,
      },
    ];
    mockState.undoable.present.overlays.list = [
      {
        id: "o1",
        type: "participant",
        name: "Welcome Host",
        event: "Welcome",
      },
    ];
  });

  it("exposes hasOverlays false when overlay list is empty", () => {
    mockState.undoable.present.overlays.list = [];
    const NoSourceWrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalInfoContext.Provider value={{ churchId: "" } as any}>
        <ControllerInfoContext.Provider value={{ db: mockDb } as any}>
          {children}
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>
    );
    const { result } = renderHook(() => useGenerateCreditsFromOverlays(), {
      wrapper: NoSourceWrapper,
    });
    expect(result.current.hasOverlays).toBe(false);
  });

  it("selects and updates each credit with Teams schedule names when position matches heading", async () => {
    const { result } = renderHook(() => useGenerateCreditsFromOverlays(), {
      wrapper,
    });

    await act(async () => {
      await result.current.generateFromOverlays();
    });

    expect(mockDispatch).toHaveBeenCalled();
    const startAction = mockDispatch.mock.calls.find(
      (c) => c[0]?.type === "generatedCredits/startGeneratedCredits",
    );
    expect(startAction).toBeDefined();
    expect(startAction![0].payload.items).toEqual([
      {
        creditId: "c1",
        creditHeading: "Camera Operators",
        sourceLabel: "Media schedule: July Media - Sabbath Worship",
        previousText: "Old",
        nextText: "Alice\nBob",
      },
    ]);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "credits/selectCredit",
        payload: "c1",
      }),
    );
    const updateAction = mockDispatch.mock.calls.find(
      (c) => c[0]?.type === "credits/updateCredit",
    );
    expect(updateAction).toBeDefined();
    expect(updateAction![0].payload.text).toBe("Alice\nBob");
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "generatedCredits/completeGeneratedCreditItem",
        payload: { creditId: "c1", status: "updated" },
      }),
    );
    expect(putCreditDoc).toHaveBeenCalled();
    expect(broadcastCreditsUpdate).toHaveBeenCalled();
  });

  it("fills from overlay event mapping when schedule has no row for heading", async () => {
    (getTeamsBootstrap as jest.Mock).mockResolvedValue({
      ...teamsBootstrap,
      schedules: [],
    });
    mockState.undoable.present.credits.list = [
      {
        id: "c1",
        heading: "Welcome & Reminders",
        text: "",
        hidden: false,
      },
    ];
    mockState.undoable.present.overlays.list = [
      {
        id: "o1",
        type: "participant",
        name: "Host Name",
        event: "Welcome",
      },
    ];

    const { result } = renderHook(() => useGenerateCreditsFromOverlays(), {
      wrapper,
    });

    await act(async () => {
      await result.current.generateFromOverlays();
    });

    const updateAction = mockDispatch.mock.calls.find(
      (c) => c[0]?.type === "credits/updateCredit",
    );
    expect(updateAction![0].payload.text.trim()).toBe("Host Name");
  });

  it("lists assigned schedule positions that did not match a credit heading", async () => {
    (getTeamsBootstrap as jest.Mock).mockResolvedValue({
      ...teamsBootstrap,
      positions: [
        ...teamsBootstrap.positions,
        {
          positionId: "stream-audio",
          churchId: "church-1",
          teamId: "team-media",
          name: "Stream Audio",
          order: 2,
        },
      ],
      members: [
        ...teamsBootstrap.members,
        {
          memberId: "m3",
          churchId: "church-1",
          firstName: "Sam",
          lastName: "Taylor",
          positionIds: ["stream-audio"],
          blockoutDates: [],
        },
      ],
      schedules: [
        {
          ...teamsBootstrap.schedules[0],
          assignments: {
            "occ-1": {
              "camera::0": { primaryMemberId: "m1" },
              "stream-audio::0": { primaryMemberId: "m3" },
            },
          },
        },
      ],
    });

    const { result } = renderHook(() => useGenerateCreditsFromOverlays(), {
      wrapper,
    });

    await act(async () => {
      await result.current.generateFromOverlays();
    });

    const startAction = mockDispatch.mock.calls.find(
      (c) => c[0]?.type === "generatedCredits/startGeneratedCredits",
    );
    expect(startAction![0].payload.items).toEqual([
      expect.objectContaining({
        creditId: "c1",
        creditHeading: "Camera Operators",
        nextText: "Alice",
      }),
      expect.objectContaining({
        creditHeading: "Stream Audio",
        nextText: "Sam",
        sourceLabel: "Media schedule: July Media - Sabbath Worship",
        status: "missed",
      }),
    ]);
  });

  it("skips putCreditDoc and broadcast when db is missing", async () => {
    const NoDbWrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
        <ControllerInfoContext.Provider value={{ db: undefined } as any}>
          {children}
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>
    );

    (putCreditDoc as jest.Mock).mockClear();
    (broadcastCreditsUpdate as jest.Mock).mockClear();

    const { result } = renderHook(() => useGenerateCreditsFromOverlays(), {
      wrapper: NoDbWrapper,
    });

    await act(async () => {
      await result.current.generateFromOverlays();
    });

    expect(putCreditDoc).not.toHaveBeenCalled();
    expect(broadcastCreditsUpdate).not.toHaveBeenCalled();
  });

  it("continues overlay generation and clears isGenerating after Teams schedule throws", async () => {
    (getTeamsBootstrap as jest.Mock).mockRejectedValue(new Error("teams unavailable"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => { });
    mockState.undoable.present.credits.list = [
      {
        id: "c1",
        heading: "Welcome & Reminders",
        text: "",
        hidden: false,
      },
    ];

    const { result } = renderHook(() => useGenerateCreditsFromOverlays(), {
      wrapper,
    });

    await act(async () => {
      await result.current.generateFromOverlays();
    });

    await waitFor(() => {
      expect(result.current.isGenerating).toBe(false);
    });
    const updateAction = mockDispatch.mock.calls.find(
      (c) => c[0]?.type === "credits/updateCredit",
    );
    expect(updateAction![0].payload.text.trim()).toBe("Welcome Host");

    consoleSpy.mockRestore();
  });
});
