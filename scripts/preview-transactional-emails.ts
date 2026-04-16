/**
 * Writes sample HTML for each transactional template into `email-templates/.preview/`.
 * Run: npm run email:preview — then open the printed file:// URLs in a browser.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  renderAccountRestoredEmail,
  renderAdminRecoveryRequestEmail,
  renderInviteEmail,
  renderPairingSetupCodeEmail,
  renderPasswordResetEmail,
  renderSignInCodeEmail,
} from "../email-templates/renderEmail.tsx";

const demoBase = "https://www.worshipsync.net";

const main = async () => {
  const outDir = path.join(process.cwd(), "email-templates", ".preview");
  await mkdir(outDir, { recursive: true });

  const jobs: Array<{ file: string; html: Promise<string> }> = [
    {
      file: "sign-in-code.html",
      html: renderSignInCodeEmail("847291", {
        loginWithCodeUrl: `${demoBase}/#/login?code=847291&pendingAuthId=demo`,
      }).then(({ html }) => html),
    },
    {
      file: "password-reset.html",
      html: renderPasswordResetEmail(
        `${demoBase}/#/auth/reset?oobCode=demo-reset-token`,
      ).then(({ html }) => html),
    },
    {
      file: "invite.html",
      html: renderInviteEmail(`${demoBase}/#/invite?token=demo-invite-token`, {
        churchName: "Sample Community Church",
      }).then(({ html }) => html),
    },
    {
      file: "pairing-workstation.html",
      html: renderPairingSetupCodeEmail({
        kind: "workstation",
        churchName: "Sample Community Church",
        label: "Sanctuary Mac",
        code: "ws-demo-pair-token-abc12",
        setupUrl: `${demoBase}/#/workstation/pair?token=ws-demo-pair-token-abc12`,
        expiresMinutes: 15,
      }).then(({ html }) => html),
    },
    {
      file: "pairing-display.html",
      html: renderPairingSetupCodeEmail({
        kind: "display",
        churchName: "Sample Community Church",
        label: "Projector PC",
        code: "dp-demo-pair-token-xyz99",
        setupUrl: `${demoBase}/#/display/pair?token=dp-demo-pair-token-xyz99`,
        expiresMinutes: 15,
      }).then(({ html }) => html),
    },
    {
      file: "admin-recovery-request.html",
      html: renderAdminRecoveryRequestEmail({
        requesterEmail: "operator@example.com",
        churchName: "Sample Community Church",
        recoveryUrl: `${demoBase}/#/recovery/confirm?token=demo-recovery`,
      }).then(({ html }) => html),
    },
    {
      file: "account-restored.html",
      html: renderAccountRestoredEmail({
        churchName: "Sample Community Church",
        resetUrl: `${demoBase}/#/auth/reset?oobCode=demo-restore-token`,
      }).then(({ html }) => html),
    },
  ];

  for (const { file, html } of jobs) {
    const body = await html;
    const dest = path.join(outDir, file);
    await writeFile(dest, body, "utf8");
    console.log(pathToFileURL(dest).href);
  }

  console.log(`\nWrote ${jobs.length} files under ${outDir}`);
};

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
