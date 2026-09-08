import { act, renderHook } from "@testing-library/react";
import { type Database } from "firebase/database";
import { useSyncMonitorSettings } from "./useSyncMonitorSettings";
import { writeDisplayOutputs } from "../utils/displayOutputsWriter";
import displayOutputsReducer, {
  seedDisplayOutputSettings,
} from "../store/displayOutputsSlice";

const db = {} as Database;
const mockDispatch = jest.fn();

/** Mutable so a test can load the registry after Firebase has already fired. */
const registry: { list: unknown[]; isLoaded: boolean } = {
  list: [],
  isLoaded: false,
};

jest.mock("./reduxHooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ displayOutputs: registry }),
}));

jest.mock("../utils/displayOutputsWriter", () => ({
  writeDisplayOutputs: jest.fn().mockResolvedValue(true),
}));

const onValueCallbacks = new Map<
  string,
  (snapshot: { val: () => unknown }) => void
>();

jest.mock("firebase/database", () => ({
  ref: (_db: unknown, path: string) => ({ path }),
  onValue: (
    target: { path: string },
    success: (snapshot: { val: () => unknown }) => void,
  ) => {
    onValueCallbacks.set(target.path, success);
    return jest.fn();
  },
}));

const SETTINGS_PATH = "churches/church-1/data/monitorSettings";

const LEGACY = {
  showClock: true,
  showTimer: false,
  showNextSlide: true,
  clockFontSize: 80,
  timerFontSize: 60,
  timerId: null,
};

const MONITOR = { id: "monitor", type: "monitor", name: "Monitor", order: 1 };

describe("seeding legacy monitor settings onto the display registry", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    (writeDisplayOutputs as jest.Mock).mockClear();
    onValueCallbacks.clear();
    registry.list = [];
    registry.isLoaded = false;
  });

  it("still seeds when Firebase fires before the registry loads", () => {
    const { rerender } = renderHook(() =>
      useSyncMonitorSettings(db, "church-1", true),
    );

    // Firebase wins the race: the registry is not loaded yet.
    act(() => {
      onValueCallbacks.get(SETTINGS_PATH)?.({ val: () => LEGACY });
    });
    expect(writeDisplayOutputs).not.toHaveBeenCalled();

    // The registry arrives. Firebase will not fire again, so the seed has to be
    // retried from here or the church's settings are lost for good.
    registry.list = [MONITOR];
    registry.isLoaded = true;
    rerender();

    expect(writeDisplayOutputs).toHaveBeenCalledTimes(1);
  });

  it("never overwrites a value the church already configured", () => {
    // Legacy says showClock: true; the operator has since turned it off.
    registry.list = [{ ...MONITOR, settings: { showClock: false } }];
    registry.isLoaded = true;

    renderHook(() => useSyncMonitorSettings(db, "church-1", true));
    act(() => {
      onValueCallbacks.get(SETTINGS_PATH)?.({ val: () => LEGACY });
    });

    const [, , next] = (writeDisplayOutputs as jest.Mock).mock.calls[0];
    expect(next[0].settings.showClock).toBe(false);
  });

  it("backfills the settings a partial save left behind", () => {
    // Flipping one toggle used to count as "already migrated", stranding the
    // rest of the church's settings for good.
    registry.list = [{ ...MONITOR, settings: { showClock: false } }];
    registry.isLoaded = true;

    renderHook(() => useSyncMonitorSettings(db, "church-1", true));
    act(() => {
      onValueCallbacks.get(SETTINGS_PATH)?.({ val: () => LEGACY });
    });

    const [, , next] = (writeDisplayOutputs as jest.Mock).mock.calls[0];
    expect(next[0].settings).toMatchObject({
      showClock: false,
      showTimer: false,
      showNextSlide: true,
      clockFontSize: 80,
      timerFontSize: 60,
    });
  });

  it("stops once the display already holds the migrated settings", () => {
    registry.list = [MONITOR];
    registry.isLoaded = true;

    const { rerender } = renderHook(() =>
      useSyncMonitorSettings(db, "church-1", true),
    );
    act(() => {
      onValueCallbacks.get(SETTINGS_PATH)?.({ val: () => LEGACY });
    });
    expect(writeDisplayOutputs).toHaveBeenCalledTimes(1);

    applySeededRegistry();
    rerender();

    // Nothing left to fill, so it must not keep re-sending.
    expect(writeDisplayOutputs).toHaveBeenCalledTimes(1);
  });

  it("stops when the monitor already has extra fields the legacy node does not", () => {
    // Background and local-video keys are not in monitorSettings. Spreading
    // the legacy payload onto them used to change JSON key order, so the seed
    // never looked done and /monitor hit maximum update depth.
    registry.list = [
      { ...MONITOR, settings: { showBackground: true, localVideoVolume: 40 } },
    ];
    registry.isLoaded = true;

    const { rerender } = renderHook(() =>
      useSyncMonitorSettings(db, "church-1", true),
    );
    act(() => {
      onValueCallbacks.get(SETTINGS_PATH)?.({ val: () => LEGACY });
    });
    expect(writeDisplayOutputs).toHaveBeenCalledTimes(1);

    applySeededRegistry();
    rerender();
    rerender();

    expect(writeDisplayOutputs).toHaveBeenCalledTimes(1);
  });
});

/** Apply the seed the way Redux does, not the write payload's key order. */
const applySeededRegistry = () => {
  const seedAction = mockDispatch.mock.calls
    .map(([action]) => action)
    .find((action) => seedDisplayOutputSettings.match(action));
  if (!seedAction) return;
  registry.list = displayOutputsReducer(
    {
      list: registry.list as never,
      isLoaded: registry.isLoaded,
    },
    seedAction,
  ).list;
};
