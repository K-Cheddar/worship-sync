import { getNotificationIntents, getTeamIntakeSmsAttempts } from "../../api/auth";
import { loadAvailabilityNotificationHistory } from "./availabilityNotificationHistory";

jest.mock("../../api/auth", () => ({
  getNotificationIntents: jest.fn(),
  getTeamIntakeSmsAttempts: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

it("loads every page of form history and its delivery attempts before resolving", async () => {
  jest.mocked(getNotificationIntents)
    .mockResolvedValueOnce({ success: true, intents: [{ intentId: "intent-1" } as never], nextCursor: "cursor-1", limit: 100 })
    .mockResolvedValueOnce({ success: true, intents: [{ intentId: "intent-2" } as never], nextCursor: "", limit: 100 });
  jest.mocked(getTeamIntakeSmsAttempts).mockResolvedValue({ success: true, attempts: [{ attemptId: "attempt-1" } as never] });

  const history = await loadAvailabilityNotificationHistory("church-1", "form-1");

  expect(getNotificationIntents).toHaveBeenNthCalledWith(1, "church-1", { formId: "form-1", limit: 100 });
  expect(getNotificationIntents).toHaveBeenNthCalledWith(2, "church-1", { formId: "form-1", limit: 100, cursor: "cursor-1" });
  expect(getTeamIntakeSmsAttempts).toHaveBeenCalledWith("church-1", "form-1");
  expect(history).toEqual({ intents: [{ intentId: "intent-1" }, { intentId: "intent-2" }], attempts: [{ attemptId: "attempt-1" }] });
});

it("does not return partial history when a later page fails", async () => {
  jest.mocked(getNotificationIntents)
    .mockResolvedValueOnce({ success: true, intents: [{ intentId: "intent-1" } as never], nextCursor: "cursor-1", limit: 100 })
    .mockRejectedValueOnce(new Error("history unavailable"));
  jest.mocked(getTeamIntakeSmsAttempts).mockResolvedValue({ success: true, attempts: [] });

  await expect(loadAvailabilityNotificationHistory("church-1", "form-1")).rejects.toThrow("history unavailable");
});

it("rejects unsuccessful intent or delivery history responses", async () => {
  jest.mocked(getNotificationIntents).mockResolvedValue({ success: false, intents: [], nextCursor: "", limit: 100 });
  jest.mocked(getTeamIntakeSmsAttempts).mockResolvedValue({ success: false, attempts: [] });

  await expect(loadAvailabilityNotificationHistory("church-1", "form-1")).rejects.toThrow("complete form message history");
  jest.mocked(getNotificationIntents).mockResolvedValue({ success: true, intents: [], nextCursor: "", limit: 100 });
  await expect(loadAvailabilityNotificationHistory("church-1", "form-1")).rejects.toThrow("complete SMS delivery history");
});
