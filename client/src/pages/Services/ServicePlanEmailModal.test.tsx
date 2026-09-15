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
  initialShareVersion: ServicePlanEmailDraft["shareVersion"] = "detailed",
) =>
  render(
    <ServicePlanEmailModal
      serviceName="Easter Sunday"
      dateLabel="July 26, 2026"
      initialShareVersion={initialShareVersion}
      onClose={jest.fn()}
      onSend={onSend}
    />,
  );

describe("ServicePlanEmailModal", () => {
  // Radix modal + user-event typing stacks under full-suite coverage load;
  // the default 5s Jest timeout is too tight for this file when the machine is busy.
  jest.setTimeout(15_000);

  beforeEach(() => {
    localStorage.clear();
  });

  it("prepopulates editable fields and prevents duplicate clicks while sending", async () => {
    const user = userEvent.setup({ delay: null });
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
      screen.getByRole("textbox", { name: "To" }),
      "one@example.com, two@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send email" }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(sentDrafts).toEqual([
      {
        recipients: ["one@example.com", "two@example.com"],
        subject: "Updated subject",
        message: "Updated message",
        shareVersion: "detailed",
      },
    ]);
    expect(
      await screen.findByRole("button", { name: "Sending…" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Sending…" }));
    expect(onSend).toHaveBeenCalledTimes(1);

    resolveSend();
    expect(
      await screen.findByText(
        "Service plan email sent successfully to one@example.com, two@example.com.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a useful provider error and keeps the draft available", async () => {
    const user = userEvent.setup({ delay: null });
    const onSend = jest.fn(async () => {
      throw new Error("Email provider is unavailable.");
    });
    renderModal(onSend);

    await user.type(screen.getByRole("textbox", { name: "To" }), "one@example.com");
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
    const user = userEvent.setup({ delay: null });
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
      screen.getByRole("textbox", { name: "To" }),
      "sent@example.com, failed@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send email" }));

    expect(
      await screen.findByText(
        /Sent to 1 recipient\. Could not send to 1 recipient\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove failed@example.com" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry failed emails" }),
    ).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Retry failed emails" }));
    expect(onSend).toHaveBeenLastCalledWith({
      recipients: ["failed@example.com"],
      subject: "Easter Sunday Service Plan — July 26, 2026",
      message: "Here is the service plan for Easter Sunday on July 26, 2026.",
      shareVersion: "detailed",
    });
    expect(
      await screen.findByText(
        "Service plan email sent successfully to sent@example.com, failed@example.com.",
      ),
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
        initialShareVersion="detailed"
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

  it("initializes the selected version and sends the version chosen in the modal", async () => {
    const user = userEvent.setup({ delay: null });
    const onSend = jest.fn(async () => ({
      success: true,
      sent: 1,
      failed: 0,
      failedRecipients: [],
    }));
    renderModal(onSend, "simple");

    expect(screen.getByText(/current simple service plan link/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simple" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Detailed" }));
    expect(screen.getByText(/current detailed service plan link/i)).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "To" }),
      "one@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send email" }));

    expect(onSend).toHaveBeenCalledWith({
      recipients: ["one@example.com"],
      subject: "Easter Sunday Service Plan â€” July 26, 2026",
      message: "Here is the service plan for Easter Sunday on July 26, 2026.",
      shareVersion: "detailed",
      ...{ subject: expect.any(String) },
    });
  });

  it("sends simple after changing the detailed default", async () => {
    const user = userEvent.setup({ delay: null });
    const onSend = jest.fn(async () => ({
      success: true,
      sent: 1,
      failed: 0,
      failedRecipients: [],
    }));
    renderModal(onSend, "detailed");

    await user.click(screen.getByRole("button", { name: "Simple" }));
    expect(screen.getByText(/current simple service plan link/i)).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "To" }),
      "one@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send email" }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        recipients: ["one@example.com"],
        message: "Here is the service plan for Easter Sunday on July 26, 2026.",
        shareVersion: "simple",
      }),
    );
  });

  it("commits, deduplicates, removes, and rejects recipient chips", async () => {
    const user = userEvent.setup({ delay: null });
    const onSend = jest.fn(async () => ({ success: true, sent: 1, failed: 0, failedRecipients: [] }));
    renderModal(onSend);
    const input = screen.getByRole("textbox", { name: "To" });

    await user.type(input, "one@example.com");
    await user.keyboard("{Enter}");
    await user.type(input, "TWO@example.com");
    await user.keyboard("{Tab}");
    await user.click(input);
    await user.paste("three@example.com, one@example.com");

    expect(screen.getAllByRole("button", { name: /Remove / })).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Remove TWO@example.com" }));
    expect(screen.queryByRole("button", { name: "Remove TWO@example.com" })).not.toBeInTheDocument();

    await user.type(input, "not-an-email");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("valid email");
    expect(screen.queryByRole("button", { name: "Remove not-an-email" })).not.toBeInTheDocument();
  });

  it("suggests successful recipients and restores the last successful message", async () => {
    const user = userEvent.setup({ delay: null });
    const onSend = jest.fn(async () => ({ success: true, sent: 1, failed: 0, failedRecipients: [] }));
    renderModal(onSend);
    await user.type(screen.getByRole("textbox", { name: "To" }), "mailbox@example.com");
    await user.clear(screen.getByRole("textbox", { name: "Message" }));
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Weekly note");
    await user.click(screen.getByRole("button", { name: "Send email" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));

    renderModal(jest.fn(async () => ({ success: true, sent: 1, failed: 0, failedRecipients: [] })));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Weekly note",
    );
    const input = screen.getByRole("textbox", { name: "To" });
    await user.click(input);
    expect(screen.getByRole("option", { name: "mailbox@example.com" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "mailbox@example.com" }));
    expect(screen.getByRole("button", { name: "Remove mailbox@example.com" })).toBeInTheDocument();
  });

  it("does not persist failed recipient or message drafts", async () => {
    const user = userEvent.setup({ delay: null });
    const onSend = jest.fn(async () => { throw new Error("provider down"); });
    renderModal(onSend);
    await user.type(screen.getByRole("textbox", { name: "To" }), "failed@example.com");
    await user.clear(screen.getByRole("textbox", { name: "Message" }));
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Do not save");
    await user.click(screen.getByRole("button", { name: "Send email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("provider down");
    expect(localStorage.getItem("servicePlanEmailRecentRecipients")).toBeNull();
    expect(localStorage.getItem("servicePlanEmailLastMessage")).toBeNull();
  });
});
