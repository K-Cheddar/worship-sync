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

/** Decline shares the CTA shape but reads as the lesser action, not an error. */
const declineButtonStyle = {
  backgroundColor: "transparent",
  border: `1px solid ${worshipSyncEmailBrand.textDim}`,
  color: worshipSyncEmailBrand.textPrimary,
  marginLeft: "8px",
};

const digestListItemStyle = {
  color: worshipSyncEmailBrand.textPrimary,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 6px",
};

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
      <Text style={finePrint}>
        This link expires in about one hour. If it has expired, go back to the
        WorshipSync sign-in page and choose{" "}
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          Forgot password
        </strong>{" "}
        to send a new link.
      </Text>
      <Text style={finePrint}>
        If you did not request a password reset, you can ignore this email. Your
        password will stay the same.
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

type InviteAcceptedAdminEmailProps = {
  acceptedDisplayName: string;
  acceptedEmail: string;
  churchName: string;
  role: string;
  /** Human-readable permission lines (app access, Teams access, etc.). */
  accessLines?: string[];
  managePeopleUrl: string;
};

export function InviteAcceptedAdminEmail({
  acceptedDisplayName,
  acceptedEmail,
  churchName,
  role,
  accessLines = [],
  managePeopleUrl,
}: InviteAcceptedAdminEmailProps) {
  const churchDisplay = churchName.trim() || "your church";
  const acceptedName = acceptedDisplayName.trim();
  const acceptedLabel = acceptedName || acceptedEmail;
  const roleLabel = role === "admin" ? "admin" : "member";
  const permissionLines = accessLines
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  return (
    <WorshipSyncEmailLayout
      previewText={`${acceptedLabel} accepted an invite to ${churchDisplay}`}
      title="Invite accepted"
    >
      <Text style={bodyText}>
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          {acceptedLabel}
        </strong>{" "}
        accepted an invitation to join{" "}
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          {churchDisplay}
        </strong>{" "}
        as a {roleLabel}.
      </Text>
      {acceptedName && acceptedEmail ? (
        <Text style={bodyText}>Email: {acceptedEmail}</Text>
      ) : null}
      {permissionLines.length > 0 ? (
        <Section style={{ margin: "0 0 8px" }}>
          <Text style={bodyText}>Permissions:</Text>
          {permissionLines.map((line) => (
            <Text key={line} style={digestListItemStyle}>
              • {line}
            </Text>
          ))}
        </Section>
      ) : null}
      <Section style={{ margin: "24px 0", textAlign: "center" }}>
        <Button href={managePeopleUrl} style={ctaButtonStyle}>
          Review people
        </Button>
      </Section>
      <Text style={finePrint}>
        You receive this because you are an admin for {churchDisplay}.
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
  /** Church display name (shown in the opening line). */
  churchName: string;
  label: string;
  code: string;
  setupUrl: string;
  expiresMinutes: number;
};

export function PairingSetupCodeEmail({
  kind,
  churchName,
  label,
  code,
  setupUrl,
  expiresMinutes,
}: PairingSetupCodeEmailProps) {
  const deviceKind =
    kind === "workstation" ? "shared workstation" : "display screen";
  const churchDisplay = churchName.trim() || "your church";
  const preview = `${churchDisplay}: WorshipSync setup for ${label}`;
  return (
    <WorshipSyncEmailLayout previewText={preview} title="Device setup code">
      <Text style={bodyText}>
        An admin at{" "}
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          {churchDisplay}
        </strong>{" "}
        sent you a setup code for the{" "}
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

type IntakeSubmissionsDigestEmailProps = {
  churchName: string;
  formName: string;
  reviewUrl: string;
  /** Submitter display names, in arrival order. Length drives the summary line. */
  submitterNames: string[];
};

export function IntakeSubmissionsDigestEmail({
  churchName,
  formName,
  reviewUrl,
  submitterNames,
}: IntakeSubmissionsDigestEmailProps) {
  const count = submitterNames.length;
  const churchDisplay = churchName.trim() || "your church";
  const formDisplay = formName.trim() || "team availability";
  const countLabel = `${count} new ${count === 1 ? "response" : "responses"}`;
  return (
    <WorshipSyncEmailLayout
      previewText={`${countLabel} on ${formDisplay}`}
      title="New availability responses"
    >
      <Text style={bodyText}>
        {countLabel} came in on{" "}
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          {formDisplay}
        </strong>{" "}
        for {churchDisplay}.
      </Text>
      <Section style={{ margin: "0 0 24px" }}>
        {submitterNames.map((name, index) => (
          <Text key={`${name}-${index}`} style={digestListItemStyle}>
            • {name}
          </Text>
        ))}
      </Section>
      <Section style={{ margin: "0 0 16px", textAlign: "center" }}>
        <Button href={reviewUrl} style={ctaButtonStyle}>
          Review responses
        </Button>
      </Section>
      <Text style={finePrint}>
        You receive these because you can edit this team. Turn them off anytime
        from your account menu in WorshipSync.
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

type ScheduleAssignmentEmailProps = {
  churchName: string;
  /** First name is enough — this is the person's own schedule. */
  memberFirstName: string;
  /** One entry per slot they hold, oldest service first. */
  assignments: {
    serviceName: string;
    /** Already formatted in the church's timezone by the caller. */
    when: string;
    positionName: string;
    teamName: string;
  }[];
  /** One click = the answer. Both cover every service listed. */
  acceptUrl: string;
  declineUrl: string;
  /** Where to see everything, for anyone who does have an account. */
  scheduleUrl: string;
};

/**
 * "You are scheduled" — the email the whole notification system exists to send.
 *
 * **One click is the answer.** Accept and Decline are the buttons; the page
 * they open records it and confirms, rather than asking again. The intent rides
 * in the URL hash and is only written when that page POSTs, so mail-security
 * scanners fetching links cannot answer on the reader's behalf.
 *
 * **One pair of buttons for the whole email**, not one per service. The reader may have no
 * account and no app, so everything has to be doable from here — but four
 * services once meant four links to a page that could not even say which
 * service it was asking about. The single link opens a page listing all of
 * them, answerable individually or together.
 *
 * The answer is chosen on that page rather than encoded in the URL, so a
 * forwarded link cannot answer on their behalf.
 */
export function ScheduleAssignmentEmail({
  churchName,
  memberFirstName,
  assignments,
  acceptUrl,
  declineUrl,
  scheduleUrl,
}: ScheduleAssignmentEmailProps) {
  const churchDisplay = churchName.trim() || "your church";
  const greeting = memberFirstName.trim() ? `Hi ${memberFirstName.trim()},` : "Hi,";
  const count = assignments.length;
  const summary =
    count === 1
      ? "You are scheduled for one service."
      : `You are scheduled for ${count} services.`;

  return (
    <WorshipSyncEmailLayout
      previewText={summary}
      title="You are on the schedule"
    >
      <Text style={bodyText}>{greeting}</Text>
      <Text style={bodyText}>
        {summary} Let{" "}
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          {churchDisplay}
        </strong>{" "}
        know if you can make it.
      </Text>
      {assignments.map((assignment, index) => (
        <Section
          key={`${assignment.respondUrl}-${index}`}
          style={{ margin: "0 0 20px" }}
        >
          <Text
            style={{
              ...bodyText,
              color: worshipSyncEmailBrand.textPrimary,
              margin: "0 0 4px",
              fontWeight: 600,
            }}
          >
            {assignment.serviceName}
          </Text>
          <Text style={{ ...digestListItemStyle, margin: "0 0 2px" }}>
            {assignment.when}
          </Text>
          <Text style={{ ...digestListItemStyle, margin: "0 0 10px" }}>
            {[assignment.positionName, assignment.teamName]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </Section>
      ))}
      <Section style={{ margin: "0 0 16px", textAlign: "center" }}>
        <Button href={acceptUrl} style={ctaButtonStyle}>
          {count === 1 ? "Accept" : "Accept all"}
        </Button>
        <Button
          href={declineUrl}
          style={{ ...ctaButtonStyle, ...declineButtonStyle }}
        >
          {count === 1 ? "Decline" : "Decline all"}
        </Button>
      </Section>
      {count > 1 ? (
        <Text style={{ ...finePrint, margin: "0 0 8px", textAlign: "center" }}>
          You can answer services separately on the next page.
        </Text>
      ) : null}
      <Text style={finePrint}>
        You can also see everything at{" "}
        <Link href={scheduleUrl} style={{ color: worshipSyncEmailBrand.accent }}>
          My schedule
        </Link>
        . Turn these emails off anytime from your account menu in WorshipSync.
      </Text>
    </WorshipSyncEmailLayout>
  );
}

type ScheduleResponsesDigestEmailProps = {
  churchName: string;
  scheduleName: string;
  reviewUrl: string;
  /** One entry per change in this window, oldest first. */
  responses: {
    name: string;
    serviceName: string;
    when: string;
    positionName: string;
    /** `blockout` is someone marking time off on a date they are still scheduled for. */
    kind: "accepted" | "declined" | "blockout";
  }[];
};

/**
 * "People answered your schedule" — coalesced.
 *
 * Declines lead. An acceptance is reassurance; a decline is work, and burying
 * it under four confirmations is how an owner misses the one slot that needs
 * refilling. The subject line carries the count for the same reason.
 *
 * Blockouts sit in that same list rather than a section or an email of their
 * own. The owner's job is identical — refill this slot — and the only thing
 * they need told apart is *why*, which the line says.
 */
export function ScheduleResponsesDigestEmail({
  churchName,
  scheduleName,
  reviewUrl,
  responses,
}: ScheduleResponsesDigestEmailProps) {
  const unavailable = responses.filter((entry) => entry.kind !== "accepted");
  const accepted = responses.filter((entry) => entry.kind === "accepted");
  const churchDisplay = churchName.trim() || "your church";
  const scheduleDisplay = scheduleName.trim() || "your schedule";

  const line = (
    entry: ScheduleResponsesDigestEmailProps["responses"][number],
    index: number,
  ) => (
    <Text key={`${entry.name}-${index}`} style={digestListItemStyle}>
      • <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
        {entry.name}
      </strong>{" "}
      — {entry.serviceName}, {entry.when}
      {entry.positionName ? ` (${entry.positionName})` : ""}
      {entry.kind === "blockout" ? " — marked time off" : ""}
    </Text>
  );

  return (
    <WorshipSyncEmailLayout
      previewText={
        unavailable.length > 0
          ? `${unavailable.length} cannot serve on ${scheduleDisplay}`
          : `${accepted.length} accepted on ${scheduleDisplay}`
      }
      title="Schedule responses"
    >
      <Text style={bodyText}>
        Here is what changed on{" "}
        <strong style={{ color: worshipSyncEmailBrand.textPrimary }}>
          {scheduleDisplay}
        </strong>{" "}
        for {churchDisplay}.
      </Text>

      {unavailable.length > 0 ? (
        <Section style={{ margin: "0 0 20px" }}>
          <Text
            style={{
              ...bodyText,
              margin: "0 0 6px",
              color: worshipSyncEmailBrand.textPrimary,
              fontWeight: 600,
            }}
          >
            Cannot serve ({unavailable.length})
          </Text>
          {unavailable.map(line)}
        </Section>
      ) : null}

      {accepted.length > 0 ? (
        <Section style={{ margin: "0 0 20px" }}>
          <Text
            style={{
              ...bodyText,
              margin: "0 0 6px",
              color: worshipSyncEmailBrand.textPrimary,
              fontWeight: 600,
            }}
          >
            Confirmed ({accepted.length})
          </Text>
          {accepted.map(line)}
        </Section>
      ) : null}

      <Section style={{ margin: "0 0 16px", textAlign: "center" }}>
        <Button href={reviewUrl} style={ctaButtonStyle}>
          Open the schedule
        </Button>
      </Section>
      <Text style={finePrint}>
        You receive these because you can edit this team. Turn them off anytime
        from your account menu in WorshipSync.
      </Text>
    </WorshipSyncEmailLayout>
  );
}
