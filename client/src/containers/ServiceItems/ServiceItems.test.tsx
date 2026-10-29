import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ServiceItems from "./ServiceItems";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { PresentationControllerModeProvider } from "../../context/presentationControllerMode";
import { resolveOutlineConflict, retryItemListLoad } from "../../store/itemListSlice";

const mockDispatch: jest.Mock = jest.fn((action) => {
  if (typeof action === "function") return action(mockDispatch, () => ({ ...mockState, undoable: { present: { ...mockState.undoable.present, item: {} } } }));
  return action;
});
const mockUseDisplayedUpcomingService = jest.fn();
const mockUseNextServiceCountdownText = jest.fn();
const mockNavigate = jest.fn();
const mockRequestOutlineSelectionScroll = jest.fn();
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
  useLocation: () => ({ pathname: "/controller" }),
}));

jest.mock("../../utils/outlineSelectionScroll", () => ({
  requestOutlineSelectionScroll: (...args: unknown[]) =>
    mockRequestOutlineSelectionScroll(...args),
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
  default: ({ items }: { items?: Array<{ label: string }> }) => (
    <div data-testid="action-bar">
      {items?.map((item) => <span key={item.label}>{item.label}</span>)}
    </div>
  ),
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

jest.mock("../../components/NextServiceCountdownText/NextServiceCountdownText", () => ({
  __esModule: true,
  default: ({ targetIso }: { targetIso: string | null }) => {
    const text = mockUseNextServiceCountdownText(targetIso);
    return text == null ? null : <span>{text}</span>;
  },
}));

jest.mock("./ServiceItem", () => ({
  __esModule: true,
  default: ({
    item,
    isActive,
    timer,
    timerText,
    selectedListIds,
    onItemClick,
  }: {
    item: { listId: string; name: string; type: string };
    isActive: boolean;
    timer?: { remainingTime?: number };
    timerText?: ReactNode;
    selectedListIds: Set<string>;
    onItemClick: (listId: string, e: React.MouseEvent) => void;
  }) => (
    <li
      data-testid={`row-${item.type}`}
      data-active={String(isActive)}
      data-list-selected={String(selectedListIds.has(item.listId))}
      data-timer-value={timer?.remainingTime ?? ""}
    >
      <button type="button" onClick={(e) => onItemClick(item.listId, e)}>
        {item.name}
      </button>
      <span data-testid={`timer-text-${item.type}`}>{timerText}</span>
    </li>
  ),
}));

jest.mock("./ServiceOutlineSkeleton", () => ({
  __esModule: true,
  default: () => <div data-testid="outline-skeleton" />,
}));

describe("ServiceItems", () => {
  it("offers Try again for the current outline and keeps usable content visible", () => {
    mockState.undoable.present.itemList.loadedOutlineId = "outline-1";
    mockState.undoable.present.itemList.loadError = "Could not load this outline.";
    render(<ServiceItems />);
    expect(screen.getByRole("button", { name: "Timer" })).toBeInTheDocument();
    expect(screen.queryByTestId("outline-skeleton")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockDispatch).toHaveBeenCalledWith(retryItemListLoad());
  });

  it("blocks duplicate retries while a background attempt is pending", () => {
    mockState.undoable.present.itemList.loadedOutlineId = "outline-1";
    mockState.undoable.present.itemList.isRetrying = true;
    render(<ServiceItems />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Trying again");
  });

  it("does not offer conflict decisions for the outgoing outline during navigation", () => {
    mockState.undoable.present.itemList.loadedOutlineId = "previous-outline";
    mockState.undoable.present.itemList.remoteConflicts = {
      "previous-outline": { localItems: [], remoteItems: [], baselineItems: [] },
    };
    render(<ServiceItems />);
    expect(screen.queryByRole("button", { name: "Keep my draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use remote version" })).not.toBeInTheDocument();
  });
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
      media: {
        list: [],
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
    expect(screen.getByTestId("timer-text-service-time")).toHaveTextContent(
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
    expect(screen.getByTestId("timer-text-timer")).toBeEmptyDOMElement();
  });

  it("offers explicit actions for a conflicting remote outline draft", () => {
    mockState.undoable.present.itemList.loadedOutlineId = "outline-1";
    mockState.undoable.present.itemList.remoteConflicts = {
      "outline-1": {
        baselineItems: [],
        localItems: [],
        remoteItems: [],
      },
    };
    render(
      <ControllerInfoContext.Provider
        value={{ access: "view", isMobile: false } as any}
      >
        <GlobalInfoContext.Provider value={{ access: "full" } as any}>
          <ServiceItems />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This outline has conflicting changes.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Using the remote version will discard your edits made since this notice appeared.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep my draft" }));
    expect(mockDispatch).toHaveBeenCalledWith(
      resolveOutlineConflict({ outlineId: "outline-1", choice: "keep-local" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use remote version" }));
    expect(mockDispatch).toHaveBeenCalledWith(
      resolveOutlineConflict({ outlineId: "outline-1", choice: "use-remote" }),
    );
  });

  it("routes saved row-conflict review through the Controller's access context and Redux resolution action", () => {
    const base = [{ _id: "welcome", listId: "a", type: "song", name: "Welcome" }];
    const local = [{ ...base[0], name: "Welcome A" }];
    const remote = [{ ...base[0], name: "Welcome B" }, { _id: "closing", listId: "c", type: "song", name: "Closing Song" }];
    const itemList = mockState.undoable.present.itemList;
    itemList.loadedOutlineId = "outline-1";
    itemList.list = local;
    itemList.remoteConflicts = { "outline-1": {
      baselineItems: local, localItems: local, remoteItems: local,
      revisionConflict: {
        graph: { winningRevision: "2-first", conflictRevisions: ["2-second"], histories: {} },
        versions: [{ revision: "2-first", items: local }, { revision: "2-second", items: remote }],
        itemReview: { baselineItems: base, localItems: local, remoteItems: remote },
      },
    } };
    render(<ControllerInfoContext.Provider value={{ access: "view", isMobile: false } as any}>
      <GlobalInfoContext.Provider value={{ access: "full" } as any}><ServiceItems /></GlobalInfoContext.Provider>
    </ControllerInfoContext.Provider>);
    expect(screen.queryByRole("button", { name: "Use remote version" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Second version:/ }));
    expect(screen.getByLabelText("Resulting outline")).toHaveTextContent("Closing Song");
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "itemList/resolveOutlineConflict", payload: expect.objectContaining({
        outlineId: "outline-1", draftItems: local, reviewedItems: remote,
        revisionSelection: expect.objectContaining({ kind: "rows" }),
      }),
    }));
  });

  it("shows saved-version conflicts to viewers without exposing write decisions", () => {
    mockState.undoable.present.itemList.loadedOutlineId = "outline-1";
    mockState.undoable.present.itemList.remoteConflicts = {
      "outline-1": { localItems: [], remoteItems: [], baselineItems: [] },
    };
    render(<GlobalInfoContext.Provider value={{ access: "view" } as any}><ServiceItems /></GlobalInfoContext.Provider>);
    expect(screen.getByRole("alert")).toHaveTextContent("Ask a controller operator to review them");
    expect(screen.queryByRole("button", { name: "Keep my draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use remote version" })).not.toBeInTheDocument();
  });

  it("syncs cyan list selection when selectedItemListId changes externally", () => {
    const { rerender } = render(
      <ControllerInfoContext.Provider
        value={{ access: "view", isMobile: false } as any}
      >
        <GlobalInfoContext.Provider value={{ access: "view" } as any}>
          <ServiceItems />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    mockState = {
      ...mockState,
      undoable: {
        ...mockState.undoable,
        present: {
          ...mockState.undoable.present,
          itemList: {
            ...mockState.undoable.present.itemList,
            selectedItemListId: "row-timer",
          },
        },
      },
    };

    rerender(
      <ControllerInfoContext.Provider
        value={{ access: "view", isMobile: false } as any}
      >
        <GlobalInfoContext.Provider value={{ access: "view" } as any}>
          <ServiceItems />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    expect(screen.getByTestId("row-timer")).toHaveAttribute(
      "data-list-selected",
      "true",
    );
    expect(screen.getByTestId("row-service-time")).toHaveAttribute(
      "data-list-selected",
      "false",
    );
  });

  const renderServiceItems = () =>
    render(
      <ControllerInfoContext.Provider
        value={{ access: "view", isMobile: false } as any}
      >
        <GlobalInfoContext.Provider value={{ access: "view" } as any}>
          <ServiceItems />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

  it("keeps the Service plan action available in Present mode", () => {
    window.localStorage.setItem("worshipsync_presentation_controller_mode", "present");

    render(
      <ControllerInfoContext.Provider
        value={{ access: "full", isMobile: false } as any}
      >
        <GlobalInfoContext.Provider value={{ access: "full" } as any}>
          <PresentationControllerModeProvider>
            <ServiceItems />
          </PresentationControllerModeProvider>
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    expect(screen.getByTestId("action-bar")).toHaveTextContent("Service plan");
    expect(screen.getByTestId("action-bar")).not.toHaveTextContent("Add heading");
  });

  it("requests a return to the selected slide when the current outline item is clicked again", () => {
    mockState.undoable.present.itemList.selectedItemListId = "row-timer";
    renderServiceItems();

    fireEvent.click(screen.getByRole("button", { name: "Timer" }));

    expect(mockRequestOutlineSelectionScroll).toHaveBeenCalledTimes(1);
  });

  it("does not request outline scroll when a different outline item is clicked", () => {
    mockState.undoable.present.itemList.selectedItemListId = "row-timer";
    renderServiceItems();

    fireEvent.click(screen.getByRole("button", { name: "Upcoming Service" }));

    expect(mockRequestOutlineSelectionScroll).not.toHaveBeenCalled();
  });

  it("requests a return to the selected slide for a full-access operator re-click", () => {
    mockState.undoable.present.itemList.selectedItemListId = "row-timer";
    render(
      <ControllerInfoContext.Provider
        value={{ access: "full", isMobile: false } as any}
      >
        <GlobalInfoContext.Provider value={{ access: "full" } as any}>
          <ServiceItems />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Timer" }));

    expect(mockRequestOutlineSelectionScroll).toHaveBeenCalledTimes(1);
  });
});
