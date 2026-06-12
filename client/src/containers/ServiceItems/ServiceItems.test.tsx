import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import ServiceItems from "./ServiceItems";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";

const mockDispatch = jest.fn();
const mockUseDisplayedUpcomingService = jest.fn();
const mockUseNextServiceCountdownText = jest.fn();
const mockNavigate = jest.fn();
let mockState: any;

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../../hooks/useDisplayedUpcomingService", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseDisplayedUpcomingService(...args),
}));

jest.mock("../../hooks/useNextServiceCountdownText", () => ({
  __esModule: true,
  default: (targetIso: string | null) =>
    mockUseNextServiceCountdownText(targetIso),
}));

jest.mock("../../utils/dndUtils", () => ({
  useSensors: () => [],
}));

jest.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
  useDroppable: () => ({ setNodeRef: jest.fn() }),
}));

jest.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: jest.fn(),
}));

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

jest.mock("../../components/ErrorBoundary/ErrorBoundary", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock("../Toolbar/ToolbarElements/Outlines", () => ({
  __esModule: true,
  default: () => <div data-testid="outlines" />,
}));

jest.mock("../../components/ActionBar/ActionBar", () => ({
  __esModule: true,
  default: () => <div data-testid="action-bar" />,
}));

jest.mock("../../components/FloatingWindow/FloatingWindow", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("./HeadingItem", () => ({
  __esModule: true,
  default: ({ item }: { item: { listId: string } }) => (
    <li data-testid={`heading-${item.listId}`} />
  ),
}));

jest.mock("./ServiceItem", () => ({
  __esModule: true,
  default: ({
    item,
    isActive,
    timer,
    timerText,
  }: {
    item: { listId: string; name: string; type: string };
    isActive: boolean;
    timer?: { remainingTime?: number };
    timerText?: string;
  }) => (
    <li
      data-testid={`row-${item.type}`}
      data-active={String(isActive)}
      data-timer-value={timer?.remainingTime ?? ""}
      data-timer-text={timerText ?? ""}
    >
      {item.name}
    </li>
  ),
}));

jest.mock("./ServiceOutlineSkeleton", () => ({
  __esModule: true,
  default: () => <div data-testid="outline-skeleton" />,
}));

describe("ServiceItems", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      undoable: {
        present: {
          itemList: {
            list: [
              {
                name: "Upcoming Service",
                _id: "service-time-countdown",
                listId: "row-service-time",
                type: "service-time",
              },
              {
                name: "Timer",
                _id: "timer-1",
                listId: "row-timer",
                type: "timer",
              },
            ],
            isLoading: false,
            selectedItemListId: "",
            insertPointIndex: -1,
            hasPendingUpdate: false,
            initialItems: [],
            isInitialized: true,
          },
          itemLists: {
            selectedList: { _id: "outline-1" },
          },
          serviceTimes: {
            list: [
              {
                id: "svc-1",
                name: "Sunday Service",
                reccurence: "one_time",
                dateTimeISO: "2026-05-31T14:00:00.000Z",
              },
            ],
            isInitialized: true,
          },
        },
      },
      allDocs: {
        allSongDocs: [],
      },
      servicePlanningImport: {
        sync: {
          status: "idle",
          phase: "outline",
        },
        serviceOutline: null,
        floatingWindowDismissed: false,
      },
      timers: {
        timers: [
          {
            hostId: "host-1",
            id: "timer-1",
            name: "Timer",
            timerType: "timer",
            status: "running",
            isActive: true,
            remainingTime: 90,
            showMinutesOnly: false,
          },
        ],
      },
    };
    mockUseDisplayedUpcomingService.mockReturnValue({
      service: {
        id: "svc-1",
        name: "Sunday Service",
        reccurence: "one_time",
        dateTimeISO: "2026-05-31T14:00:00.000Z",
      },
      nextAt: new Date("2026-05-31T14:00:00.000Z"),
    });
    mockUseNextServiceCountdownText.mockReturnValue("12:34");
  });

  it("passes the upcoming service countdown into the service-time row without affecting timer rows", () => {
    render(
      <ControllerInfoContext.Provider
        value={{ access: "view", isMobile: false } as any}
      >
        <GlobalInfoContext.Provider value={{ access: "view" } as any}>
          <ServiceItems />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    expect(mockUseDisplayedUpcomingService).toHaveBeenCalledWith(
      mockState.undoable.present.serviceTimes.list,
      expect.any(Number),
      { keepRecentlyElapsedDuringGrace: true },
    );
    expect(mockUseNextServiceCountdownText).toHaveBeenCalledWith(
      "2026-05-31T14:00:00.000Z",
    );

    expect(screen.getByTestId("row-service-time")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("row-service-time")).toHaveAttribute(
      "data-timer-text",
      "12:34",
    );
    expect(screen.getByTestId("row-service-time")).toHaveAttribute(
      "data-timer-value",
      "",
    );

    expect(screen.getByTestId("row-timer")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("row-timer")).toHaveAttribute(
      "data-timer-value",
      "90",
    );
    expect(screen.getByTestId("row-timer")).toHaveAttribute(
      "data-timer-text",
      "",
    );
  });
});
