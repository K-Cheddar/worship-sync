# Personal volunteer access: deployment prerequisites

Personal volunteer access is standard WorshipSync functionality for every church. There is no environment or church activation switch. Administrators use Teams → Members → edit an active member → Personal My Schedule access to prepare, copy, replace, revoke or explicitly restore access. Preparation and copying send nothing. Volunteers open `/s#<credential>` without a WorshipSync account and use the existing My Schedule interface.

This document records repository requirements. **Production configuration has not been certified.** Per the product owner's instruction, no further live Heroku access, CLI authentication, production configuration changes or deployment are part of this task. Verify these prerequisites separately before deployment; do not infer readiness from local tests.

## Required environment and services

| Configuration | Exact requirement |
| --- | --- |
| `AUTH_VOLUNTEER_PORTAL_SECRET` | Required server-only dedicated secret. Generate at least 32 random bytes, encode for configuration storage, and retain the same stable value across every web/worker process and restart. The runtime rejects missing/short values and rejects a value equal to `AUTH_SESSION_SECRET`. Never use an ephemeral fallback or ship it in client environment/build variables. Store and back it up through the existing secret-management process. |
| `AUTH_VOLUNTEER_ACCESS_DAYS` | Optional. Unset means 90 days. If provided, its numeric value multiplied by 86,400,000 must be a positive safe integer. Expiration is fixed at issuance; reads, refresh and reuse do not extend it. |
| `AUTH_APP_BASE_URL` | Set explicitly to the canonical public HTTPS origin, without a path, query or fragment (for example `https://www.worshipsync.net`). The repository default is that origin, but deployment must verify it matches the actual site. Personal mutations require that exact Origin. TLS termination, apex/www redirects, reverse proxy and SPA routing must preserve `/s` and its fragment in the browser. Never move the credential into a path/query. |
| Firestore | Existing server configuration: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` for the authorized service account. Production already requires Firestore. Verify IAM, deployed browser-deny rules and existing indexes, including church/member recovery and ordered schedule queries. Never set `FIRESTORE_EMULATOR_HOST` in production. |
| `AUTH_SESSION_SECRET` | Existing required production human-session configuration, independently provisioned. It is not a personal-access fallback. Existing human sessions and Firebase accounts remain separate from volunteer cookies. |
| Node | Supported runtime `24.x`; normal repository build/start procedures apply. Client type-check and strict build must pass. No new client feature configuration is required. |

The full existing `server.js` also requires `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `COUCHDB_HOST`, `COUCHDB_USER` and `COUCHDB_PASSWORD`; these hosting prerequisites are unchanged by the portal. Preserve the existing production `NODE_ENV`, port, session and integration setup. For the normal same-origin web build use `VITE_API_BASE_PATH=/`; verify that an ignored developer `.env.local` has not embedded a localhost API URL. Personal `/api/volunteer` requests are first-party relative URLs and must be served/proxied on the canonical public origin. Do not place the personal secret in any `VITE_` variable.

Missing/invalid personal security configuration returns a non-cacheable 503 from personal/admin operations and blocks initial personal-link message preparation. The member editor displays a configuration error. Human account workflows retain their existing configuration and behavior. A configuration failure must never issue authority or fall back to a schedule-specific link for initial schedule SMS.

Server-only collections are `volunteerPersonalAccess`, `volunteerPersonalCredentials`, `volunteerPersonalSessions`, `volunteerContactProofs`, `volunteerRecoveryChallenges`, `volunteerRecoveryLimits`, and contact-index coverage alongside existing roster/schedule/intake/consent records. The existing Firestore rules deny direct browser reads/writes. Authorization checks enforce expiry without depending on TTL cleanup. No data migration is required to remove the feature gate. Optional contact-index backfill follows the [existing audited migration procedure](volunteer-recovery-review-fixes.md); incomplete coverage retains the paginated authoritative lookup.

## Verified recovery delivery prerequisites

Opening/preparing a personal link requires no email/SMS delivery. Recovery additionally requires an independently verified, uniquely mapped saved contact; shared contacts and consent alone do not establish identity.

- Email: existing `RESEND_API_KEY`, valid `RESEND_FROM_EMAIL` (optional display name `RESEND_FROM_NAME`), verified sender/domain and provider capacity. Missing delivery configuration fails the code-delivery operation; it never bypasses verification.
- SMS: existing `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, approved church messaging configuration, and `TWILIO_MESSAGING_SERVICE_SID` or a supported sender (`TWILIO_SMS_FROM_NUMBER`, `TWILIO_FROM_NUMBER`, `TWILIO_PHONE_NUMBER`), following existing provider/account configuration. Production `TWILIO_STATUS_CALLBACK_URL` must be a valid public HTTPS callback for `/api/webhooks/twilio/sms-status`, matching signature verification. Current consent and STOP state remain mandatory.
- Accurate request IP/proxy handling, shared Firestore/secret and clock are required for durable abuse budgets. Existing policies remain: 10-minute single-use codes, five guesses, 60-second resend cooldown, five sends/contact/member/hour, 20/IP/hour and 200/church/hour.

No real delivery is required or authorized for the code change. Verify provider readiness separately using an explicitly authorized procedure.

## Manual schedule SMS and approval

The existing manual preparation operation obtains/reuses the member's personal credential intentionally; GETs and discovery do not issue credentials. The exact internal body/URL and expiry remain bound to the existing approval snapshot/version and are revalidated before dispatch. Expired/replaced/revoked links or legacy reviewed URLs require fresh preparation/review. Admin previews redact personal bearer material; scoped previews replace private links entirely. Legacy schedule-specific email response links retain their original authority and explicit Accept/Decline behavior.

Keep the independent `SCHEDULE_BULK_DISPATCH_ENABLED` and send-rate configuration unchanged. Removing the portal gate does not enable the dispatcher, approve work, send messages, override consent/STOP, retry uncertain delivery, or add automatic reminders. Existing provider-accepted/uncertain-send fences and explicit administrator approval remain authoritative.

## Privacy and operational checks before deployment

1. Verify the required server values exist and are consistent on all processes without printing their contents. Do not overwrite an existing personal secret merely to satisfy a checklist. Rotation invalidates old digests/envelopes/contact proofs and needs its own reviewed recovery plan; restoring a previous key can restore old unexpired authority.
2. Verify TLS, canonical Origin, redirects and proxy-derived client IP. Personal cookies are Secure/HttpOnly/SameSite=Strict `__Host-` cookies at `/`, bounded by credential authority. Browser login cookies cannot replace the redeemed volunteer identity.
3. Inspect application/APM/proxy/log-drain request capture with synthetic credentials only. Exclude personal API bodies, cookies, CSRF and OTP codes; retain existing Sentry redaction. Fragment ingress protects router paths; it does not justify body/header capture. Confirm no-store/no-referrer headers and NetworkOnly service-worker behavior.
4. Run the [synthetic acceptance sequence](volunteer-portal-pilot.md), including authenticated member management and an accountless browser. Recheck deployed Firestore rules/indexes and a second church's isolation. Keep bulk sending off and use fake delivery.
5. Record production verification separately. No deployment recommendation is made until the production prerequisites have been checked.

Heroku documents that config vars persist across deploys/restarts and that changing them creates a release and restarts the app: [Configuration and Config Vars](https://devcenter.heroku.com/articles/config-vars). Its router logs include request paths: [HTTP Routing](https://devcenter.heroku.com/articles/http-routing). Provision security values through the existing controlled configuration process before deploying this code; this task does not run configuration mutations or deployment commands.
