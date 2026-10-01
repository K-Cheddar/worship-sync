import { prepareAvailabilityNotificationBatch } from "../../api/auth";
import { prepareAvailabilityBatchForMembers } from "./availabilityBatchActions";
import type { NotificationBatch } from "../../api/authTypes";

jest.mock("../../api/auth", () => ({
  prepareAvailabilityNotificationBatch: jest.fn(),
  dispatchAvailabilityNotificationBatch: jest.fn(),
}));

const batch = { batchId: "batch-1" } as NotificationBatch;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  jest.mocked(prepareAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch });
});

it("reuses an idempotency key for the same recipient set and starts a new key when selection changes", async () => {
  const request = (memberIds: string[]) => prepareAvailabilityBatchForMembers({ churchId: "church-1", formId: "form-1", intentType: "availability_request", memberIds });
  jest.mocked(prepareAvailabilityNotificationBatch).mockRejectedValueOnce(new Error("temporary"));
  await expect(request(["member-b", "member-a"])).rejects.toThrow("temporary");
  await request(["member-a", "member-b"]);
  await request(["member-c"]);

  const requests = jest.mocked(prepareAvailabilityNotificationBatch).mock.calls.map(([, body]) => body);
  expect(requests[0].memberIds).toEqual(["member-a", "member-b"]);
  expect(requests[1].requestKey).toBe(requests[0].requestKey);
  expect(requests[2].requestKey).not.toBe(requests[1].requestKey);
});
