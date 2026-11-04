import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServiceTimesForm from "./ServiceTimesForm";
import type { ServiceTime } from "../../types";

let mockTimeZone: string | null = "America/New_York";
jest.mock("../../context/churchServiceTimeZone", () => ({
  useChurchServiceTimeZone: () => ({ timeZone: mockTimeZone }),
}));
jest.mock("./StreamPreview", () => ({ __esModule: true, default: () => null }));

const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  window.matchMedia = jest.fn().mockImplementation(query => ({
    matches: false, media: query, onchange: null,
    addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  }));
});
afterEach(() => { window.matchMedia = originalMatchMedia; });

const initialValues: ServiceTime = { id: "book-launch", name: "Book Launch 2026", timerType: "countdown", reccurence: "one_time", dateTimeISO: "2026-11-07T16:30" };

it("persists controller-created one-time services as explicit church-timezone instants", async () => {
  mockTimeZone = "America/New_York";
  const save = jest.fn();
  render(<ServiceTimesForm editingId={null} initialValues={initialValues} onSave={save} onCancel={jest.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ reccurence: "one_time", dateTimeISO: "2026-11-07T21:30:00.000Z" }));
});

it("requires the authoritative church timezone for one-time creation", () => {
  mockTimeZone = null;
  render(<ServiceTimesForm editingId={null} initialValues={initialValues} onSave={jest.fn()} onCancel={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  expect(screen.getByLabelText("Date & Time")).toBeDisabled();
});
