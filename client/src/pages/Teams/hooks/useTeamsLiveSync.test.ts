import { renderHook } from "@testing-library/react";
import { useTeamsLiveSync } from "./useTeamsLiveSync";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onmessage: ((event: { data: string }) => void) | null = null;
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
    renderHook(() => useTeamsLiveSync("church-1", onMessage));

    expect(MockEventSource.instances).toHaveLength(1);
    const source = MockEventSource.instances[0];
    expect(source.url).toContain("api/churches/church-1/teams/stream");
    expect(source.withCredentials).toBe(true);

    const event = {
      type: "schedule-updated",
      schedule: { scheduleId: "s1" },
    };
    source.emit(event);
    expect(onMessage).toHaveBeenCalledWith(event);
  });

  it("does not open a stream without a churchId", () => {
    renderHook(() => useTeamsLiveSync(null, jest.fn()));
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
