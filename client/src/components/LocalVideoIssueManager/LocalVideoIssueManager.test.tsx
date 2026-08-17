import { act, render, waitFor } from "@testing-library/react";
import { ToastContext } from "../../context/toastContext";
import type { LocalVideoIssue } from "../../utils/localVideoIssues";
import { subscribeLocalVideoIssues } from "../../utils/localVideoIssues";
import LocalVideoIssueManager from "./LocalVideoIssueManager";

jest.mock("../../utils/localVideoIssues", () => ({
  subscribeLocalVideoIssues: jest.fn(),
}));

const mockSubscribe = jest.mocked(subscribeLocalVideoIssues);

it("surfaces audience video failures on the controller", async () => {
  const showToast = jest.fn(() => "toast-1");
  let report: ((issue: LocalVideoIssue) => void) | undefined;
  mockSubscribe.mockImplementation((onIssue) => {
    report = onIssue;
    return jest.fn();
  });

  render(
    <ToastContext.Provider
      value={{ showToast, updateToast: jest.fn(), removeToast: jest.fn() }}
    >
      <LocalVideoIssueManager />
    </ToastContext.Provider>,
  );

  act(() => {
    report?.({
      sourceId: "source-1",
      detail: "The projector could not decode the local video feed.",
      reportedAt: Date.now(),
    });
  });

  await waitFor(() =>
    expect(showToast).toHaveBeenCalledWith(
      "Local video: The projector could not decode the local video feed.",
      "warning",
    ),
  );
});
