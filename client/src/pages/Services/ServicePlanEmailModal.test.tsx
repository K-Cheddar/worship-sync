import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ServicePlanShareEmailResult } from "../../api/auth";
import ServicePlanEmailModal, {
  type ServicePlanEmailDraft,
} from "./ServicePlanEmailModal";

const renderModal = (
  onSend: (
    draft: ServicePlanEmailDraft,
  ) => Promise<ServicePlanShareEmailResult>,
) =>
  render(
    <ServicePlanEmailModal
      serviceName="Easter Sunday"
      dateLabel="July 26, 2026"
      onClose={jest.fn()}
      onSend={onSend}
    />,
  );

describe("ServicePlanEmailModal", () => {
  it("prepopulates editable fields and prevents duplicate clicks while sending", async () => {
    const user = userEvent.setup();
    let resolveSend!: () => void;
    const sentDrafts: ServicePlanEmailDraft[] = [];
    const onSend = jest.fn(
      (draft: ServicePlanEmailDraft) =>
        new Promise<ServicePlanShareEmailResult>((resolve) => {
          sentDrafts.push(draft);
          resolveSend = () =>
            resolve({
              success: true,
              sent: 2,
              failed: 0,
              failedRecipients: [],
            });
        }),
    );
    renderModal(onSend);

    expect(screen.getByRole("textbox", { name: /^Subject:/ })).toHaveValue(
      "Easter Sunday Service Plan — July 26, 2026",
    );
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Here is the service plan for Easter Sunday on July 26, 2026.",
    );

    await user.clear(screen.getByRole("textbox", { name: /^Subject:/ }));
    await user.type(screen.getByRole("textbox", { name: /^Subject:/ }), "Updated subject");
    await user.clear(screen.getByRole("textbox", { name: "Message" }));
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Updated message");
    await user.type(
      screen.getByRole("textbox", { name: /^To:/ }),
      "one@example.com, two@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send email" }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(sentDrafts).toEqual([
      {
        recipients: ["one@example.com", "two@example.com"],
        subject: "Updated subject",
        message: "Updated message",
      },
    ]);
    expect(
      await screen.findByRole("button", { name: "Sending…" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Sending…" }));
    expect(onSend).toHaveBeenCalledTimes(1);

    resolveSend();
    expect(
      await screen.findByText("Service plan email sent successfully."),
    ).toBeInTheDocument();
  });

  it("shows a useful provider error and keeps the draft available", async () => {
    const user = userEvent.setup();
    const onSend = jest.fn(async () => {
      throw new Error("Email provider is unavailable.");
    });
    renderModal(onSend);

    await user.type(screen.getByRole("textbox", { name: /^To:/ }), "one@example.com");
    await user.click(screen.getByRole("button", { name: "Send email" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email provider is unavailable.",
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send email" })).toBeEnabled();
    });
    expect(screen.getByRole("textbox", { name: /^Subject:/ })).toHaveValue(
      "Easter Sunday Service Plan — July 26, 2026",
    );
  });

  it("reports partial delivery and retries only failed recipients", async () => {
    const user = userEvent.setup();
    const onSend = jest
      .fn<
        (
          draft: ServicePlanEmailDraft,
        ) => Promise<ServicePlanShareEmailResult>
      >()
      .mockResolvedValueOnce({
        success: false,
        sent: 1,
        failed: 1,
        failedRecipients: ["failed@example.com"],
      })
      .mockResolvedValueOnce({
        success: true,
        sent: 1,
        failed: 0,
        failedRecipients: [],
      });
    renderModal(onSend);

    await user.type(
      screen.getByRole("textbox", { name: /^To:/ }),
      "sent@example.com, failed@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send email" }));

    expect(
      await screen.findByText(
        /Sent to 1 recipient\. Could not send to 1 recipient\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^To:/ })).toHaveValue(
      "failed@example.com",
    );
    expect(
      screen.getByRole("button", { name: "Retry failed emails" }),
    ).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Retry failed emails" }));
    expect(onSend).toHaveBeenLastCalledWith({
      recipients: ["failed@example.com"],
      subject: "Easter Sunday Service Plan — July 26, 2026",
      message: "Here is the service plan for Easter Sunday on July 26, 2026.",
    });
    expect(
      await screen.findByText("Service plan email sent successfully."),
    ).toBeInTheDocument();
  });

  it("keeps a long default subject within the server limit", () => {
    const longServiceName = "A".repeat(300);
    const dateLabel = "July 26, 2026";
    const suffix = ` Service Plan — ${dateLabel}`;
    const expectedSubject = `${longServiceName.slice(
      0,
      200 - suffix.length - 1,
    )}…${suffix}`;

    render(
      <ServicePlanEmailModal
        serviceName={longServiceName}
        dateLabel={dateLabel}
        onClose={jest.fn()}
        onSend={jest.fn(async () => ({
          success: true,
          sent: 1,
          failed: 0,
          failedRecipients: [],
        }))}
      />,
    );

    expect(screen.getByRole("textbox", { name: /^Subject:/ })).toHaveValue(
      expectedSubject,
    );
  });
});
