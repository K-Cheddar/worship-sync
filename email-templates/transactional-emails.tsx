import { Button, Link, Section, Text } from "@react-email/components";
import React from "react";
import WorshipSyncEmailLayout, {
  worshipSyncEmailBrand,
} from "./WorshipSyncEmailLayout";

const bodyText = {
  color: worshipSyncEmailBrand.textMuted,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 16px",
};

const finePrint = {
  color: worshipSyncEmailBrand.textDim,
  fontSize: "14px",
  lineHeight: "22px",
  margin: "16px 0 0",
};

const urlText = {
  ...finePrint,
  wordBreak: "break-all" as const,
};

const ctaButtonStyle = {
  backgroundColor: worshipSyncEmailBrand.cta,
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: 600,
  padding: "12px 24px",
  textDecoration: "none",
} as const;

type SignInCodeEmailProps = {
  code: string;
  /** Opens WorshipSync with the code prefilled on the sign-in page (hash router). */
  loginWithCodeUrl?: string;
};

const signInCodeBoxStyle = {
  border: `1px solid ${worshipSyncEmailBrand.cardBorder}`,
  borderRadius: "8px",
  padding: "20px 16px",
  backgroundColor: "#111827",
  margin: "24px 0",
  textAlign: "center" as const,
};

const signInCodeTextStyle = {
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: "32px",
  fontWeight: 600,
  letterSpacing: "0.12em",
  color: worshipSyncEmailBrand.textPrimary,
  margin: 0,
  /** Extra vertical rhythm so selection highlights don’t overlap when lines wrap (email clients). */
  lineHeight: "52px",
  wordBreak: "break-all" as const,
  overflowWrap: "anywhere" as const,
  userSelect: "all" as const,
  WebkitUserSelect: "all" as const,
  MozUserSelect: "all" as const,
  msUserSelect: "all" as const,
};

/** Long pairing tokens wrap; slightly smaller type + roomier line height keeps selection readable. */
const pairingSetupCodeTextStyle = {
  ...signInCodeTextStyle,
  fontSize: "24px",
  lineHeight: "40px",
  letterSpacing: "0.08em",
};

export function SignInCodeEmail({ code, loginWithCodeUrl }: SignInCodeEmailProps) {
  return (
    <WorshipSyncEmailLayout
      previewText={`Your WorshipSync sign-in code is ${code}`}
      title="Your sign-in code"
    >
      <Text style={bodyText}>
        Use this code to verify this device on WorshipSync.
      </Text>
      <Section style={signInCodeBoxStyle}>
        <Text style={signInCodeTextStyle}>{code}</Text>
      </Section>
      {loginWithCodeUrl ? (
        <Section style={{ margin: "0 0 16px", textAlign: "center" }}>
          <Button href={loginWithCodeUrl} style={ctaButtonStyle}>
            Open WorshipSync with this code
          </Button>
        </Section>
      ) : null}
      <Text style={finePrint}>
        This code expires in 10 minutes. If you did not try to sign in, you can
        ignore this message.
      </Text>
    </WorshipSyncEmailLayout>
  );
}

type PasswordResetEmailProps = {
  resetUrl: string;
};

export function PasswordResetEmail({ resetUrl }: PasswordResetEmailProps) {
  return (
    <WorshipSyncEmailLayout
      previewText="Reset your WorshipSync password"
      title="Reset your password"
    >
      <Text style={bodyText}>
        Use the button below to set a new password. This link is only for your
        account.
      </Text>
      <Section style={{ margin: "24px 0", textAlign: "center" }}>
        <Button href={resetUrl} style={ctaButtonStyle}>
          Reset password
        </Button>
      </Section>
      <Text style={finePrint}>
        If the button does not work, copy and paste this link into your
        browser:
      </Text>
      <Text style={urlText}>
        <Link href={resetUrl} style={{ color: worshipSyncEmailBrand.link }}>
          {resetUrl}
        </Link>
      </Text>
    </WorshipSyncEmailLayout>
  );
}

type InviteEmailProps = {
  inviteUrl: string;
  churchName: string;
};

export function InviteEmail({ inviteUrl, churchName }: InviteEmailProps) {
  const previewChurch = churchName.trim() || "your church";
  return (
    <WorshipSyncEmailLayout
      previewText={`You have been invited to join ${previewChurch} on WorshipSync`}
      title="You are invited"
    >
      <Text style={bodyText}>
        You have been invited to join{" "}
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          {churchName.trim() || "your church"}
        </strong>{" "}
        on WorshipSync. Use the button below to accept.
      </Text>
      <Section style={{ margin: "24px 0", textAlign: "center" }}>
        <Button href={inviteUrl} style={ctaButtonStyle}>
          Accept invitation
        </Button>
      </Section>
      <Text style={finePrint}>
        If the button does not work, copy and paste this link into your
        browser:
      </Text>
      <Text style={urlText}>
        <Link href={inviteUrl} style={{ color: worshipSyncEmailBrand.link }}>
          {inviteUrl}
        </Link>
      </Text>
    </WorshipSyncEmailLayout>
  );
}

type AdminRecoveryRequestEmailProps = {
  requesterEmail: string;
  churchName: string;
  recoveryUrl: string;
};

export function AdminRecoveryRequestEmail({
  requesterEmail,
  churchName,
  recoveryUrl,
}: AdminRecoveryRequestEmailProps) {
  return (
    <WorshipSyncEmailLayout
      previewText={`${requesterEmail} requested admin access for ${churchName}`}
      title="Admin access requested"
    >
      <Text style={bodyText}>
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          {requesterEmail}
        </strong>{" "}
        requested admin access for{" "}
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          {churchName}
        </strong>
        .
      </Text>
      <Text style={bodyText}>
        If you recognize this request, use the button below to approve and
        restore admin access.
      </Text>
      <Section style={{ margin: "24px 0", textAlign: "center" }}>
        <Button href={recoveryUrl} style={ctaButtonStyle}>
          Review request
        </Button>
      </Section>
      <Text style={finePrint}>
        If the button does not work, copy and paste this link into your
        browser:
      </Text>
      <Text style={urlText}>
        <Link href={recoveryUrl} style={{ color: worshipSyncEmailBrand.link }}>
          {recoveryUrl}
        </Link>
      </Text>
    </WorshipSyncEmailLayout>
  );
}

type AccountRestoredEmailProps = {
  churchName: string;
  resetUrl: string;
};

type PairingSetupCodeEmailProps = {
  kind: "workstation" | "display";
  label: string;
  code: string;
  setupUrl: string;
  expiresMinutes: number;
};

export function PairingSetupCodeEmail({
  kind,
  label,
  code,
  setupUrl,
  expiresMinutes,
}: PairingSetupCodeEmailProps) {
  const deviceKind =
    kind === "workstation" ? "shared workstation" : "display screen";
  const preview = `WorshipSync setup for ${label}`;
  return (
    <WorshipSyncEmailLayout previewText={preview} title="Device setup code">
      <Text style={bodyText}>
        A church admin sent you a setup code for the{" "}
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          {label}
        </strong>{" "}
        {deviceKind}. Open WorshipSync on that device and enter the code, or use
        the button below.
      </Text>
      <Section style={signInCodeBoxStyle}>
        <Text style={pairingSetupCodeTextStyle}>{code}</Text>
      </Section>
      <Section style={{ margin: "0 0 16px", textAlign: "center" }}>
        <Button href={setupUrl} style={ctaButtonStyle}>
          Open setup with this code
        </Button>
      </Section>
      <Text style={finePrint}>
        If the button does not work, copy and paste this link into your
        browser:
      </Text>
      <Text style={urlText}>
        <Link href={setupUrl} style={{ color: worshipSyncEmailBrand.link }}>
          {setupUrl}
        </Link>
      </Text>
      <Text style={finePrint}>
        This code expires in about {expiresMinutes} minutes. If you did not
        expect this email, you can ignore it.
      </Text>
    </WorshipSyncEmailLayout>
  );
}

export function AccountRestoredEmail({
  churchName,
  resetUrl,
}: AccountRestoredEmailProps) {
  return (
    <WorshipSyncEmailLayout
      previewText={`Admin access restored for ${churchName}`}
      title="Admin access restored"
    >
      <Text style={bodyText}>
        Admin access has been restored for{" "}
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          {churchName}
        </strong>
        . Use the button below to set a new password and sign in.
      </Text>
      <Section style={{ margin: "24px 0", textAlign: "center" }}>
        <Button href={resetUrl} style={ctaButtonStyle}>
          Set password
        </Button>
      </Section>
      <Text style={finePrint}>
        If the button does not work, copy and paste this link into your
        browser:
      </Text>
      <Text style={urlText}>
        <Link href={resetUrl} style={{ color: worshipSyncEmailBrand.link }}>
          {resetUrl}
        </Link>
      </Text>
    </WorshipSyncEmailLayout>
  );
}
