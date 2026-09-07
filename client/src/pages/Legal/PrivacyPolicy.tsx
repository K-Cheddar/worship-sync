import { Link } from "react-router-dom";
import LegalDocumentPage from "./LegalDocumentPage";

const PRIVACY_EFFECTIVE_DATE = "August 12, 2026";

const PrivacyPolicy = () => {
  return (
    <LegalDocumentPage
      title="Privacy Policy"
      effectiveDate={PRIVACY_EFFECTIVE_DATE}
    >
      <p>
        This Privacy Policy explains how WorshipSync collects, uses, and shares
        information when you use our websites, desktop apps, and related
        services (the &quot;Service&quot;). By using the Service, you agree to
        this policy. Related rules for using the Service are in our{" "}
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
            — if an Organization connects third-party tools (for example media
            or streaming partners), we receive the tokens and metadata needed to
            keep that connection working.
          </li>
        </ul>
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
            as needed for that feature.
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
          We keep information for as long as needed to provide the Service,
          meet Organization requests, resolve disputes, and meet legal
          obligations. Organization admins control much of the workspace data
          and can request deletion of an Organization account subject to our
          operational and legal requirements.
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
      </section>

      <section className="space-y-3" aria-labelledby="privacy-changes">
        <h2 id="privacy-changes">Changes</h2>
        <p>
          We may update this Privacy Policy from time to time. We will post the
          updated version with a new effective date. Continued use of the
          Service after changes means you accept the updated policy.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="privacy-contact">
        <h2 id="privacy-contact">Contact</h2>
        <p>
          Questions about this Privacy Policy or privacy requests: visit{" "}
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
