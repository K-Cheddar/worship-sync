import { act, renderHook } from "@testing-library/react";
import { globalBroadcastRef } from "../context/controllerInfo";
import { useGlobalBroadcast } from "./useGlobalBroadcast";

jest.mock("../context/controllerInfo", () => ({ globalBroadcastRef: new EventTarget() }));
jest.mock("../context/globalInfo", () => ({ globalHostId: "local" }));

it("coalesces documents across batches instead of dropping earlier notifications", () => {
  jest.useFakeTimers();
  const callback = jest.fn();
  const { unmount } = renderHook(() => useGlobalBroadcast(callback));
  const channel = globalBroadcastRef as unknown as EventTarget;
  act(() => {
    for (const docs of [[{ _id: "a", words: "old" }, { _id: "b" }], [{ _id: "a", words: "new" }], [{ _id: "c" }]]) {
      channel.dispatchEvent(new MessageEvent("message", { data: { type: "update", data: { hostId: "remote", docs } } }));
    }
    jest.advanceTimersByTime(300);
  });
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledWith({ detail: [{ _id: "a", words: "new" }, { _id: "b" }, { _id: "c" }] });
  unmount();
  jest.useRealTimers();
});
