import type { MediaType } from "../types";
import type { Transfer } from "../context/transferModel";
import { registerLocalAssetCleanupRetry } from "./mediaCleanupActivity";

it("retains independent same-ID cleanup actions across Church A, B, then A", async () => {
  const transfers = new Map<string, Transfer>();
  const handlers = new Map<string, () => void | Promise<void>>();
  const register = (id: string, key: string, handler: () => void | Promise<void>) => {
    handlers.set(`${id}:${key}`, handler);
    return () => { if (handlers.get(`${id}:${key}`) === handler) handlers.delete(`${id}:${key}`); };
  };
  let church = "a";
  const cleanupA = jest.fn(async () => { if (church !== "a") throw new Error("Switch back to a"); });
  const cleanupB = jest.fn(async () => { if (church !== "b") throw new Error("Switch back to b"); });
  const media = { id: "same-id", name: "Sermon" } as MediaType;
  const publish = (transfer: Transfer) => transfers.set(transfer.id, transfer);
  const remove = (id: string) => { transfers.delete(id); };
  registerLocalAssetCleanupRetry(media, cleanupA, new Error("offline"), publish, register, remove, { relinked: true, churchId: "a" });
  church = "b";
  registerLocalAssetCleanupRetry(media, cleanupB, new Error("offline"), publish, register, remove, { relinked: true, churchId: "b" });
  expect(transfers.size).toBe(2);
  church = "a";
  await handlers.get("media-relink-cleanup-a:same-id:retry-cleanup")!();
  expect(cleanupA).toHaveBeenCalledTimes(1);
  expect(cleanupB).not.toHaveBeenCalled();
  expect(transfers.has("media-relink-cleanup-a:same-id")).toBe(false);
  expect(transfers.has("media-relink-cleanup-b:same-id")).toBe(true);
  church = "b";
  await handlers.get("media-relink-cleanup-b:same-id:retry-cleanup")!();
  expect(cleanupB).toHaveBeenCalledTimes(1);
  expect(transfers.size).toBe(0);
});
