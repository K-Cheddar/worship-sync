import { Link } from "react-router-dom";
import LegalDocumentPage from "./LegalDocumentPage";

const PRIVACY_EFFECTIVE_DATE = "September 16, 2026";

const PrivacyPolicy = () => {
  return (
    <LegalDocumentPage
      title="Privacy Policy"
      effectiveDate={PRIVACY_EFFECTIVE_DATE}
    >
      <p>
        This Privacy Policy explains how WorshipSync collects, uses, and shares
        information when you use our websites, desktop apps, and related
        services (the &quot;Service&quot;). Related rules for using the Service are
        in our{" "}
        <Link to="/terms">Terms of Service</Link>.
      </p>

      <section className="space-y-3" aria-labelledby="privacy-who">
        <h2 id="privacy-who">Who we are</h2>
        <p>
          WorshipSync provides live presentation tools and church operations
          features such as scheduling, chat, and discussion boards. Churches and
          other organizations (&quot;Organizations&quot;) create workspaces and
          invite people to use the Service for their ministry or team.
        </p>
        <p>
          When an Organization invites you or stores information about you (for
          example roster details or schedule responses), that Organization
          decides what to collect and how long to keep it. WorshipSync processes
          that information to provide the Service to the Organization.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-location">
        <h2 id="privacy-location">Who operates WorshipSync and where information is processed</h2>
        <p>
          WorshipSync is operated by its owner from Florida, United States.
          Information may be stored and processed by WorshipSync and its
          service providers in data centers in the United States and, depending
          on the provider, in other locations.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-collect">
        <h2 id="privacy-collect">Information we collect</h2>
        <p>Depending on how you use the Service, we may collect:</p>
        <ul>
          <li>
            <strong className="font-semibold text-gray-100">
              Account information
            </strong>{" "}
            — name, email address, sign-in method (email/password, Google, or
            Microsoft), role, and access level.
          </li>
          <li>
            <strong className="font-semibold text-gray-100">
              Organization and roster data
            </strong>{" "}
            — church or workspace details, branding, teammate invites, volunteer
            roster fields (such as contact details and scheduling preferences),
            assignments, responses, and related notes that Organization admins
            choose to store.
          </li>
          <li>
            <strong className="font-semibold text-gray-100">
              Content you create
            </strong>{" "}
            — service plans, slides, media, overlays, timers, credits, chat
            messages, discussion board posts, and similar materials uploaded or
            entered in the Service.
          </li>
          <li>
            <strong className="font-semibold text-gray-100">
              Device and session data
            </strong>{" "}
            — device identifiers used for trusted devices and pairing, operator
            labels, display or workstation link codes, and local preferences
            stored on the device.
          </li>
          <li>
            <strong className="font-semibold text-gray-100">
              Usage and technical data
            </strong>{" "}
            — approximate logs needed to operate, secure, and improve the
            Service (for example connection status, error diagnostics, and
            feature usage). We may use privacy-preserving analytics or error
            reporting tools for this purpose.
          </li>
          <li>
            <strong className="font-semibold text-gray-100">
              Optional integrations
            </strong>{" "}
            — if an Organization connects third-party tools such as
            Google/YouTube, Restream, Canva, or Planning Center, we may receive
            and store authorization credentials and related account or service
            metadata needed to keep that connection working. Credentials may
            remain stored server-side until the connection is disconnected,
            revoked, expires, or is otherwise removed.
          </li>
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-youtube">
        <h2 id="privacy-youtube">Google and YouTube integration</h2>
        <p>
          An Organization administrator may connect a Google account used with
          YouTube. When they do, WorshipSync receives and stores OAuth
          authorization credentials, such as access and refresh tokens, as
          necessary to maintain the connection.
        </p>
        <p>
          For the enabled YouTube features, WorshipSync may access relevant
          channel information, livestream information, and live-chat data. When
          an authorized user directs it to do so, WorshipSync may post a
          message to the connected YouTube live chat. Google-derived data is
          used only to provide and maintain the connected WorshipSync
          functionality.
        </p>
        <p>
          Organization admins can disconnect the integration in WorshipSync.
          Disconnecting or revoking authorization removes the stored
          credentials from WorshipSync where supported by the integration;
          third-party data already held by Google or YouTube remains subject to
          their policies and controls.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-use">
        <h2 id="privacy-use">How we use information</h2>
        <p>We use information to:</p>
        <ul>
          <li>Provide, sync, and secure the Service across devices and displays</li>
          <li>Authenticate users, recover accounts, and manage trusted devices</li>
          <li>
            Send transactional messages such as invites, assignment notices,
            password resets, and security alerts
          </li>
          <li>Support Organizations and diagnose problems</li>
          <li>Improve reliability and features</li>
          <li>Comply with law and enforce our Terms of Service</li>
        </ul>
        <p>
          We do not sell personal information. We do not use Organization
          content to train public AI models.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-share">
        <h2 id="privacy-share">How we share information</h2>
        <p>We may share information with:</p>
        <ul>
          <li>
            <strong className="font-semibold text-gray-100">
              Your Organization
            </strong>{" "}
            — admins and teammates with access can see roster, schedule, and
            workspace content according to roles set in the Service.
          </li>
          <li>
            <strong className="font-semibold text-gray-100">
              Service providers
            </strong>{" "}
            — vendors that host infrastructure, authentication, databases,
            media storage, email delivery, or error monitoring, under
            obligations to handle data appropriately.
          </li>
          <li>
            <strong className="font-semibold text-gray-100">
              Integration partners
            </strong>{" "}
            — when an Organization enables a connection, limited data is shared
            as needed for that feature and subject to the partner&apos;s terms and
            privacy policy.
          </li>
          <li>
            <strong className="font-semibold text-gray-100">
              Legal and safety
            </strong>{" "}
            — when required by law, or to protect WorshipSync, users, or others
            from fraud, abuse, or security threats.
          </li>
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-storage">
        <h2 id="privacy-storage">Cookies and local storage</h2>
        <p>
          The Service uses cookies, local storage, and similar technologies to
          keep you signed in, remember preferences, restore routes in the
          desktop app, and keep devices paired. These are primarily for
          operation of the Service, not advertising.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-retention">
        <h2 id="privacy-retention">Retention</h2>
        <p>
          Retention periods vary by type of information. Some operational data,
          such as certain chat or integration records, may be automatically
          deleted after defined retention periods, while service plans, media,
          roster data, and other Organization content may remain until deleted
          by the Organization, the Organization account is closed, or retention
          is otherwise no longer necessary. Organization admins control much of
          the workspace data and can request deletion subject to our operational,
          backup, and legal requirements.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-security">
        <h2 id="privacy-security">Security</h2>
        <p>
          We use administrative, technical, and organizational measures designed
          to protect information. No method of transmission or storage is fully
          secure. Please use strong passwords, protect device access, and limit
          admin roles to people who need them.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-children">
        <h2 id="privacy-children">Children</h2>
        <p>
          The Service is intended for Organizations and adults who manage church
          or team workflows. Organizations are responsible for how they collect
          information about minors and for obtaining any consents required by
          law.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-rights">
        <h2 id="privacy-rights">Your choices and rights</h2>
        <p>
          Depending on where you live, you may have rights to access, correct,
          export, or delete personal information, or to object to certain
          processing. Start with your Organization admin for roster and schedule
          data they control. For account-level requests, contact us using the
          details below. We may need to verify your request before acting on it.
        </p>
        <p>
          Organization admins can disconnect third-party integrations. We will
          remove or revoke stored authorization credentials where supported, but
          disconnecting an integration does not necessarily delete data already
          held by the third-party provider.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-changes">
        <h2 id="privacy-changes">Changes</h2>
        <p>
          We may update this Privacy Policy from time to time. When we make
          material changes, we will update the effective date and provide
          additional notice when appropriate.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-contact">
        <h2 id="privacy-contact">Contact</h2>
        <p>
          Questions about this Privacy Policy or privacy requests: email{" "}
          <a href="mailto:support@worshipsync.net">support@worshipsync.net</a>{" "}
          or visit{" "}
          <a
            href="https://worshipsync.net"
            target="_blank"
            rel="noopener noreferrer"
          >
            worshipsync.net
          </a>{" "}
          and use the contact options listed there.
        </p>
      </section>
    </LegalDocumentPage>
  );
};

export default PrivacyPolicy;
