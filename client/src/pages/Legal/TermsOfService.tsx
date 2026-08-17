import { Link } from "react-router-dom";
import LegalDocumentPage from "./LegalDocumentPage";

const TERMS_EFFECTIVE_DATE = "August 12, 2026";

const TermsOfService = () => {
  return (
    <LegalDocumentPage
      title="Terms of Service"
      effectiveDate={TERMS_EFFECTIVE_DATE}
    >
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use
        of WorshipSync websites, desktop apps, and related services (the
        &quot;Service&quot;). By creating an account, accepting an invite,
        pairing a device, or otherwise using the Service, you agree to these
        Terms. Our{" "}
        <Link to="/privacy">Privacy Policy</Link> explains how we handle
        information.
      </p>

      <section className="space-y-3" aria-labelledby="terms-service">
        <h2 id="terms-service">The Service</h2>
        <p>
          WorshipSync helps Organizations present during services and manage
          related workflows such as scheduling, chat, and discussion boards. We
          may update features over time. Some features depend on third-party
          services or Organization configuration.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="terms-accounts">
        <h2 id="terms-accounts">Accounts and access</h2>
        <ul>
          <li>
            You must provide accurate account information and keep credentials
            secure.
          </li>
          <li>
            Organization admins control who may join their workspace and what
            each person can do.
          </li>
          <li>
            Workstations and displays may be paired with codes. Anyone with a
            valid code and device access can use the linked surface. Protect
            those codes.
          </li>
          <li>
            You must be old enough to form a binding contract where you live, or
            use the Service only under an Organization that is authorized to
            accept these Terms for you.
          </li>
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="terms-org">
        <h2 id="terms-org">Organization responsibilities</h2>
        <p>If you administer an Organization workspace, you agree that you:</p>
        <ul>
          <li>
            Have authority to bind the Organization to these Terms
          </li>
          <li>
            Are responsible for teammate and volunteer data you store, including
            notices and consents required by law
          </li>
          <li>
            Will use admin tools carefully, including invites, access levels,
            recovery, and device pairing
          </li>
          <li>
            Will not use the Service for unlawful content or activity
          </li>
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="terms-acceptable">
        <h2 id="terms-acceptable">Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Break the law or others&apos; rights</li>
          <li>
            Attempt unauthorized access to accounts, devices, data, or systems
          </li>
          <li>
            Interfere with the Service, including by overloading, scraping in a
            harmful way, or reverse engineering except where allowed by law
          </li>
          <li>
            Upload malware or content you do not have rights to use
          </li>
          <li>
            Misrepresent your identity or affiliation in a way that deceives
            others
          </li>
          <li>
            Use the Service to send spam or abusive communications
          </li>
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="terms-content">
        <h2 id="terms-content">Your content</h2>
        <p>
          You and your Organization keep ownership of content you submit
          (slides, media, plans, messages, and similar materials). You grant
          WorshipSync a limited license to host, process, transmit, and display
          that content only as needed to operate and improve the Service for
          you.
        </p>
        <p>
          You are responsible for ensuring you have the rights to use songs,
          scripture texts, media, logos, and other materials you add.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="terms-third">
        <h2 id="terms-third">Third-party services</h2>
        <p>
          Optional integrations and linked services are governed by their own
          terms and privacy policies. WorshipSync is not responsible for
          third-party products you choose to connect.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="terms-availability">
        <h2 id="terms-availability">Availability</h2>
        <p>
          We work to keep the Service reliable, including during live events.
          The Service may still be interrupted by maintenance, network issues,
          device problems, or events outside our control. Keep local backups of
          critical materials when you need them, and test important setups
          before a service when you can.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="terms-disclaimer">
        <h2 id="terms-disclaimer">Disclaimer of warranties</h2>
        <p>
          To the fullest extent permitted by law, the Service is provided
          &quot;as is&quot; and &quot;as available,&quot; without warranties of
          any kind, whether express, implied, or statutory, including implied
          warranties of merchantability, fitness for a particular purpose, and
          non-infringement.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="terms-liability">
        <h2 id="terms-liability">Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, WorshipSync and its suppliers
          will not be liable for any indirect, incidental, special,
          consequential, or punitive damages, or for lost profits, revenue,
          data, or goodwill, arising from your use of the Service. Our total
          liability for any claim relating to the Service will not exceed the
          greater of (a) the amounts you paid us for the Service in the twelve
          months before the claim or (b) one hundred U.S. dollars (US $100).
        </p>
        <p>
          Some places do not allow certain limitations. In those places, our
          liability is limited to the maximum extent allowed by law.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="terms-termination">
        <h2 id="terms-termination">Suspension and termination</h2>
        <p>
          You may stop using the Service at any time. Organization admins may
          remove users from a workspace. We may suspend or end access if you
          violate these Terms, create risk, or if we discontinue the Service. We
          will try to give reasonable notice when practical.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="terms-changes">
        <h2 id="terms-changes">Changes to these Terms</h2>
        <p>
          We may update these Terms. We will post the updated version with a new
          effective date. If you continue using the Service after changes take
          effect, you accept the updated Terms. If you do not agree, stop using
          the Service.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="terms-general">
        <h2 id="terms-general">General</h2>
        <p>
          These Terms are the agreement between you and WorshipSync about the
          Service. If a court finds a part unenforceable, the rest remains in
          effect. Failure to enforce a provision is not a waiver. You may not
          assign these Terms without our consent; we may assign them in
          connection with a merger, acquisition, or sale of assets.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="terms-contact">
        <h2 id="terms-contact">Contact</h2>
        <p>
          Questions about these Terms: visit{" "}
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

export default TermsOfService;
