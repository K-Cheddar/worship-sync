import { act, render, screen } from "@testing-library/react";
import { ToastProvider } from "./toastContext";
import { notifyPresentationSyncError } from "../utils/presentationSyncErrorBus";

describe("ToastProvider presentation sync errors", () => {
  it("shows an error toast when an overlay update is not delivered", async () => {
    render(
      <ToastProvider>
        <div>Controller</div>
      </ToastProvider>,
    );

    act(() => {
      notifyPresentationSyncError(
        "Overlay update was not sent. Check your connection and try again.",
      );
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Overlay update was not sent. Check your connection and try again.",
    );
  });
});
