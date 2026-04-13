import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useGenerateCreditsFromOverlays } from "./useGenerateCreditsFromOverlays";
import { ControllerInfoContext } from "../context/controllerInfo";
import getScheduleFromExcel from "../utils/getScheduleFromExcel";
import { putCreditDoc } from "../utils/dbUtils";
import { broadcastCreditsUpdate } from "../store/store";

const mockDispatch = jest.fn();

jest.mock("../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (fn: (state: typeof baseMockState) => unknown) =>
    fn(mockState as typeof baseMockState),
}));

jest.mock("../utils/getScheduleFromExcel", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../utils/dbUtils", () => ({
  putCreditDoc: jest.fn(),
}));

jest.mock("../store/store", () => ({
  broadcastCreditsUpdate: jest.fn(),
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
  <ControllerInfoContext.Provider value={{ db: mockDb } as any}>
    {children}
  </ControllerInfoContext.Provider>
);

describe("useGenerateCreditsFromOverlays", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    (getScheduleFromExcel as jest.Mock).mockResolvedValue([
      {
        heading: "Executive Producers",
        names: "Alice\nBob",
      },
    ]);
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
        heading: "Executive Producers",
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
    const { result } = renderHook(() => useGenerateCreditsFromOverlays(), {
      wrapper,
    });
    expect(result.current.hasOverlays).toBe(false);
  });

  it("dispatches updateList with schedule names when schedule matches heading", async () => {
    const { result } = renderHook(() => useGenerateCreditsFromOverlays(), {
      wrapper,
    });

    await act(async () => {
      await result.current.generateFromOverlays();
    });

    expect(mockDispatch).toHaveBeenCalled();
    const listAction = mockDispatch.mock.calls.find(
      (c) => c[0]?.type === "credits/updateCreditsList",
    );
    expect(listAction).toBeDefined();
    expect(listAction![0].payload[0].text).toContain("Alice");
    expect(putCreditDoc).toHaveBeenCalled();
    expect(broadcastCreditsUpdate).toHaveBeenCalled();
  });

  it("fills from overlay event mapping when schedule has no row for heading", async () => {
    (getScheduleFromExcel as jest.Mock).mockResolvedValue([]);
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

    const listAction = mockDispatch.mock.calls.find(
      (c) => c[0]?.type === "credits/updateCreditsList",
    );
    expect(listAction![0].payload[0].text.trim()).toBe("Host Name");
  });

  it("skips putCreditDoc and broadcast when db is missing", async () => {
    const NoDbWrapper = ({ children }: { children: React.ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db: undefined } as any}>
        {children}
      </ControllerInfoContext.Provider>
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

  it("clears isGenerating after schedule throws", async () => {
    (getScheduleFromExcel as jest.Mock).mockRejectedValue(new Error("xlsx missing"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => { });

    const { result } = renderHook(() => useGenerateCreditsFromOverlays(), {
      wrapper,
    });

    await act(async () => {
      await result.current.generateFromOverlays();
    });

    await waitFor(() => {
      expect(result.current.isGenerating).toBe(false);
    });

    consoleSpy.mockRestore();
  });
});
