import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GlobalInfoProvider from "./globalInfo";

const mockDispatch = jest.fn();
const onValueCallbacks = new Map<string, (snapshot: any) => void>();

const refMock = jest.fn(
  (_db: unknown, path: string) =>
    ({
      path,
    }) as { path: string }
);
const onValueMock = jest.fn(
  (target: { path: string }, callback: (snapshot: any) => void) => {
    onValueCallbacks.set(target.path, callback);
    return jest.fn();
  }
);
const setMock = jest.fn();
const getDatabaseMock = jest.fn(() => ({ name: "firebase-db" }));
const initializeAppMock = jest.fn();
const getAuthMock = jest.fn(() => ({ name: "auth" }));
const signInWithEmailAndPasswordMock = jest.fn(() => Promise.resolve({}));
const onDisconnectRemoveMock = jest.fn();
const onDisconnectMock = jest.fn(() => ({
  remove: onDisconnectRemoveMock,
}));

jest.mock("../hooks", () => ({
  useDispatch: () => mockDispatch,
}));

jest.mock("firebase/app", () => ({
  initializeApp: (...args: unknown[]) => initializeAppMock(...args),
}));

jest.mock("firebase/auth", () => ({
  getAuth: () => getAuthMock(),
  signInWithEmailAndPassword: (...args: unknown[]) =>
    signInWithEmailAndPasswordMock(...args),
}));

jest.mock("firebase/database", () => ({
  getDatabase: () => getDatabaseMock(),
  ref: (...args: unknown[]) => refMock(...args),
  onValue: (...args: unknown[]) => onValueMock(...args),
  set: (...args: unknown[]) => setMock(...args),
  onDisconnect: (...args: unknown[]) => onDisconnectMock(...args),
}));

jest.mock("../api/login", () => ({
  loginUser: jest.fn(),
}));

const renderProvider = () =>
  render(
    <MemoryRouter initialEntries={["/controller"]}>
      <GlobalInfoProvider>
        <div>child</div>
      </GlobalInfoProvider>
    </MemoryRouter>
  );

const snapshotFor = (value: any) => ({
  exists: () => value !== undefined && value !== null,
  val: () => value,
});

describe("GlobalInfoProvider presentation listener contracts", () => {
  beforeEach(() => {
    localStorage.clear();
    mockDispatch.mockClear();
    onValueCallbacks.clear();
    refMock.mockClear();
    onValueMock.mockClear();
    setMock.mockClear();
    initializeAppMock.mockClear();
    getDatabaseMock.mockClear();
    getAuthMock.mockClear();
    signInWithEmailAndPasswordMock.mockClear();
    onDisconnectMock.mockClear();
    onDisconnectRemoveMock.mockClear();
  });

  it("routes storage updates to the current debounced projector, monitor, and stream actions", async () => {
    renderProvider();

    const projectorInfo = { name: "Stored Projector", time: 101 };
    const monitorInfo = { name: "Stored Monitor", time: 202 };
    const streamInfo = { name: "Stored Stream", time: 303 };

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "projectorInfo",
        newValue: JSON.stringify(projectorInfo),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "monitorInfo",
        newValue: JSON.stringify(monitorInfo),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "streamInfo",
        newValue: JSON.stringify(streamInfo),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_itemContentBlocked",
        newValue: JSON.stringify(false),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "not_a_screen_key",
        newValue: JSON.stringify({ ignored: true }),
      })
    );

    await waitFor(() =>
      expect(mockDispatch.mock.calls).toEqual(
        expect.arrayContaining([
          [
            {
              type: "debouncedUpdateProjector",
              payload: projectorInfo,
            },
          ],
          [
            {
              type: "debouncedUpdateMonitor",
              payload: monitorInfo,
            },
          ],
          [
            {
              type: "debouncedUpdateStream",
              payload: streamInfo,
            },
          ],
          [
            {
              type: "debouncedUpdateStreamItemContentBlocked",
              payload: false,
            },
          ],
        ])
      )
    );
    expect(mockDispatch).toHaveBeenCalledTimes(4);
  });

  it("subscribes to the default presentation listener keys and dispatches their debounced actions", async () => {
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", "Test User");
    localStorage.setItem("database", "main");

    renderProvider();

    await waitFor(() => expect(initializeAppMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onValueCallbacks.has("users/Main/v2/presentation/projectorInfo")).toBe(
        true
      )
    );

    expect(onValueCallbacks.has("users/Main/v2/presentation/monitorInfo")).toBe(
      true
    );
    expect(onValueCallbacks.has("users/Main/v2/presentation/streamInfo")).toBe(
      true
    );
    expect(
      onValueCallbacks.has("users/Main/v2/presentation/stream_itemContentBlocked")
    ).toBe(true);

    mockDispatch.mockClear();

    onValueCallbacks
      .get("users/Main/v2/presentation/projectorInfo")
      ?.(snapshotFor({ name: "Remote Projector", time: 500 }));
    onValueCallbacks
      .get("users/Main/v2/presentation/monitorInfo")
      ?.(snapshotFor({ name: "Remote Monitor", time: 600 }));
    onValueCallbacks
      .get("users/Main/v2/presentation/streamInfo")
      ?.(snapshotFor({ name: "Remote Stream", time: 700 }));
    onValueCallbacks
      .get("users/Main/v2/presentation/stream_itemContentBlocked")
      ?.(snapshotFor(true));

    await waitFor(() =>
      expect(mockDispatch.mock.calls).toEqual(
        expect.arrayContaining([
          [
            {
              type: "debouncedUpdateProjector",
              payload: { name: "Remote Projector", time: 500 },
            },
          ],
          [
            {
              type: "debouncedUpdateMonitor",
              payload: { name: "Remote Monitor", time: 600 },
            },
          ],
          [
            {
              type: "debouncedUpdateStream",
              payload: { name: "Remote Stream", time: 700 },
            },
          ],
          [
            {
              type: "debouncedUpdateStreamItemContentBlocked",
              payload: true,
            },
          ],
        ])
      )
    );
  });

  it("routes legacy stream subkeys from storage and Firebase to the current debounced actions", async () => {
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", "Test User");
    localStorage.setItem("database", "main");

    renderProvider();

    const bibleInfo = { title: "John 3:16", time: 1001 };
    const participantOverlay = { name: "Alex", time: 1002 };
    const stbOverlay = { heading: "Now Playing", time: 1003 };
    const qrOverlay = { description: "Scan Here", time: 1004 };
    const imageOverlay = { imageUrl: "image.jpg", time: 1005 };
    const formattedText = { text: "Formatted", time: 1006 };

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_bibleInfo",
        newValue: JSON.stringify(bibleInfo),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_participantOverlayInfo",
        newValue: JSON.stringify(participantOverlay),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_stbOverlayInfo",
        newValue: JSON.stringify(stbOverlay),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_qrCodeOverlayInfo",
        newValue: JSON.stringify(qrOverlay),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_imageOverlayInfo",
        newValue: JSON.stringify(imageOverlay),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_formattedTextDisplayInfo",
        newValue: JSON.stringify(formattedText),
      })
    );

    await waitFor(() =>
      expect(mockDispatch.mock.calls).toEqual(
        expect.arrayContaining([
          [{ type: "debouncedUpdateBibleDisplayInfo", payload: bibleInfo }],
          [
            {
              type: "debouncedUpdateParticipantOverlayInfo",
              payload: participantOverlay,
            },
          ],
          [{ type: "debouncedUpdateStbOverlayInfo", payload: stbOverlay }],
          [{ type: "debouncedUpdateQrCodeOverlayInfo", payload: qrOverlay }],
          [{ type: "debouncedUpdateImageOverlayInfo", payload: imageOverlay }],
          [
            {
              type: "debouncedUpdateFormattedTextDisplayInfo",
              payload: formattedText,
            },
          ],
        ])
      )
    );

    await waitFor(() =>
      expect(
        onValueCallbacks.has("users/Main/v2/presentation/stream_bibleInfo")
      ).toBe(true)
    );
    expect(
      onValueCallbacks.has("users/Main/v2/presentation/stream_participantOverlayInfo")
    ).toBe(true);
    expect(
      onValueCallbacks.has("users/Main/v2/presentation/stream_stbOverlayInfo")
    ).toBe(true);
    expect(
      onValueCallbacks.has("users/Main/v2/presentation/stream_qrCodeOverlayInfo")
    ).toBe(true);
    expect(
      onValueCallbacks.has("users/Main/v2/presentation/stream_imageOverlayInfo")
    ).toBe(true);
    expect(
      onValueCallbacks.has(
        "users/Main/v2/presentation/stream_formattedTextDisplayInfo"
      )
    ).toBe(true);

    mockDispatch.mockClear();

    onValueCallbacks
      .get("users/Main/v2/presentation/stream_bibleInfo")
      ?.(snapshotFor(bibleInfo));
    onValueCallbacks
      .get("users/Main/v2/presentation/stream_participantOverlayInfo")
      ?.(snapshotFor(participantOverlay));
    onValueCallbacks
      .get("users/Main/v2/presentation/stream_stbOverlayInfo")
      ?.(snapshotFor(stbOverlay));
    onValueCallbacks
      .get("users/Main/v2/presentation/stream_qrCodeOverlayInfo")
      ?.(snapshotFor(qrOverlay));
    onValueCallbacks
      .get("users/Main/v2/presentation/stream_imageOverlayInfo")
      ?.(snapshotFor(imageOverlay));
    onValueCallbacks
      .get("users/Main/v2/presentation/stream_formattedTextDisplayInfo")
      ?.(snapshotFor(formattedText));

    await waitFor(() =>
      expect(mockDispatch.mock.calls).toEqual(
        expect.arrayContaining([
          [{ type: "debouncedUpdateBibleDisplayInfo", payload: bibleInfo }],
          [
            {
              type: "debouncedUpdateParticipantOverlayInfo",
              payload: participantOverlay,
            },
          ],
          [{ type: "debouncedUpdateStbOverlayInfo", payload: stbOverlay }],
          [{ type: "debouncedUpdateQrCodeOverlayInfo", payload: qrOverlay }],
          [{ type: "debouncedUpdateImageOverlayInfo", payload: imageOverlay }],
          [
            {
              type: "debouncedUpdateFormattedTextDisplayInfo",
              payload: formattedText,
            },
          ],
        ])
      )
    );
  });
});
