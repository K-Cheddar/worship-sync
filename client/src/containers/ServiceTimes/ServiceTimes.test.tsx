import { render, screen, waitFor } from "@testing-library/react";
import ServiceTimes from "./ServiceTimes";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";

const mockDispatch = jest.fn();
let mockState: any;

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../../hooks/useGlobalBroadcast", () => ({
  useGlobalBroadcast: jest.fn(),
}));

jest.mock("../../hooks/useDisplayedUpcomingService", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../../hooks/useNextServiceCountdownText", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("./ServiceTimesForm", () => ({
  __esModule: true,
  default: () => <div data-testid="service-times-form" />,
}));

jest.mock("./StreamPreview", () => ({
  __esModule: true,
  default: () => <div data-testid="stream-preview" />,
}));

jest.mock("./ServiceTimesList", () => ({
  __esModule: true,
  default: ({ services }: { services: Array<{ name: string }> }) => (
    <div data-testid="service-times-list">
      {services.map((service) => service.name).join(", ")}
    </div>
  ),
}));

jest.mock("../../components/Button/Button", () => ({
  __esModule: true,
  default: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

jest.mock("../../components/Spinner/Spinner", () => ({
  __esModule: true,
  default: () => <div data-testid="spinner" />,
}));

jest.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  lineTabsListShellClassName: "",
  lineTabsTriggerClassName: "",
}));

describe("ServiceTimes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    });
    mockState = {
      undoable: {
        present: {
          serviceTimes: {
            list: [{ id: "svc-1", name: "Sunday 9 AM" }],
            isInitialized: true,
          },
        },
      },
    };
  });

  it("does not reload services from local db after live services are already initialized", async () => {
    const dbGet = jest.fn();

    render(
      <ControllerInfoContext.Provider
        value={{ db: { get: dbGet }, isMobile: false } as any}
      >
        <ServiceTimes />
      </ControllerInfoContext.Provider>,
    );

    expect(screen.getByTestId("service-times-list")).toHaveTextContent(
      "Sunday 9 AM",
    );

    await waitFor(() => {
      expect(dbGet).not.toHaveBeenCalled();
    });

    expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
  });

  it("waits for lifecycle initialization instead of loading services on its own", async () => {
    const dbGet = jest.fn();
    mockState.undoable.present.serviceTimes = {
      list: [],
      isInitialized: false,
    };

    const { rerender } = render(
      <ControllerInfoContext.Provider
        value={{ db: { get: dbGet }, isMobile: false } as any}
      >
        <ServiceTimes />
      </ControllerInfoContext.Provider>,
    );

    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(dbGet).not.toHaveBeenCalled();

    mockState.undoable.present.serviceTimes = {
      list: [{ id: "svc-2", name: "Live 11 AM" }],
      isInitialized: true,
    };

    rerender(
      <ControllerInfoContext.Provider
        value={{ db: { get: dbGet }, isMobile: false } as any}
      >
        <ServiceTimes />
      </ControllerInfoContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("service-times-list")).toHaveTextContent(
        "Live 11 AM",
      );
    });

    expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
    expect(dbGet).not.toHaveBeenCalled();
  });

  it("does not offer timer creation without Services edit access", () => {
    render(
      <GlobalInfoContext.Provider
        value={{ access: "music", canEditServices: false } as never}
      >
        <ControllerInfoContext.Provider value={{ isMobile: false } as any}>
          <ServiceTimes />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(
      screen.queryByRole("button", { name: "Add Service Timer" }),
    ).not.toBeInTheDocument();
  });

  it("warns that guest changes stay on the current device", () => {
    render(
      <GlobalInfoContext.Provider
        value={{ access: "full", loginState: "guest" } as never}
      >
        <ControllerInfoContext.Provider value={{ isMobile: false } as any}>
          <ServiceTimes />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Guest mode keeps service-time changes on this device",
    );
  });

  it("prevents authenticated edits until shared data is ready", () => {
    render(
      <GlobalInfoContext.Provider
        value={{
          access: "full",
          loginState: "success",
          sharedDataReady: false,
        } as never}
      >
        <ControllerInfoContext.Provider value={{ isMobile: false } as any}>
          <ServiceTimes />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Live sync is connecting",
    );
    expect(screen.queryByRole("button", { name: "Add Service Timer" }))
      .not.toBeInTheDocument();
  });

  it("does not render the page-level service times heading", () => {
    render(
      <ControllerInfoContext.Provider value={{ isMobile: false } as any}>
        <ServiceTimes />
      </ControllerInfoContext.Provider>,
    );

    expect(
      screen.queryByRole("heading", { name: "Service times" }),
    ).not.toBeInTheDocument();
  });
});
