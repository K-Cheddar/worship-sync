import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { manageVolunteerPersonalAccess } from "../../../api/auth";
import { volunteerRequestKey } from "../../../api/volunteer";
import VolunteerPersonalAccessControls from "./VolunteerPersonalAccessControls";

jest.mock("../../../api/auth", () => ({ manageVolunteerPersonalAccess: jest.fn() }));
jest.mock("../../../api/volunteer", () => ({ volunteerRequestKey: jest.fn() }));
jest.mock("../../../context/toastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("../../../utils/apiErrorToast", () => ({ showApiErrorToast: jest.fn() }));

beforeEach(() => { jest.resetAllMocks(); sessionStorage.clear(); });
afterEach(() => { sessionStorage.clear(); });

it("retains the replacement request after lost success and retires it only after confirmation", async () => {
  const api = jest.mocked(manageVolunteerPersonalAccess);
  api.mockResolvedValueOnce({ success: true, enabled: true, status: "active" });
  jest.mocked(volunteerRequestKey).mockReturnValueOnce("replacement-request-one")
    .mockReturnValueOnce("unused-contact-completion-key").mockReturnValueOnce("replacement-request-two");
  const user = userEvent.setup();
  render(<VolunteerPersonalAccessControls churchId="church" memberId="member" />);
  await user.click(await screen.findByText("Personal My Schedule access"));
  api.mockRejectedValueOnce(new Error("Response lost"));
  await user.click(screen.getByRole("button", { name: "Replace personal link" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Replace personal link" })).toBeEnabled());
  api.mockResolvedValueOnce({ success: true, url: "https://example.test/s#synthetic" });
  await user.click(screen.getByRole("button", { name: "Replace personal link" }));
  await screen.findByRole("link", { name: "https://example.test/s#synthetic" });
  api.mockResolvedValueOnce({ success: true });
  await user.click(screen.getByRole("button", { name: "Replace personal link" }));
  const replacements = api.mock.calls.filter((call) => call[2] === "replace");
  expect(replacements.map((call) => call[3])).toEqual([
    expect.objectContaining({ requestKey: "replacement-request-one" }),
    expect.objectContaining({ requestKey: "replacement-request-one" }),
    expect.objectContaining({ requestKey: "replacement-request-two" }),
  ]);
});


it("reuses the persisted non-secret operation ID after the editor reloads", async () => {
  const api = jest.mocked(manageVolunteerPersonalAccess);
  api.mockResolvedValueOnce({ success: true, enabled: true, status: "active" });
  jest.mocked(volunteerRequestKey).mockReturnValueOnce("replacement-reload-key")
    .mockReturnValueOnce("first-completion-key").mockReturnValueOnce("second-completion-key");
  const user = userEvent.setup();
  const view = render(<VolunteerPersonalAccessControls churchId="church" memberId="member" />);
  await user.click(await screen.findByText("Personal My Schedule access"));
  api.mockRejectedValueOnce(new Error("Response lost"));
  await user.click(screen.getByRole("button", { name: "Replace personal link" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Replace personal link" })).toBeEnabled());
  view.unmount();
  api.mockResolvedValueOnce({ success: true, enabled: true, status: "active" });
  render(<VolunteerPersonalAccessControls churchId="church" memberId="member" />);
  await user.click(await screen.findByText("Personal My Schedule access"));
  api.mockResolvedValueOnce({ success: true });
  await user.click(screen.getByRole("button", { name: "Replace personal link" }));
  const replacements = api.mock.calls.filter((call) => call[2] === "replace");
  expect(replacements).toHaveLength(2);
  expect(replacements.map((call) => call[3])).toEqual([
    expect.objectContaining({ requestKey: "replacement-reload-key" }),
    expect.objectContaining({ requestKey: "replacement-reload-key" }),
  ]);
  expect(sessionStorage.length).toBe(0);
});


it("does not send a replacement when its retry ID cannot be retained", async () => {
  const api = jest.mocked(manageVolunteerPersonalAccess);
  api.mockResolvedValueOnce({ success: true, enabled: true, status: "active" });
  jest.mocked(volunteerRequestKey).mockReturnValueOnce("unsent-key").mockReturnValueOnce("retained-key")
    .mockReturnValueOnce("completion-key");
  const user = userEvent.setup();
  render(<VolunteerPersonalAccessControls churchId="church" memberId="member" />);
  await user.click(await screen.findByText("Personal My Schedule access"));
  const storage = jest.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("Storage unavailable"); });
  try {
    await user.click(screen.getByRole("button", { name: "Replace personal link" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Replace personal link" })).toBeEnabled());
    expect(api.mock.calls.filter((call) => call[2] === "replace")).toHaveLength(0);
    api.mockResolvedValueOnce({ success: true });
    await user.click(screen.getByRole("button", { name: "Replace personal link" }));
    expect(api).toHaveBeenLastCalledWith("church", "member", "replace", expect.objectContaining({ requestKey: "retained-key" }));
  } finally { storage.mockRestore(); }
});
