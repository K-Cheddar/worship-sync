import { act, renderHook } from "@testing-library/react";
import { useTeamsLiveSync } from "./useTeamsLiveSync";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = Boolean(init?.withCredentials);
    MockEventSource.instances.push(this);
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  emitRaw(data: string) {
    this.onmessage?.({ data });
  }

  close() {
    this.closed = true;
  }
}

describe("useTeamsLiveSync", () => {
  const originalEventSource = (global as { EventSource?: unknown }).EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    (global as { EventSource?: unknown }).EventSource =
      MockEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    (global as { EventSource?: unknown }).EventSource = originalEventSource;
  });

  it("opens a church-scoped, credentialed stream and forwards parsed events", () => {
    const onMessage = jest.fn();
    const { result } = renderHook(() => useTeamsLiveSync("church-1", onMessage));

    expect(MockEventSource.instances).toHaveLength(1);
    const source = MockEventSource.instances[0];
    expect(source.url).toContain("api/churches/church-1/teams/stream");
    expect(source.withCredentials).toBe(true);
    expect(result.current.connectionState).toBe("connecting");
    expect(result.current.reconnectVersion).toBe(0);

    const event = {
      type: "schedule-updated",
      schedule: { scheduleId: "s1" },
    };
    source.emit(event);
    expect(onMessage).toHaveBeenCalledWith(event);
  });

  it("reports the initial open without counting it as a reconnect", () => {
    const { result } = renderHook(() => useTeamsLiveSync("church-1", jest.fn()));
    act(() => MockEventSource.instances[0].onopen?.());
    expect(result.current.connectionState).toBe("connected");
    expect(result.current.reconnectVersion).toBe(0);
  });

  it("reports one recovery for each disconnect followed by an open", () => {
    const { result } = renderHook(() => useTeamsLiveSync("church-1", jest.fn()));
    const source = MockEventSource.instances[0];
    act(() => source.onopen?.());
    act(() => {
      source.onerror?.();
      source.onerror?.();
    });
    expect(result.current.connectionState).toBe("disconnected");
    act(() => {
      source.onopen?.();
      source.onopen?.();
    });
    expect(result.current.connectionState).toBe("connected");
    expect(result.current.reconnectVersion).toBe(1);

    act(() => source.onerror?.());
    expect(result.current.connectionState).toBe("disconnected");
    act(() => source.onopen?.());
    expect(result.current.reconnectVersion).toBe(2);
  });

  it("does not open a stream without a churchId", () => {
    const { result } = renderHook(() => useTeamsLiveSync(null, jest.fn()));
    expect(MockEventSource.instances).toHaveLength(0);
    expect(result.current.connectionState).toBe("unavailable");
  });

  it("replaces and closes the stream when the church changes", () => {
    const { rerender } = renderHook(
      ({ churchId }: { churchId: string }) =>
        useTeamsLiveSync(churchId, jest.fn()),
      { initialProps: { churchId: "church-1" } },
    );
    const first = MockEventSource.instances[0];
    rerender({ churchId: "church-2" });
    expect(first.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].url).toContain("church-2");
  });

  it("reports unavailable when EventSource is missing", () => {
    (global as { EventSource?: unknown }).EventSource = undefined;
    const { result } = renderHook(() => useTeamsLiveSync("church-1", jest.fn()));
    expect(result.current.connectionState).toBe("unavailable");
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("closes the stream on unmount", () => {
    const { unmount } = renderHook(() =>
      useTeamsLiveSync("church-1", jest.fn()),
    );
    const source = MockEventSource.instances[0];
    unmount();
    expect(source.closed).toBe(true);
  });

  it("reports an unknown event when the payload is not valid JSON", () => {
    const onMessage = jest.fn();
    renderHook(() => useTeamsLiveSync("church-1", onMessage));
    MockEventSource.instances[0].emitRaw("not json");
    expect(onMessage).toHaveBeenCalledWith({ type: "unknown" });
  });
});
