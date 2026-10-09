# Invitation and SMS recovery matrix

Consult when a change affects invitation acceptance, SMS opt-in, challenge creation/renewal, resend, or verification recovery. Test recovery from a remounted/refreshed state, not only from a continuously mounted component.

| Adversarial sequence | Inspect in code | Evidence to seek |
| --- | --- | --- |
| Opt-in starts and a verification challenge is created; the challenge expires | Client challenge state, server eligibility/consent checks, challenge expiry and replacement behavior | Expired challenge can be replaced only after current server eligibility checks; no extra message is sent by merely reopening the page. |
| Refresh/remount while verification is pending; then request another code | Persisted recovery payload, restore path, request body, required form fields, and server challenge binding | Every required value is restored or safely re-collected. A recovery action works from the actual restored state and targets the intended phone number. |
| Phone number changes after a challenge was created | Challenge's bound phone/consent identity, client invalidation, server validation, and stale token handling | Old challenge cannot verify or renew consent for a different number; the user explicitly confirms the new number. |
| Resend/retry/double-click while another request is pending | Pending state, duplicate-action guard, request idempotency, token/challenge rotation, and response ordering | Controlled overlapping requests do not create conflicting active challenges, duplicate unintended messages, or let an older response replace newer state. |
| Recovery action is visible while its required input is hidden | Render conditions, retained values, accessibility, and action handler requirements | Operator can provide every required value without losing the recoverable challenge; hidden fields are not silently assumed to remain in memory. |
| Another actor changes eligibility or challenge state during the request | Server-side commit-time revalidation, stale invite/verification token handling, and client result reconciliation | A stale request is rejected or handled idempotently; no unintended automatic messaging occurs. |

Trace challenge creation, persisted recovery state, refresh restoration, resend/renewal, and final verification as one workflow. A mounted-component happy path does not establish recovery correctness.
