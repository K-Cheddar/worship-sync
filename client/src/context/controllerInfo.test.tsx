import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import store from "../store/store";
import ControllerInfoProvider, { ControllerInfoContext } from "./controllerInfo";
import { GlobalInfoContext } from "./globalInfo";
import { createMockGlobalContext } from "../test/mocks";

const mockPouchInstances: Array<{
  name: string;
  destroy: jest.Mock;
  bulkDocs: jest.Mock;
}> = [];

jest.mock("pouchdb-browser", () => {
  const PouchDBMock = jest.fn().mockImplementation((name: string) => {
    const instance = {
      name,
      destroy: jest.fn().mockResolvedValue(undefined),
      bulkDocs: jest.fn().mockResolvedValue([]),
      sync: jest.fn(),
      replicate: {
        to: jest.fn(),
      },
      changes: jest.fn(),
    };
    mockPouchInstances.push(instance);
    return instance;
  });

  return {
    __esModule: true,
    default: PouchDBMock,
  };
});

const Probe = () => {
  const context = React.useContext(ControllerInfoContext);
  return (
    <div>
      <div data-testid="progress">{context?.dbProgress}</div>
      <div data-testid="status">{context?.connectionStatus.status}</div>
      <div data-testid="has-db">{context?.db ? "yes" : "no"}</div>
    </div>
  );
};

describe("ControllerInfoProvider", () => {
  beforeEach(() => {
    mockPouchInstances.length = 0;
    global.fetch = jest.fn() as jest.Mock;
    (global as unknown as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel =
      jest.fn().mockImplementation(() => ({
        close: jest.fn(),
        postMessage: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })) as unknown as typeof BroadcastChannel;
  });

  it("sets up guest mode from the bundled seed without a server session", async () => {
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider
          value={
            createMockGlobalContext({
              loginState: "guest",
              sessionKind: null,
              database: "demo",
            }) as any
          }
        >
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider>
              <Probe />
            </ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-db")).toHaveTextContent("yes");
    });

    expect(screen.getByTestId("progress")).toHaveTextContent("100");
    expect(screen.getByTestId("status")).toHaveTextContent("connected");
    expect(global.fetch).not.toHaveBeenCalled();

    const seededDb = mockPouchInstances.find(
      (instance) =>
        instance.name === "worship-sync-demo-guest" &&
        instance.bulkDocs.mock.calls.length > 0,
    );
    expect(seededDb?.bulkDocs).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ _id: "allItems" }),
        expect.objectContaining({ _id: "ItemLists" }),
        expect.objectContaining({ _id: "offline-demo-outline" }),
      ]),
    );
  });
});
