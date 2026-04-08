import { render } from "@react-email/render";
import React, { type ReactElement } from "react";
import {
  AccountRestoredEmail,
  AdminRecoveryRequestEmail,
  InviteEmail,
  PairingSetupCodeEmail,
  PasswordResetEmail,
  SignInCodeEmail,
} from "./transactional-emails";

async function renderEmailHtmlAndText(element: ReactElement) {
  const html = await render(element);
  const text = await render(element, { plainText: true });
  return { html, text };
}

export async function renderSignInCodeEmail(
  code: string,
  options?: { loginWithCodeUrl?: string }
) {
  return renderEmailHtmlAndText(
    <SignInCodeEmail code={code} loginWithCodeUrl={options?.loginWithCodeUrl} />
  );
}

export async function renderPasswordResetEmail(resetUrl: string) {
  return renderEmailHtmlAndText(<PasswordResetEmail resetUrl={resetUrl} />);
}

export async function renderInviteEmail(
  inviteUrl: string,
  options: { churchName: string }
) {
  return renderEmailHtmlAndText(
    <InviteEmail inviteUrl={inviteUrl} churchName={options.churchName} />
  );
}

export async function renderAdminRecoveryRequestEmail(props: {
  requesterEmail: string;
  churchName: string;
  recoveryUrl: string;
}) {
  return renderEmailHtmlAndText(<AdminRecoveryRequestEmail {...props} />);
}

export async function renderAccountRestoredEmail(props: {
  churchName: string;
  resetUrl: string;
}) {
  return renderEmailHtmlAndText(<AccountRestoredEmail {...props} />);
}

export async function renderPairingSetupCodeEmail(props: {
  kind: "workstation" | "display";
  label: string;
  code: string;
  setupUrl: string;
  expiresMinutes: number;
}) {
  return renderEmailHtmlAndText(<PairingSetupCodeEmail {...props} />);
}
