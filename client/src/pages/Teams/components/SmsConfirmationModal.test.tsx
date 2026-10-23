import { render, screen } from "@testing-library/react";
import SmsConfirmationModal from "./SmsConfirmationModal";
import { CurrentMemberIdentityProvider } from "./CurrentUserMemberIndicator";

const props = {
  isOpen: true,
  recipientName: "Rae Kim",
  recipientMemberId: "member-self",
  phoneNumberSnapshot: "••• ••• 1234",
  message: "Please respond at [private response link].",
  segmentCount: 1,
  onCancel: jest.fn(),
  onSend: jest.fn(),
};

test("marks the exact recipient while leaving the SMS body unchanged", () => {
  render(
    <CurrentMemberIdentityProvider memberId="member-self">
      <SmsConfirmationModal {...props} />
    </CurrentMemberIdentityProvider>,
  );

  expect(screen.getByText("You")).toBeInTheDocument();
  expect(screen.getByText("Please respond at [private response link].")).toBeInTheDocument();
});

test("does not mark the recipient when the account is unlinked", () => {
  render(
    <CurrentMemberIdentityProvider memberId={null}>
      <SmsConfirmationModal {...props} />
    </CurrentMemberIdentityProvider>,
  );

  expect(screen.queryByText("You")).not.toBeInTheDocument();
  expect(screen.getByText("Rae Kim")).toBeInTheDocument();
});
