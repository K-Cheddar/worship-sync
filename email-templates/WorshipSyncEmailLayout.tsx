import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import React, { type ReactNode } from "react";
import { getDefaultEmailLogoUrl } from "./emailLogoUrl";

/** Matches auth surfaces: same hue as `--color-homepage-canvas` in client/src/styles/globals.css */
export const worshipSyncEmailBrand = {
  pageBg: "#2b3544",
  cardBg: "#1f2937",
  cardBorder: "#6b7280",
  textPrimary: "#f9fafb",
  textMuted: "#e5e7eb",
  textDim: "#9ca3af",
  cta: "#0891b2",
  link: "#22d3ee",
} as const;

const fontStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

/** Small header mark; inline px + maxWidth so clients don’t render logo512 at full size */
const EMAIL_LOGO_PX = 48;
const emailLogoImgStyle = {
  display: "block" as const,
  margin: "0 auto",
  width: `${EMAIL_LOGO_PX}px`,
  maxWidth: `${EMAIL_LOGO_PX}px`,
  height: `${EMAIL_LOGO_PX}px`,
  maxHeight: `${EMAIL_LOGO_PX}px`,
  border: 0,
  outline: "none",
};

type WorshipSyncEmailLayoutProps = {
  previewText: string;
  title: string;
  children: ReactNode;
  /** When omitted, uses EMAIL_LOGO_URL, AUTH_APP_BASE_URL-derived /logo512.png, or production default. */
  logoUrl?: string;
};

export default function WorshipSyncEmailLayout({
  previewText,
  title,
  children,
  logoUrl = getDefaultEmailLogoUrl(),
}: WorshipSyncEmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{previewText}</Preview>
      <Body
        style={{
          backgroundColor: worshipSyncEmailBrand.pageBg,
          fontFamily: fontStack,
          margin: 0,
          padding: "32px 16px",
        }}
      >
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Section
            style={{
              backgroundColor: worshipSyncEmailBrand.cardBg,
              border: `1px solid ${worshipSyncEmailBrand.cardBorder}`,
              borderRadius: "16px",
              padding: "24px",
            }}
          >
            <Section style={{ margin: "0 0 20px", textAlign: "center" }}>
              <Img
                src={logoUrl}
                alt="WorshipSync"
                width={EMAIL_LOGO_PX}
                height={EMAIL_LOGO_PX}
                style={emailLogoImgStyle}
              />
            </Section>
            <Heading
              as="h1"
              style={{
                color: worshipSyncEmailBrand.textPrimary,
                fontSize: "24px",
                fontWeight: 600,
                lineHeight: "32px",
                margin: "0 0 16px",
              }}
            >
              {title}
            </Heading>
            {children}
          </Section>
          <Text
            style={{
              color: worshipSyncEmailBrand.textDim,
              fontSize: "12px",
              lineHeight: "18px",
              margin: "24px 0 0",
              textAlign: "center",
            }}
          >
            WorshipSync — live presentation for your church.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
